import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AssetStatus,
  DefectSeverity,
  InspectionCompletionStatus,
  InspectionItemResultValue,
  OperationalScope,
  OperationMode,
  Prisma,
  SiteVisitStatus,
  SiteVisitType,
  SurveyLifecycleStatus,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { resolveCanImport } from '../common/authorization/import-actor';
import { buildAppsheetReportingGroup } from '../common/import.constants';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  ALL_TEMPLATE_KEYS,
  buildExternalRef,
  CellNote,
  ItemType,
  ParsedRow,
  parseMasterlist,
} from './savr-klb-masterlist';

const TEMPLATE_NAME = 'SAVR KLB';
const SERVICE_USER_EMAIL = 'appsheet-import@ascure.local';
const FALLBACK_TEAM_CODE = 'APPSHEET_IMPORT';

type TemplateItem = {
  id: string;
  key: string;
  label: string;
  inputType: ItemType;
  severity: DefectSeverity;
  options: Set<string>;
};

type ResolvedTemplate = { id: string; version: number; itemsByKey: Map<string, TemplateItem> };

type Analysis = {
  ok: boolean;
  blocking: CellNote[];
  template: { id: string; name: string; version: number; itemCount: number; missingKeys: string[] } | null;
  parse: { dataRows: number; matchedColumns: number; unmappedHeaders: string[] };
  rows: ParsedRow[];
};

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  private async assertCanImport(user: RequestUser): Promise<void> {
    if (!(await resolveCanImport(this.usersService, user))) {
      throw new ForbiddenException('IMPORT capability (or ADMIN) is required to run imports.');
    }
  }

  private async resolveTemplate(tenantId: string): Promise<{ template: ResolvedTemplate | null; missingKeys: string[]; raw: { id: string; version: number } | null }> {
    const tpl = await this.prisma.inspectionTemplate.findFirst({
      where: { tenantId, name: TEMPLATE_NAME, isActive: true, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
      include: { sections: { include: { items: true } } },
    });
    if (!tpl) return { template: null, missingKeys: ALL_TEMPLATE_KEYS, raw: null };

    const itemsByKey = new Map<string, TemplateItem>();
    for (const section of tpl.sections) {
      for (const it of section.items) {
        const options = new Set<string>();
        const cfg = it.optionsJson as { options?: { value?: string }[] } | null;
        if (cfg?.options) for (const o of cfg.options) if (o?.value) options.add(String(o.value));
        itemsByKey.set(it.key, { id: it.id, key: it.key, label: it.label, inputType: it.inputType as ItemType, severity: it.severity, options });
      }
    }
    const missingKeys = ALL_TEMPLATE_KEYS.filter((k) => !itemsByKey.has(k));
    return { template: { id: tpl.id, version: tpl.version, itemsByKey }, missingKeys, raw: { id: tpl.id, version: tpl.version } };
  }

  /** Parse + resolve template + value-level validation. Read-only. Shared by validate + commit. */
  private async analyze(user: RequestUser, buffer: Buffer): Promise<Analysis> {
    const parsed = await parseMasterlist(buffer);
    const blocking: CellNote[] = [...parsed.structuralErrors];

    const { template, missingKeys, raw } = await this.resolveTemplate(user.tenantId);
    if (!template) {
      blocking.push({ column: '-', code: 'NO_TEMPLATE', message: `No ACTIVE "${TEMPLATE_NAME}" template found for this tenant — publish SAVR KLB v2 first.` });
    } else if (missingKeys.length) {
      blocking.push({ column: '-', code: 'TEMPLATE_MISSING_KEYS', message: `Active ${TEMPLATE_NAME} v${template.version} is missing ${missingKeys.length} expected item key(s): ${missingKeys.slice(0, 6).join(', ')}${missingKeys.length > 6 ? '…' : ''}` });
    }

    // value-level validation against template options
    if (template) {
      for (const row of parsed.rows) {
        for (const v of row.values) {
          const item = template.itemsByKey.get(v.key);
          if (!item || v.value === null) continue;
          if (v.type === 'MULTI_SELECT' && Array.isArray(v.value) && item.options.size) {
            const unknown = v.value.filter((x) => !item.options.has(x));
            if (unknown.length) {
              row.warnings.push({ column: '-', code: 'UNKNOWN_OPTION', message: `${v.key}: value(s) ${unknown.join(', ')} not in template options — dropped.` });
              v.value = v.value.filter((x) => item.options.has(x));
              if ((v.value as string[]).length === 0) v.value = null;
            }
          }
          if (v.type === 'SELECT' && typeof v.value === 'string' && item.options.size && !item.options.has(v.value)) {
            row.warnings.push({ column: '-', code: 'UNKNOWN_OPTION', message: `${v.key}: "${v.value}" not in template options (kept).` });
          }
        }
      }
    }

    return {
      ok: blocking.length === 0,
      blocking,
      template: template ? { id: template.id, name: TEMPLATE_NAME, version: template.version, itemCount: template.itemsByKey.size, missingKeys } : null,
      parse: { dataRows: parsed.rows.length, matchedColumns: parsed.matchedColumns, unmappedHeaders: parsed.unmappedHeaders },
      rows: parsed.rows,
    };
  }

  // ---- DRY RUN -------------------------------------------------------------

  async validate(user: RequestUser, buffer: Buffer, batchId: string) {
    await this.assertCanImport(user);
    const a = await this.analyze(user, buffer);
    if (!a.ok) {
      return { batchId, ok: false, blocking: a.blocking, template: a.template, file: a.parse, summary: null, resolution: null, rows: [] };
    }

    const tenantId = user.tenantId;
    const rows = a.rows;

    // Projected create/update via read-only lookups
    const pencawangCodes = [...new Set(rows.map((r) => r.pencawangCode).filter(Boolean) as string[])];
    const existingSubs = await this.prisma.substation.findMany({ where: { tenantId, code: { in: pencawangCodes } }, select: { id: true, code: true } });
    const subIdByCode = new Map(existingSubs.map((s) => [s.code, s.id]));

    const existingAssetKeys = new Set<string>();
    if (existingSubs.length) {
      const assets = await this.prisma.asset.findMany({
        where: { tenantId, substationId: { in: existingSubs.map((s) => s.id) } },
        select: { substationId: true, assetCode: true },
      });
      for (const x of assets) existingAssetKeys.add(`${x.substationId}::${x.assetCode}`);
    }

    const externalRefs = rows.map((r) => (r.uniqueId ? buildExternalRef(r.uniqueId) : null)).filter(Boolean) as string[];
    const existingInsp = await this.prisma.inspection.findMany({ where: { tenantId, externalRef: { in: externalRefs } }, select: { externalRef: true } });
    const existingRefs = new Set(existingInsp.map((i) => i.externalRef));

    // Resolution report
    const resolution = await this.buildResolutionReport(tenantId, rows);

    let assetCreate = 0, assetUpdate = 0, inspCreate = 0, inspUpdate = 0, defects = 0, itemResults = 0, inspectionResults = 0, warnings = 0, rowsSkipped = 0;
    const rowReports = rows.map((r) => {
      warnings += r.warnings.length;
      if (r.errors.length) { rowsSkipped++; return { row: r.rowNumber, uniqueId: r.uniqueId, pencawangCode: r.pencawangCode, assetCode: r.assetCode, asset: 'skip', inspection: 'skip', defects: 0, warnings: r.warnings, errors: r.errors }; }

      const subId = subIdByCode.get(r.pencawangCode!);
      const assetExists = subId ? existingAssetKeys.has(`${subId}::${r.assetCode}`) : false;
      assetExists ? assetUpdate++ : assetCreate++;

      const ref = r.uniqueId ? buildExternalRef(r.uniqueId) : null;
      const inspExists = ref ? existingRefs.has(ref) : false;
      inspExists ? inspUpdate++ : inspCreate++;

      const rowDefects = r.defects.filter((d) => d.present).length;
      defects += rowDefects;
      itemResults += r.defects.length; // all 24 PASS/FAIL rows (passRows=true)
      inspectionResults += r.values.filter((v) => v.value !== null).length;
      return { row: r.rowNumber, uniqueId: r.uniqueId, pencawangCode: r.pencawangCode, assetCode: r.assetCode, asset: assetExists ? 'update' : 'create', inspection: inspExists ? 'update' : 'create', defects: rowDefects, warnings: r.warnings, errors: [] };
    });

    const subCreate = pencawangCodes.filter((c) => !subIdByCode.has(c)).length;
    return {
      batchId,
      ok: true,
      blocking: [],
      template: a.template,
      file: a.parse,
      summary: {
        pencawang: { create: subCreate, update: pencawangCodes.length - subCreate },
        siteVisits: { create: pencawangCodes.length, update: 0 },
        assets: { create: assetCreate, update: assetUpdate },
        inspections: { create: inspCreate, update: inspUpdate },
        inspectionResults: { create: inspectionResults },
        itemResults: { create: itemResults },
        defects: { create: defects },
        errors: 0,
        warnings,
        rowsSkipped,
      },
      resolution,
      rows: rowReports,
    };
  }

  private async buildResolutionReport(tenantId: string, rows: ParsedRow[]) {
    const emails = [...new Set(rows.map((r) => r.inspectorEmail).filter(Boolean) as string[])];
    const users = await this.prisma.user.findMany({ where: { tenantId, email: { in: emails.map((e) => e.toLowerCase()) } }, select: { id: true, email: true } });
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
    const teamNames = [...new Set(rows.map((r) => r.teamText).filter(Boolean) as string[])];
    const teams = await this.prisma.team.findMany({ where: { tenantId, OR: [{ code: { in: teamNames } }, { name: { in: teamNames } }] }, select: { id: true, name: true, code: true } });
    const mainheadNames = [...new Set(rows.map((r) => r.mainheadText).filter(Boolean) as string[])];
    const mainheads = await this.prisma.mainhead.findMany({ where: { OR: [{ code: { in: mainheadNames } }, { name: { in: mainheadNames } }] }, select: { id: true, name: true, code: true } });

    return {
      users: emails.map((e) => ({ email: e, status: userByEmail.has(e.toLowerCase()) ? 'RESOLVED' : 'FALLBACK', userId: userByEmail.get(e.toLowerCase()) ?? null })),
      teams: teamNames.map((n) => ({ name: n, status: teams.some((t) => t.code === n || t.name === n) ? 'RESOLVED' : 'FALLBACK' })),
      mainheads: mainheadNames.map((n) => ({ name: n, status: mainheads.some((m) => m.code === n || m.name === n) ? 'RESOLVED' : 'UNRESOLVED' })),
    };
  }

  // ---- COMMIT --------------------------------------------------------------

  async commit(user: RequestUser, buffer: Buffer, batchId: string) {
    await this.assertCanImport(user);
    const a = await this.analyze(user, buffer);
    if (!a.ok || !a.template) {
      return { batchId, ok: false, blocking: a.blocking, applied: null };
    }
    const tenantId = user.tenantId;
    const template = await this.resolveTemplate(tenantId);
    const itemsByKey = template.template!.itemsByKey;
    const templateId = template.template!.id;

    const serviceUserId = await this.ensureServiceUser(tenantId);
    const fallbackTeamId = await this.ensureFallbackTeam(tenantId);
    const assetTypeId = await this.resolveSavrAssetTypeId(tenantId);

    // Resolve refs once
    const emails = [...new Set(a.rows.map((r) => r.inspectorEmail).filter(Boolean) as string[])];
    const users = await this.prisma.user.findMany({ where: { tenantId, email: { in: emails.map((e) => e.toLowerCase()) } }, select: { id: true, email: true } });
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
    const resolveUser = (email: string | null) => (email && userByEmail.get(email.toLowerCase())) || serviceUserId;

    const teamNames = [...new Set(a.rows.map((r) => r.teamText).filter(Boolean) as string[])];
    const teams = await this.prisma.team.findMany({ where: { tenantId, OR: [{ code: { in: teamNames } }, { name: { in: teamNames } }] }, select: { id: true, name: true, code: true } });
    const resolveTeam = (name: string | null) => teams.find((t) => t.code === name || t.name === name)?.id ?? fallbackTeamId;

    const mainheadNames = [...new Set(a.rows.map((r) => r.mainheadText).filter(Boolean) as string[])];
    const mainheads = await this.prisma.mainhead.findMany({ where: { OR: [{ code: { in: mainheadNames } }, { name: { in: mainheadNames } }] }, select: { id: true, name: true, code: true } });
    const resolveMainhead = (name: string | null) => mainheads.find((m) => m.code === name || m.name === name)?.id ?? null;

    // Group rows by Pencawang
    const byPencawang = new Map<string, ParsedRow[]>();
    for (const r of a.rows) {
      if (r.errors.length || !r.pencawangCode) continue;
      const list = byPencawang.get(r.pencawangCode) ?? [];
      list.push(r);
      byPencawang.set(r.pencawangCode, list);
    }

    const applied = { pencawang: 0, siteVisits: 0, assets: 0, inspections: 0, inspectionResults: 0, itemResults: 0, defects: 0, qaLockedSkipped: 0, rowsSkipped: a.rows.filter((r) => r.errors.length).length };
    const pencawangResults: { code: string; status: string; assets?: number; inspections?: number; error?: string }[] = [];
    const reportingGroup = buildAppsheetReportingGroup(batchId);

    for (const [code, rows] of byPencawang) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const first = rows[0];
          const substation = await tx.substation.upsert({
            where: { tenantId_code: { tenantId, code } },
            create: { tenantId, code, name: first.pencawangName ?? code, location: this.locationLabel(first) },
            update: { name: first.pencawangName ?? undefined, location: this.locationLabel(first) },
          });

          const teamId = resolveTeam(first.teamText);
          const createdByUserId = resolveUser(first.inspectorEmail);
          const dates = rows.map((r) => r.inspectedAt).filter(Boolean) as Date[];
          const startedAt = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : new Date();
          const completedAt = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : new Date();

          let siteVisit = await tx.siteVisit.findFirst({ where: { tenantId, substationId: substation.id, reportingGroup } });
          if (!siteVisit) {
            siteVisit = await tx.siteVisit.create({
              data: {
                tenantId, teamId, substationId: substation.id, createdByUserId,
                // Foundation data: a finished historical cycle (DISCOVERY = the
                // initial register build), landed straight into ARKIB and dated
                // from the source inspection. "Open next cycle" re-surveys it.
                status: SiteVisitStatus.COMPLETED, visitType: SiteVisitType.DISCOVERY, operationalScope: OperationalScope.SAVR,
                lifecycleStatus: SurveyLifecycleStatus.ARKIB,
                rondaanSelesaiAt: completedAt, laporanSelesaiAt: completedAt, archivedAt: completedAt,
                mainheadId: resolveMainhead(first.mainheadText), mainhead: first.mainheadText ?? undefined,
                pencawangCode: code, pencawangName: first.pencawangName ?? undefined, functionalLocation: first.functionalLocation ?? undefined,
                reportingGroup, startedAt, completedAt, endedAt: completedAt,
                checkInLatitude: first.latitude ?? undefined, checkInLongitude: first.longitude ?? undefined,
              },
            });
            applied.siteVisits++;
          }

          let aCount = 0, iCount = 0;
          for (const row of rows) {
            const asset = await tx.asset.upsert({
              where: { tenantId_substationId_assetCode: { tenantId, substationId: substation.id, assetCode: row.assetCode! } },
              create: {
                tenantId, substationId: substation.id, assetTypeId, assetCode: row.assetCode!,
                name: row.noTiangLama && row.noTiangLama !== 'TNT' ? row.noTiangLama : null,
                latitude: row.latitude ?? undefined, longitude: row.longitude ?? undefined, status: AssetStatus.ACTIVE,
                createdByUserId, createdDuringVisitId: siteVisit.id,
                metadata: this.assetMetadata(row, batchId),
              },
              update: { latitude: row.latitude ?? undefined, longitude: row.longitude ?? undefined, metadata: this.assetMetadata(row, batchId) },
            });
            aCount++;

            await tx.siteVisitAsset.upsert({
              where: { siteVisitId_assetId: { siteVisitId: siteVisit.id, assetId: asset.id } },
              create: { siteVisitId: siteVisit.id, assetId: asset.id, addedByUserId: createdByUserId, source: 'appsheet_import' },
              update: {},
            });

            const externalRef = row.uniqueId ? buildExternalRef(row.uniqueId) : null;
            const inspectorId = resolveUser(row.inspectorEmail);
            const submittedAt = row.inspectedAt ?? new Date();
            let inspection: { id: string };
            if (externalRef) {
              inspection = await tx.inspection.upsert({
                where: { tenantId_externalRef: { tenantId, externalRef } },
                create: { tenantId, siteVisitId: siteVisit.id, assetId: asset.id, templateId, createdByUserId: inspectorId, completionStatus: InspectionCompletionStatus.SUBMITTED, operationMode: OperationMode.INSPECTION, operationalScope: OperationalScope.SAVR, reportingGroup, externalRef, submittedAt },
                update: { siteVisitId: siteVisit.id, assetId: asset.id, templateId, submittedAt, reportingGroup },
              });
            } else {
              inspection = await tx.inspection.findFirst({ where: { tenantId, siteVisitId: siteVisit.id, assetId: asset.id, templateId } })
                ?? await tx.inspection.create({ data: { tenantId, siteVisitId: siteVisit.id, assetId: asset.id, templateId, createdByUserId: inspectorId, completionStatus: InspectionCompletionStatus.SUBMITTED, operationMode: OperationMode.INSPECTION, operationalScope: OperationalScope.SAVR, reportingGroup, submittedAt } });
            }
            iCount++;

            // QA-lock guard: skip rewriting children if any defect has progressed.
            const locked = await tx.defect.count({ where: { inspectionItemResult: { inspectionId: inspection.id }, OR: [{ status: { not: 'OPEN' } }, { lifecycleStatus: { not: null } }] } });
            if (locked > 0) { applied.qaLockedSkipped++; continue; }

            // Replace children (idempotent) — batched to bound round-trips.
            await tx.inspectionItemResult.deleteMany({ where: { inspectionId: inspection.id } }); // cascades Defect
            await tx.inspectionResult.deleteMany({ where: { inspectionId: inspection.id } });

            const itemResultRows: Prisma.InspectionItemResultCreateManyInput[] = [];
            for (const d of row.defects) {
              const item = itemsByKey.get(d.key);
              if (!item) continue;
              itemResultRows.push({
                inspectionId: inspection.id,
                checklistItemId: item.id,
                label: item.label,
                result: d.present ? InspectionItemResultValue.FAIL : InspectionItemResultValue.PASS,
                isDefect: d.present,
                severity: d.present ? item.severity : null,
              });
            }
            if (itemResultRows.length) {
              await tx.inspectionItemResult.createMany({ data: itemResultRows });
              applied.itemResults += itemResultRows.length;
            }

            const failItems = await tx.inspectionItemResult.findMany({
              where: { inspectionId: inspection.id, isDefect: true },
              select: { id: true, severity: true },
            });
            if (failItems.length) {
              await tx.defect.createMany({
                data: failItems.map((f) => ({ inspectionItemResultId: f.id, status: 'OPEN' as const, severity: f.severity ?? DefectSeverity.MEDIUM })),
              });
              applied.defects += failItems.length;
            }

            const resultRows: Prisma.InspectionResultCreateManyInput[] = [];
            for (const v of row.values) {
              if (v.value === null) continue;
              const item = itemsByKey.get(v.key);
              if (!item) continue;
              resultRows.push({ inspectionId: inspection.id, templateItemId: item.id, ...this.valueColumns(v.type, v.value) });
            }
            if (resultRows.length) {
              await tx.inspectionResult.createMany({ data: resultRows });
              applied.inspectionResults += resultRows.length;
            }
          }

          return { aCount, iCount };
        }, { timeout: 120_000, maxWait: 15_000 });

        applied.pencawang++;
        applied.assets += result.aCount;
        applied.inspections += result.iCount;
        pencawangResults.push({ code, status: 'committed', assets: result.aCount, inspections: result.iCount });
      } catch (err) {
        pencawangResults.push({ code, status: 'failed', error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { batchId, ok: pencawangResults.every((p) => p.status === 'committed'), blocking: [], applied, pencawang: pencawangResults };
  }

  // ---- helpers -------------------------------------------------------------

  private valueColumns(
    type: ItemType,
    value: string | number | boolean | string[],
  ): Partial<Pick<Prisma.InspectionResultUncheckedCreateInput, 'valueText' | 'valueNumber' | 'valueBoolean' | 'valueJson'>> {
    switch (type) {
      case 'NUMBER': return { valueNumber: value as number };
      case 'BOOLEAN': return { valueBoolean: value as boolean };
      case 'MULTI_SELECT': return { valueJson: value as Prisma.InputJsonValue };
      case 'SELECT':
      case 'TEXT':
      default: return { valueText: String(value) };
    }
  }

  private locationLabel(row: ParsedRow): string | undefined {
    if (row.latitude !== null && row.longitude !== null) return `${row.latitude}, ${row.longitude}`;
    return undefined;
  }

  private assetMetadata(row: ParsedRow, batchId: string): Prisma.InputJsonValue {
    return {
      appsheet: {
        uniqueId: row.uniqueId,
        noTiangLama: row.noTiangLama,
        inspectorEmail: row.inspectorEmail,
        lastBatchId: batchId,
      },
    };
  }

  private async ensureServiceUser(tenantId: string): Promise<string> {
    const existing = await this.prisma.user.findUnique({ where: { email: SERVICE_USER_EMAIL }, select: { id: true } });
    if (existing) return existing.id;
    const created = await this.prisma.user.create({
      data: { tenantId, email: SERVICE_USER_EMAIL, name: 'AppSheet Import', role: UserRole.VIEWER, isActive: false, passwordHash: await bcrypt.hash(randomUUID(), 10) },
      select: { id: true },
    });
    return created.id;
  }

  private async ensureFallbackTeam(tenantId: string): Promise<string> {
    const team = await this.prisma.team.upsert({
      where: { tenantId_code: { tenantId, code: FALLBACK_TEAM_CODE } },
      create: { tenantId, code: FALLBACK_TEAM_CODE, name: 'AppSheet Import (Unresolved)' },
      update: {},
      select: { id: true },
    });
    return team.id;
  }

  private async resolveSavrAssetTypeId(tenantId: string): Promise<string> {
    const at = await this.prisma.assetType.findFirst({ where: { tenantId, code: 'SAVR' }, select: { id: true } });
    if (at) return at.id;
    const created = await this.prisma.assetType.create({ data: { tenantId, code: 'SAVR', name: 'SAVR', isActive: true }, select: { id: true } });
    return created.id;
  }
}

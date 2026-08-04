import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DefectStatus,
  InspectionCompletionStatus,
  InspectionItemInputType,
  InspectionItemResultValue,
  OperationalScope,
  Prisma,
  SurveyLifecycleStatus,
  UserRole,
} from '@prisma/client';
import { Workbook, Worksheet } from 'exceljs';
import { resolveCanReport } from '../common/authorization/reporting-actor';
import { siteVisitAccessWhere } from '../common/authorization/site-visit-scope';
import { normalizeTemplateSelectOptions } from '../templates/template-builder.constants';
import { RequestUser } from '../common/interfaces/request-user.interface';
import {
  deriveDisplayStatus,
  DISPLAY_STATUS_LABEL,
  type DisplayStatus,
} from '@ascure/shared-utils';
import {
  DEFAULT_OPERATIONAL_SCOPE,
  inferOperationalScopeFromAssetTypeCode,
} from '../common/operational-scope';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  buildMasterlistFilename,
  buildMasterlistWorkbook,
  type MasterlistRawValue,
  type MasterlistRow,
} from './savr-masterlist';

const UPLOADS_URL_PREFIX = '/uploads';

/**
 * Only inspections the system's own screens show: SUBMITTED, or sent back for
 * re-inspection (DRAFT again, but its captured answers still stand) — the same
 * rule as GET /assets/:id. Without this filter the exports also pull true
 * drafts, and Postgres sorts their NULL submittedAt FIRST on `submittedAt:
 * desc`, so the "one row per asset, first wins" pick exports a draft's
 * empty/partial row instead of the pole's submitted inspection.
 */
const EXPORTABLE_INSPECTION_WHERE = {
  OR: [
    { completionStatus: InspectionCompletionStatus.SUBMITTED },
    { reinspectionRequestedAt: { not: null } },
  ],
} satisfies Prisma.InspectionWhereInput;

// The stable Pencawang ref code is `<Mainhead.code><4-digit running number>`.
const MAX_PENCAWANG_REFCODE_SEQ = 9999;

/** Split a ref code into prefix + numeric suffix ("KTN0007" -> {prefix:"KTN", seq:7}). */
function parsePencawangRefCode(
  refCode: string | null,
): { prefix: string; seq: number } | null {
  if (!refCode) {
    return null;
  }
  const match = /^(.+?)(\d{4})$/.exec(refCode);
  if (!match) {
    return null;
  }
  const seq = Number.parseInt(match[2], 10);
  if (!Number.isFinite(seq)) {
    return null;
  }
  return { prefix: match[1], seq };
}

// Defect statuses that no longer count as "open" for the asset summary rollup.
const CLOSED_DEFECT_STATUSES: ReadonlySet<DefectStatus> = new Set([
  DefectStatus.RESOLVED,
  DefectStatus.CLOSED,
]);

const inspectionInclude = {
  asset: {
    select: {
      id: true,
      assetCode: true,
      name: true,
      status: true,
      latitude: true,
      longitude: true,
      assetType: { select: { code: true, name: true } },
    },
  },
  siteVisit: {
    select: {
      id: true,
      status: true,
      visitType: true,
      startedAt: true,
      completedAt: true,
      pencawangCode: true,
      pencawangName: true,
    },
  },
  template: { select: { id: true, name: true, version: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  itemResults: {
    orderBy: { createdAt: 'asc' },
    include: {
      defect: {
        select: {
          id: true,
          status: true,
          severity: true,
          lifecycleStatus: true,
          resolutionOutcome: true,
          actionRemark: true,
          dueDate: true,
          resolvedAt: true,
          closedAt: true,
          createdAt: true,
          assignedToUser: { select: { name: true } },
          assignedToTeam: { select: { name: true } },
          verifiedByUser: { select: { name: true } },
          evidenceImages: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              fileName: true,
              url: true,
              storageKey: true,
              evidenceType: true,
              note: true,
              latitude: true,
              longitude: true,
              timestamp: true,
              createdAt: true,
            },
          },
        },
      },
    },
  },
  results: {
    include: {
      templateItem: {
        select: { key: true, label: true, inputType: true, sortOrder: true },
      },
    },
  },
  inspectionImages: {
    orderBy: { createdAt: 'asc' },
  },
  images: {
    select: {
      id: true,
      fileName: true,
      url: true,
      storageKey: true,
      inspectionResultId: true,
      createdAt: true,
    },
  },
} satisfies Prisma.InspectionInclude;

type SubstationSummary = {
  id: string;
  code: string;
  name: string;
  location: string | null;
};

type AssetRecord = Prisma.AssetGetPayload<{
  include: { assetType: { select: { code: true; name: true } } };
}>;

type InspectionRecord = Prisma.InspectionGetPayload<{
  include: typeof inspectionInclude;
}>;

type InspectionResultRecord = InspectionRecord['results'][number];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  private async assertCanReport(user: RequestUser): Promise<void> {
    const allowed = await resolveCanReport(this.usersService, user);

    if (!allowed) {
      throw new ForbiddenException(
        'REPORTING capability is required to access reports.',
      );
    }
  }

  // Crew performance is a manager function (monitor + pay own crew), gated by
  // role rather than the REPORTING capability.
  private assertCanViewCrewPerformance(user: RequestUser) {
    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
      return;
    }
    throw new ForbiddenException(
      'Only a manager or administrator can view crew performance.',
    );
  }

  // Reporting day boundaries use UTC+8 (Malaysia), matching the daily dashboard.
  private static readonly CREW_PERF_OFFSET_MIN = 480;

  private crewPerfDateKey(date: Date): string {
    const shifted = new Date(
      date.getTime() + ReportsService.CREW_PERF_OFFSET_MIN * 60_000,
    );
    return shifted.toISOString().slice(0, 10);
  }

  private resolvePerformancePeriod(fromInput?: string, toInput?: string) {
    const offsetMs = ReportsService.CREW_PERF_OFFSET_MIN * 60_000;
    const parseDay = (value: string): number | null => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
      if (!match) {
        return null;
      }
      return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    };

    if (fromInput && toInput) {
      const from = parseDay(fromInput);
      const to = parseDay(toInput);
      if (from == null || to == null || to < from) {
        throw new BadRequestException(
          'Provide a valid from/to date range (YYYY-MM-DD).',
        );
      }
      return {
        start: new Date(from - offsetMs),
        end: new Date(to + 24 * 60 * 60 * 1000 - offsetMs),
        label: `${fromInput} to ${toInput}`,
      };
    }

    // Default: the current calendar month (UTC+8).
    const nowShifted = new Date(Date.now() + offsetMs);
    const year = nowShifted.getUTCFullYear();
    const month = nowShifted.getUTCMonth();
    return {
      start: new Date(Date.UTC(year, month, 1) - offsetMs),
      end: new Date(Date.UTC(year, month + 1, 1) - offsetMs),
      label: `${year}-${String(month + 1).padStart(2, '0')}`,
    };
  }

  /**
   * Per-user output over a period (default: this month, UTC+8), scoped to the
   * caller's own company (a MANAGER never sees another company's crew). The
   * headline pay metric is distinct assets inspected; supporting columns are
   * submitted inspections, distinct visits, and active days.
   */
  async aggregateCrewPerformance(
    user: RequestUser,
    fromInput?: string,
    toInput?: string,
  ) {
    this.assertCanViewCrewPerformance(user);
    const { start, end, label } = this.resolvePerformancePeriod(fromInput, toInput);

    const inspections = await this.prisma.inspection.findMany({
      where: {
        tenantId: user.tenantId,
        completionStatus: InspectionCompletionStatus.SUBMITTED,
        submittedAt: { gte: start, lt: end },
        siteVisit: siteVisitAccessWhere(user),
      },
      select: {
        assetId: true,
        siteVisitId: true,
        createdByUserId: true,
        submittedAt: true,
      },
    });

    type Aggregate = {
      assets: Set<string>;
      visits: Set<string>;
      days: Set<string>;
      inspections: number;
    };
    const byUser = new Map<string, Aggregate>();
    for (const row of inspections) {
      let aggregate = byUser.get(row.createdByUserId);
      if (!aggregate) {
        aggregate = {
          assets: new Set(),
          visits: new Set(),
          days: new Set(),
          inspections: 0,
        };
        byUser.set(row.createdByUserId, aggregate);
      }
      aggregate.assets.add(row.assetId);
      aggregate.visits.add(row.siteVisitId);
      aggregate.inspections += 1;
      if (row.submittedAt) {
        aggregate.days.add(this.crewPerfDateKey(row.submittedAt));
      }
    }

    const userIds = Array.from(byUser.keys());
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            team: { select: { name: true, code: true } },
          },
        })
      : [];
    const userById = new Map(users.map((row) => [row.id, row]));

    const rows = userIds
      .map((id) => {
        const record = userById.get(id);
        const aggregate = byUser.get(id)!;
        return {
          userId: id,
          name: record?.name?.trim() || record?.email || 'Unknown user',
          email: record?.email ?? null,
          role: record?.role ?? null,
          teamName:
            record?.team?.name?.trim() || record?.team?.code?.trim() || null,
          assetsInspected: aggregate.assets.size,
          submittedInspections: aggregate.inspections,
          visits: aggregate.visits.size,
          activeDays: aggregate.days.size,
        };
      })
      .sort(
        (left, right) =>
          right.assetsInspected - left.assetsInspected ||
          left.name.localeCompare(right.name),
      );

    return {
      period: label,
      from: start.toISOString(),
      to: end.toISOString(),
      totalAssetsInspected: rows.reduce(
        (total, row) => total + row.assetsInspected,
        0,
      ),
      users: rows,
      generatedAt: new Date().toISOString(),
    };
  }

  /** XLSX export of {@link aggregateCrewPerformance} (the manager's pay sheet). */
  async buildCrewPerformance(
    user: RequestUser,
    fromInput?: string,
    toInput?: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.aggregateCrewPerformance(user, fromInput, toInput);

    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('CREW PERFORMANCE');
    sheet.addRow([`Crew performance — ${data.period}`]);
    sheet.addRow([]);
    const header = sheet.addRow([
      'No',
      'Name',
      'Email',
      'Role',
      'Team',
      'Assets Inspected',
      'Submitted Inspections',
      'Visits',
      'Active Days',
    ]);
    header.font = { bold: true };

    data.users.forEach((row, index) => {
      sheet.addRow([
        index + 1,
        row.name,
        row.email ?? '',
        row.role ?? '',
        row.teamName ?? '',
        row.assetsInspected,
        row.submittedInspections,
        row.visits,
        row.activeDays,
      ]);
    });

    sheet.addRow([]);
    const totalRow = sheet.addRow([
      '',
      'TOTAL',
      '',
      '',
      '',
      data.totalAssetsInspected,
    ]);
    totalRow.font = { bold: true };

    for (let column = 1; column <= 9; column += 1) {
      sheet.getColumn(column).width = column === 2 || column === 3 ? 26 : 16;
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const filename = `crew-performance-${data.period.replace(/[^\dA-Za-z-]+/g, '_')}.xlsx`;
    return { buffer: Buffer.from(arrayBuffer), filename };
  }

  /** Pencawang (substation) options for the report selector — tenant scoped.
   *  Each carries its MAINHEAD (for the report page's mainhead filter). A
   *  Substation isn't linked to a MAINHEAD directly, so it's derived from the
   *  Pencawang's site visits (linked MAINHEAD record, else free-text), taking
   *  the most recent visit's. */
  async listSubstations(user: RequestUser) {
    await this.assertCanReport(user);

    const substations = await this.prisma.substation.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        code: true,
        refCode: true,
        name: true,
        location: true,
        _count: { select: { assets: true } },
      },
    });

    if (substations.length === 0) {
      return [];
    }

    const visits = await this.prisma.siteVisit.findMany({
      where: {
        tenantId: user.tenantId,
        substationId: { in: substations.map((s) => s.id) },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        substationId: true,
        status: true,
        mainhead: true,
        mainheadRecord: { select: { name: true } },
        lifecycleStatus: true,
        checkInLatitude: true,
        checkInLongitude: true,
        // Presence only — enough to know the visit carries a compiled report.
        reports: { select: { id: true }, take: 1 },
      },
    });

    const mainheadBySubstation = new Map<string, string>();
    // Every lifecycle status seen for a Pencawang (across cycles) so the report
    // UI can narrow the Pencawang list by survey status.
    const statusesBySubstation = new Map<string, Set<SurveyLifecycleStatus>>();
    // The current survey's unified status + the Pencawang's coordinate (its most
    // recent visit's check-in GPS) — the report table's Status + Lokasi columns.
    const displayStatusBySubstation = new Map<string, DisplayStatus>();
    const coordsBySubstation = new Map<
      string,
      { latitude: number; longitude: number }
    >();
    // The most recent visit that actually HAS a compiled visual report — NOT
    // simply the most recent visit. A re-surveyed Pencawang's newest cycle has no
    // report yet while an older completed cycle still holds the only PDF, so
    // keying the download off the latest visit would hide an existing report.
    const reportVisitBySubstation = new Map<string, string>();
    for (const visit of visits) {
      if (visit.lifecycleStatus) {
        let statuses = statusesBySubstation.get(visit.substationId);
        if (!statuses) {
          statuses = new Set<SurveyLifecycleStatus>();
          statusesBySubstation.set(visit.substationId, statuses);
        }
        statuses.add(visit.lifecycleStatus);
      }

      // First seen per Pencawang = most recent (ordered desc): its current status.
      if (!displayStatusBySubstation.has(visit.substationId)) {
        displayStatusBySubstation.set(
          visit.substationId,
          deriveDisplayStatus(visit.status, visit.lifecycleStatus),
        );
      }

      // First visit (most recent) that carries a check-in fix = the Pencawang point.
      if (
        !coordsBySubstation.has(visit.substationId) &&
        visit.checkInLatitude != null &&
        visit.checkInLongitude != null
      ) {
        coordsBySubstation.set(visit.substationId, {
          latitude: visit.checkInLatitude,
          longitude: visit.checkInLongitude,
        });
      }

      // First (most recent) visit carrying a report wins.
      if (
        visit.reports.length > 0 &&
        !reportVisitBySubstation.has(visit.substationId)
      ) {
        reportVisitBySubstation.set(visit.substationId, visit.id);
      }

      const name = (visit.mainheadRecord?.name ?? visit.mainhead ?? '').trim();
      if (name && !mainheadBySubstation.has(visit.substationId)) {
        mainheadBySubstation.set(visit.substationId, name);
      }
    }

    return substations.map(({ _count, ...substation }) => {
      const displayStatus = displayStatusBySubstation.get(substation.id) ?? null;
      const coords = coordsBySubstation.get(substation.id) ?? null;
      const reportVisitId = reportVisitBySubstation.get(substation.id) ?? null;
      return {
        ...substation,
        mainhead: mainheadBySubstation.get(substation.id) ?? null,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        displayStatus,
        displayStatusLabel: displayStatus
          ? DISPLAY_STATUS_LABEL[displayStatus]
          : null,
        statuses: [...(statusesBySubstation.get(substation.id) ?? [])],
        assetCount: _count.assets,
        // Drives the "Visual Report" download button (null => nothing compiled).
        reportVisitId,
        hasReport: reportVisitId != null,
      };
    });
  }

  /**
   * DC master-reference export: a flat list of every accessible Pencawang with its
   * readable Pencawang Code, Nama Pencawang, Functional Location and lat/long.
   * Pencawang Code = the stable `<Mainhead.code><NNNN>` ref code (blank until the
   * Pencawang has a coded Mainhead). Lat/long = the most recent site-visit check-in
   * GPS (from listSubstations); BLANK when never visited = a "not yet surveyed"
   * flag. Assigns any missing ref codes first, then reads. Tenant + access scoped.
   */
  async buildPencawangList(
    user: RequestUser,
  ): Promise<{ buffer: Buffer; filename: string }> {
    // Assign a stable ref code to any newly-eligible Pencawang first. Best-effort:
    // a hiccup here must NEVER break the download — uncoded rows just come out blank.
    try {
      await this.ensurePencawangRefCodes(user);
    } catch (error) {
      new Logger(ReportsService.name).warn(
        `ensurePencawangRefCodes failed before export: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const substations = await this.listSubstations(user);

    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('PENCAWANG');
    const header = sheet.addRow([
      'No',
      'Pencawang Code',
      'Nama Pencawang',
      'Functional Location',
      'Latitude',
      'Longitude',
    ]);
    header.font = { bold: true };

    substations.forEach((substation, index) => {
      sheet.addRow([
        index + 1,
        // Blank until the Pencawang has a Mainhead whose code is set.
        substation.refCode ?? '',
        substation.name ?? '',
        substation.location ?? '',
        // Blank when never visited (no check-in GPS) — an empty coordinate flags a
        // Pencawang that has not been surveyed. Numeric otherwise.
        substation.latitude ?? '',
        substation.longitude ?? '',
      ]);
    });

    const columnWidths = [6, 16, 34, 34, 14, 14];
    columnWidths.forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `pencawang-list-${stamp}.xlsx`;
    return { buffer: Buffer.from(arrayBuffer), filename };
  }

  /**
   * Assign a stable ref code `<Mainhead.code><NNNN>` (e.g. KTN0001) to every
   * accessible Pencawang that has a Mainhead-with-a-code but no code yet.
   * Properties (why it's a dependable identifier for DC):
   *  - IMMUTABLE: a code is assigned once and never changes; other Pencawang are
   *    never renumbered and mid-sequence gaps (from a delete) are never back-filled.
   *    The next number = max(existing seq)+1, so the ONE reuse case is hard-deleting
   *    the HIGHEST-numbered Pencawang for a prefix and then adding a new one (rare —
   *    deletes are mostly dummy cleanup; a per-prefix counter table would close it
   *    if absolute never-reuse is ever needed).
   *  - BLANK when the Pencawang has no Mainhead, or its Mainhead has no code.
   *  - IDEMPOTENT: only touches Pencawang missing a code, so it's safe to run before
   *    every export (new Pencawang get coded automatically).
   * Numbering is PER-TENANT and keyed on the prefix STRING (not the Mainhead id), so
   * codes stay unique even if two Mainheads share a code. Max 9999 per prefix.
   */
  async ensurePencawangRefCodes(user: RequestUser): Promise<{ assigned: number }> {
    await this.assertCanReport(user);

    // Newly-eligible: a Mainhead with a code, and no ref code yet. Oldest first so
    // the lower numbers are stable across runs.
    const eligible = await this.prisma.substation.findMany({
      where: {
        tenantId: user.tenantId,
        refCode: null,
        mainhead: { is: { code: { not: null } } },
      },
      select: { id: true, mainhead: { select: { code: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (eligible.length === 0) {
      return { assigned: 0 };
    }

    // Highest existing sequence per prefix across ALL tenant ref codes, so new
    // numbers never collide (even across two Mainheads that share a code).
    const existing = await this.prisma.substation.findMany({
      where: { tenantId: user.tenantId, refCode: { not: null } },
      select: { refCode: true },
    });
    const maxByPrefix = new Map<string, number>();
    for (const row of existing) {
      const parsed = parsePencawangRefCode(row.refCode);
      if (!parsed) {
        continue;
      }
      maxByPrefix.set(
        parsed.prefix,
        Math.max(maxByPrefix.get(parsed.prefix) ?? 0, parsed.seq),
      );
    }

    let assigned = 0;
    for (const sub of eligible) {
      const prefix = (sub.mainhead?.code ?? '').trim().toUpperCase();
      if (!prefix) {
        continue; // Mainhead code blank -> leave this Pencawang uncoded.
      }

      const next = (maxByPrefix.get(prefix) ?? 0) + 1;
      if (next > MAX_PENCAWANG_REFCODE_SEQ) {
        continue; // 9999 exhausted for this prefix -> leave blank (extremely unlikely).
      }

      const refCode = `${prefix}${String(next).padStart(4, '0')}`;
      try {
        await this.prisma.substation.update({
          where: { id: sub.id },
          data: { refCode },
        });
        maxByPrefix.set(prefix, next);
        assigned += 1;
      } catch (error) {
        // A concurrent export grabbed this number — advance past it and let the
        // next run code this Pencawang. Only swallow the unique-collision.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          maxByPrefix.set(prefix, next);
          continue;
        }
        throw error;
      }
    }

    return { assigned };
  }

  /**
   * Builds the per-Pencawang SAVR **masterlist** (wide format: metadata columns
   * + one column per checklist item, 1 pole = 1 row) — the inverse of the F2
   * AppSheet importer, so the file round-trips back through it. Read-only,
   * tenant scoped, SAVR assets only, optionally filtered by the survey
   * lifecycle status of the asset's visit.
   */
  async buildPencawangMasterlist(
    user: RequestUser,
    substationId: string,
    lifecycleStatus?: SurveyLifecycleStatus,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertCanReport(user);

    const substation = await this.prisma.substation.findFirst({
      where: { id: substationId, tenantId: user.tenantId },
      select: { id: true, code: true, name: true },
    });
    if (!substation) {
      throw new NotFoundException('Pencawang (substation) not found.');
    }

    const inspections = await this.prisma.inspection.findMany({
      where: {
        tenantId: user.tenantId,
        asset: { substationId },
        ...EXPORTABLE_INSPECTION_WHERE,
        ...(lifecycleStatus ? { siteVisit: { lifecycleStatus } } : {}),
      },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        assetId: true,
        templateId: true,
        externalRef: true,
        operationalScope: true,
        submittedAt: true,
        createdAt: true,
        createdBy: { select: { email: true } },
        siteVisit: {
          select: {
            pencawangName: true,
            pencawangCode: true,
            functionalLocation: true,
            mainhead: true,
            mainheadRecord: { select: { name: true } },
            team: { select: { name: true, code: true } },
          },
        },
        asset: {
          select: {
            assetCode: true,
            noTiangLama: true,
            latitude: true,
            longitude: true,
            assetType: { select: { operationalScope: true, code: true } },
          },
        },
        itemResults: {
          select: { checklistItemId: true, label: true, isDefect: true },
        },
        results: {
          select: {
            templateItemId: true,
            valueText: true,
            valueNumber: true,
            valueBoolean: true,
            valueJson: true,
            valueDate: true,
            valueDateTime: true,
          },
        },
      },
    });

    // SAVR only — resolve scope the same way the rest of the system does
    // (inspection → asset type's scope → inferred from the type code), since an
    // asset type may not have operationalScope set explicitly.
    const savrInspections = inspections.filter(
      (insp) =>
        (insp.operationalScope ??
          insp.asset.assetType?.operationalScope ??
          inferOperationalScopeFromAssetTypeCode(
            insp.asset.assetType?.code,
          )) === OperationalScope.SAVR,
    );

    // One row per asset = its latest matching inspection (list is newest-first).
    const latestByAsset = new Map<string, (typeof savrInspections)[number]>();
    for (const insp of savrInspections) {
      if (!latestByAsset.has(insp.assetId)) {
        latestByAsset.set(insp.assetId, insp);
      }
    }
    const chosen = [...latestByAsset.values()];

    // Map template-item id/label → key across every referenced template version.
    const templateIds = [...new Set(chosen.map((i) => i.templateId))];
    const templateItems = templateIds.length
      ? await this.prisma.inspectionTemplateItem.findMany({
          where: { templateId: { in: templateIds } },
          select: { id: true, key: true, label: true },
        })
      : [];
    const keyById = new Map(templateItems.map((i) => [i.id, i.key]));
    const keyByLabel = new Map(
      templateItems.map((i) => [normLabel(i.label), i.key]),
    );
    const idsByLabel = new Map<string, string[]>();
    for (const item of templateItems) {
      const n = normLabel(item.label);
      const list = idsByLabel.get(n) ?? [];
      list.push(item.id);
      idsByLabel.set(n, list);
    }

    const rows: MasterlistRow[] = chosen
      .map((insp): MasterlistRow => {
        // Which template items still carry a live value vs. were CLEARED (row
        // exists, every column blank). A cleared value withdraws the item's
        // verdict — same rule as overlayItemResult — so its defect mark must
        // not export while the system shows nothing.
        const valuedIds = new Set<string>();
        const clearedIds = new Set<string>();
        for (const r of insp.results) {
          (hasRecordedValue(r) ? valuedIds : clearedIds).add(r.templateItemId);
        }

        const defectKeys = new Set<string>();
        for (const ir of insp.itemResults) {
          if (!ir.isDefect) {
            continue;
          }
          const candidateIds = ir.checklistItemId
            ? [ir.checklistItemId]
            : idsByLabel.get(normLabel(ir.label)) ?? [];
          const withdrawn =
            candidateIds.some((id) => clearedIds.has(id)) &&
            !candidateIds.some((id) => valuedIds.has(id));
          if (withdrawn) {
            continue;
          }
          const key =
            (ir.checklistItemId
              ? keyById.get(ir.checklistItemId)
              : undefined) ?? keyByLabel.get(normLabel(ir.label));
          if (key) {
            defectKeys.add(key);
          }
        }

        const valuesByKey = new Map<string, MasterlistRawValue>();
        for (const r of insp.results) {
          const key = keyById.get(r.templateItemId);
          if (!key) {
            continue;
          }
          valuesByKey.set(key, {
            text: r.valueText ?? null,
            number: r.valueNumber != null ? r.valueNumber.toNumber() : null,
            bool: r.valueBoolean ?? null,
            json: r.valueJson ?? null,
          });
        }

        const lat = insp.asset.latitude;
        const lng = insp.asset.longitude;
        return {
          uniqueId: reverseExternalRef(insp.externalRef),
          userEmail: insp.createdBy?.email ?? '',
          // Live entity names first (what every screen shows); the visit's
          // free-text snapshot — frozen at visit creation and copied forward on
          // re-survey — is only a fallback, so a renamed Pencawang/Mainhead or
          // a moved pole exports the same name the system displays.
          mainhead:
            insp.siteVisit?.mainheadRecord?.name ??
            insp.siteVisit?.mainhead ??
            '',
          team: insp.siteVisit?.team?.name ?? insp.siteVisit?.team?.code ?? '',
          functionalLocation: insp.siteVisit?.functionalLocation ?? '',
          location: lat != null && lng != null ? `${lat}, ${lng}` : '',
          pencawangName: substation.name || insp.siteVisit?.pencawangName || '',
          pencawangCode: substation.code || insp.siteVisit?.pencawangCode || '',
          assetCode: insp.asset.assetCode,
          noTiangLama: insp.asset.noTiangLama ?? '',
          date: insp.submittedAt ?? insp.createdAt ?? null,
          dateTime: insp.submittedAt ?? insp.createdAt ?? null,
          defectKeys,
          valuesByKey,
        };
      })
      .sort((a, b) => a.assetCode.localeCompare(b.assetCode));

    const buffer = await buildMasterlistWorkbook(rows);
    const filename = buildMasterlistFilename(substation.name || substation.code);
    return { buffer, filename };
  }

  /**
   * Per-Pencawang "Download Checklist" export (1 pole = 1 row). Scoped by survey
   * type (`scope`, default SAVR):
   *  - SAVR uses the owner's fixed column arrangement ("SUSUNAN UNTUK ML
   *    DOWNLOAD"; the KUANTAN mainhead has its own list) — the fixed block below.
   *  - SAVT (and any other scope) follows the LIVE checklist template: one column
   *    per template item, in the template's own order, so editing the checklist
   *    template changes the report.
   * Read-only, tenant scoped, optionally filtered by the survey lifecycle status
   * of the asset's visit.
   */
  async buildPencawangTemplateMasterlist(
    user: RequestUser,
    substationId: string,
    lifecycleStatus?: SurveyLifecycleStatus,
    scope: OperationalScope = OperationalScope.SAVR,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertCanReport(user);

    const substation = await this.prisma.substation.findFirst({
      where: { id: substationId, tenantId: user.tenantId },
      select: { id: true, code: true, name: true },
    });
    if (!substation) {
      throw new NotFoundException('Pencawang (substation) not found.');
    }

    const inspections = await this.prisma.inspection.findMany({
      where: {
        tenantId: user.tenantId,
        asset: { substationId },
        ...EXPORTABLE_INSPECTION_WHERE,
        ...(lifecycleStatus ? { siteVisit: { lifecycleStatus } } : {}),
      },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        assetId: true,
        templateId: true,
        operationalScope: true,
        submittedAt: true,
        createdAt: true,
        createdBy: { select: { email: true } },
        template: { select: { name: true, version: true } },
        siteVisit: {
          select: {
            pencawangName: true,
            pencawangCode: true,
            mainhead: true,
            mainheadRecord: { select: { name: true } },
            team: { select: { name: true, code: true } },
          },
        },
        asset: {
          select: {
            assetCode: true,
            name: true,
            noTiangLama: true,
            latitude: true,
            longitude: true,
            assetType: { select: { code: true, name: true, operationalScope: true } },
          },
        },
        itemResults: {
          select: {
            checklistItemId: true,
            label: true,
            result: true,
            isDefect: true,
          },
        },
        results: {
          select: {
            templateItemId: true,
            valueText: true,
            valueNumber: true,
            valueBoolean: true,
            valueJson: true,
            valueDate: true,
            valueDateTime: true,
          },
        },
      },
    });

    // Filter to the requested survey type (SAVR default). Resolve each
    // inspection's scope the way the rest of the system does, defaulting an
    // unresolved asset to SAVR — so a normal Pencawang's SAVR checklist is
    // unchanged and only assets that clearly resolve to another scope (e.g.
    // SAVT) are split out.
    const scoped = inspections.filter(
      (insp) =>
        (insp.operationalScope ??
          insp.asset.assetType?.operationalScope ??
          inferOperationalScopeFromAssetTypeCode(insp.asset.assetType?.code) ??
          DEFAULT_OPERATIONAL_SCOPE) === scope,
    );

    // One row per asset = its latest inspection (the list is newest-first).
    const latestByAsset = new Map<string, (typeof scoped)[number]>();
    for (const insp of scoped) {
      if (!latestByAsset.has(insp.assetId)) {
        latestByAsset.set(insp.assetId, insp);
      }
    }
    const chosen = [...latestByAsset.values()].sort((a, b) =>
      a.asset.assetCode.localeCompare(b.asset.assetCode),
    );

    // Columns = the actual template items used. Dedup by key (stable across
    // template versions); keep the first label/order seen, and remember every
    // item id that maps to the column so values recorded under any version
    // line up under one header.
    const templateIds = [...new Set(chosen.map((i) => i.templateId))];
    const templateItems = templateIds.length
      ? await this.prisma.inspectionTemplateItem.findMany({
          where: { templateId: { in: templateIds } },
          select: {
            id: true,
            key: true,
            label: true,
            sortOrder: true,
            inputType: true,
          },
          orderBy: { sortOrder: 'asc' },
        })
      : [];

    // The dynamic (non-SAVR) layout derives its columns WITH options via
    // deriveTemplateColumns further below; the fetch above still feeds the
    // fixed SAVR label map (itemsByLabel).

    // --- Owner's fixed SAVR arrangement ("SUSUNAN UNTUK ML DOWNLOAD") ---------
    // Every SAVR mainhead uses the fixed column layout; the MAINHEAD named
    // "KUANTAN" keeps the dynamic, template-driven layout below (unchanged).
    // Item columns are matched to the live template items BY (normalized) LABEL,
    // so a label that differs from the template's will come through blank — the
    // headers in SAVR_FIXED_ITEM_LABELS were taken verbatim from a real export.
    const itemsByLabel = new Map<
      string,
      { inputType: InspectionItemInputType; itemIds: Set<string> }
    >();
    for (const item of templateItems) {
      const norm = normalizeChecklistLabel(item.label);
      const existing = itemsByLabel.get(norm);
      if (existing) {
        existing.itemIds.add(item.id);
      } else {
        itemsByLabel.set(norm, {
          inputType: item.inputType,
          itemIds: new Set([item.id]),
        });
      }
    }

    const isKuantanMainhead =
      normalizeChecklistLabel(resolveExportMainheadName(chosen)) ===
      KUANTAN_MAINHEAD_NAME;

    // Both KUANTAN and every other SAVR mainhead use a FIXED column arrangement
    // ("SUSUNAN UNTUK ML DOWNLOAD"); only the item-label list differs — KUANTAN
    // follows the owner's PE_DC_TESTING sample (KUANTAN_FIXED_ITEM_LABELS), the
    // rest use SAVR_FIXED_ITEM_LABELS. Item columns map to live template items by
    // normalized label, so a renamed item comes through blank. (The dynamic,
    // template-driven block further below is retained as a fallback but is no
    // longer reached for SAVR exports.)
    const fixedItemLabels = isKuantanMainhead
      ? KUANTAN_FIXED_ITEM_LABELS
      : SAVR_FIXED_ITEM_LABELS;
    // A fixed arrangement is defined only for SAVR (the owner's "SUSUNAN UNTUK ML
    // DOWNLOAD"). SAVT — and any other scope — falls through to the dynamic,
    // template-driven block below, which follows the live checklist template.
    if (scope === OperationalScope.SAVR && fixedItemLabels.length > 0) {
      const fixedWorkbook = new Workbook();
      fixedWorkbook.creator = 'ASCURE';
      fixedWorkbook.created = new Date();
      const fixedSheet = fixedWorkbook.addWorksheet('CHECKLIST');
      fixedSheet.addRow([...SAVR_FIXED_META_HEADERS, ...fixedItemLabels]);
      fixedSheet.getRow(1).font = { bold: true };

      for (const insp of chosen) {
        const resultByItemId = new Map<string, (typeof insp.results)[number]>();
        for (const r of insp.results) {
          resultByItemId.set(r.templateItemId, r);
        }
        const verdictByItemId = new Map<string, InspectionItemResultValue>();
        for (const ir of insp.itemResults) {
          if (ir.checklistItemId) {
            verdictByItemId.set(ir.checklistItemId, ir.result);
          }
        }

        const meta: (string | number)[] = [
          sanitizeText(
            insp.siteVisit?.mainheadRecord?.name ?? insp.siteVisit?.mainhead ?? '',
          ),
          sanitizeText(
            insp.siteVisit?.team?.name ?? insp.siteVisit?.team?.code ?? '',
          ),
          formatDate(insp.submittedAt ?? insp.createdAt),
          insp.asset.latitude != null && insp.asset.longitude != null
            ? `${Number(insp.asset.latitude)}, ${Number(insp.asset.longitude)}`
            : '',
          // Live entity name/code first — matches every screen; the visit's
          // frozen snapshot is only a fallback.
          sanitizeText(substation.code || insp.siteVisit?.pencawangCode || ''),
          sanitizeText(substation.name || insp.siteVisit?.pencawangName || ''),
          sanitizeText(insp.asset.assetCode),
          sanitizeText(insp.asset.noTiangLama || insp.asset.name || ''),
        ];

        const itemCells = fixedItemLabels.map((label) => {
          const col = itemsByLabel.get(normalizeChecklistLabel(label));
          if (!col) {
            return '';
          }
          let result: (typeof insp.results)[number] | undefined;
          let verdict: InspectionItemResultValue | undefined;
          for (const id of col.itemIds) {
            if (!result) result = resultByItemId.get(id);
            if (!verdict) verdict = verdictByItemId.get(id);
          }
          return resolveTemplateCell(col.inputType, result, verdict);
        });

        fixedSheet.addRow([...meta, ...itemCells]);
      }

      fixedSheet.columns.forEach((column, index) => {
        column.width = index < SAVR_FIXED_META_HEADERS.length ? 18 : 16;
      });

      const fixedArrayBuffer = await fixedWorkbook.xlsx.writeBuffer();
      const fixedBuffer = Buffer.from(fixedArrayBuffer as ArrayBuffer);
      const fixedSafe =
        (substation.name || substation.code || 'PENCAWANG')
          .replace(/[^A-Za-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || 'PENCAWANG';
      return { buffer: fixedBuffer, filename: `${fixedSafe}_CHECKLIST.xlsx` };
    }

    const META_HEADERS = [
      'Pencawang Code',
      'Pencawang Name',
      // SAVR identity: asset code = NO TIANG RONDAAN, asset name = NO TIANG LAMA
      // (see AddAssetScreen / the No Tiang Lama meta value below).
      'NO TIANG RONDAAN',
      'NO TIANG LAMA',
      'Asset Type',
      'Template',
      'Inspector',
      'Submitted (MYT)',
      'LOCATION',
    ];

    const columns = await this.deriveTemplateColumns(templateIds);

    const workbook = new Workbook();
    workbook.creator = 'ASCURE';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('CHECKLIST');
    // TNB matrix layout: dropdown items span one sub-column per answer with a
    // "1" under the crew's pick (see writeTemplateMatrixHeader).
    writeTemplateMatrixHeader(sheet, META_HEADERS, columns);

    for (const insp of chosen) {
      // Index this inspection's recorded values, defect verdicts and photos by
      // template item id, so each column resolves its cell by field type.
      const resultByItemId = new Map<string, (typeof insp.results)[number]>();
      for (const r of insp.results) {
        resultByItemId.set(r.templateItemId, r);
      }
      const verdictByItemId = new Map<string, InspectionItemResultValue>();
      for (const ir of insp.itemResults) {
        if (ir.checklistItemId) {
          verdictByItemId.set(ir.checklistItemId, ir.result);
        }
      }
      const meta: (string | number)[] = [
        // Live entity name/code first — matches every screen; the visit's
        // frozen snapshot is only a fallback.
        sanitizeText(substation.code || insp.siteVisit?.pencawangCode || ''),
        sanitizeText(substation.name || insp.siteVisit?.pencawangName || ''),
        sanitizeText(insp.asset.assetCode),
        // NO TIANG LAMA: the SAVR mobile workflow captures the painted label as
        // the asset NAME (Asset Code = NO TIANG RONDAAN); only the F2 import
        // populates asset.noTiangLama. Prefer the dedicated field, fall back to
        // the name so field-created poles aren't blank.
        sanitizeText(insp.asset.noTiangLama || insp.asset.name || ''),
        sanitizeText(insp.asset.assetType?.name ?? insp.asset.assetType?.code ?? ''),
        sanitizeText(
          insp.template ? `${insp.template.name} v${insp.template.version}` : '',
        ),
        sanitizeText(insp.createdBy?.email ?? ''),
        formatDateTime(insp.submittedAt ?? insp.createdAt),
        insp.asset.latitude != null && insp.asset.longitude != null
          ? `${Number(insp.asset.latitude)}, ${Number(insp.asset.longitude)}`
          : '',
      ];

      const itemCells = templateMatrixCells(
        columns,
        resultByItemId,
        verdictByItemId,
      );

      sheet.addRow([...meta, ...itemCells]);
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer as ArrayBuffer);
    const safe =
      (substation.name || substation.code || 'PENCAWANG')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'PENCAWANG';
    // SAVR returns from the fixed block above; the dynamic block is reached for
    // SAVT (and any non-SAVR scope), so tag the filename with the scope.
    const scopeTag = scope === OperationalScope.SAVR ? '' : `_${scope}`;
    return { buffer, filename: `${safe}${scopeTag}_CHECKLIST.xlsx` };
  }

  /**
   * Bulk "Download Checklist" for SAVR — every pole across ALL Pencawang in the
   * current filter (a single MAINHEAD, or all of them) merged into ONE sheet,
   * using the same fixed column arrangement as the per-Pencawang export. Rows
   * self-identify via the MAINHEAD / Pencawang Code / Pencawang Name meta columns.
   * Read-only, tenant scoped, optionally filtered by survey lifecycle status.
   */
  async buildBulkPencawangChecklist(
    user: RequestUser,
    mainhead: string | undefined,
    lifecycleStatus?: SurveyLifecycleStatus,
    substationIds?: string[],
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertCanReport(user);

    const mainheadFilter = (mainhead ?? '').trim();
    const allMainheads =
      !mainheadFilter || mainheadFilter.toUpperCase() === 'ALL';
    // Explicit Pencawang selection (checkbox "Download selected") narrows at the DB.
    const idFilter = substationIds?.map((id) => id.trim()).filter(Boolean) ?? [];

    const siteVisitWhere: Prisma.SiteVisitWhereInput = {
      ...(lifecycleStatus ? { lifecycleStatus } : {}),
      ...(idFilter.length ? { substationId: { in: idFilter } } : {}),
    };
    // Tenant-wide pull, narrowed by status/selection at the DB and by scope/mainhead
    // below. A DC bulk export runs occasionally and the filters bound the volume.
    const inspections = await this.prisma.inspection.findMany({
      where: {
        tenantId: user.tenantId,
        ...EXPORTABLE_INSPECTION_WHERE,
        ...(Object.keys(siteVisitWhere).length
          ? { siteVisit: siteVisitWhere }
          : {}),
      },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        assetId: true,
        templateId: true,
        operationalScope: true,
        submittedAt: true,
        createdAt: true,
        siteVisit: {
          select: {
            pencawangName: true,
            pencawangCode: true,
            mainhead: true,
            mainheadRecord: { select: { name: true } },
            team: { select: { name: true, code: true } },
          },
        },
        asset: {
          select: {
            assetCode: true,
            name: true,
            noTiangLama: true,
            latitude: true,
            longitude: true,
            assetType: { select: { code: true, operationalScope: true } },
            // The pole's CURRENT Pencawang — the bulk export's rows must carry
            // the live entity name/code the screens show, not only the visit's
            // frozen snapshot (which had no fallback at all here).
            substation: { select: { name: true, code: true } },
          },
        },
        itemResults: { select: { checklistItemId: true, result: true } },
        results: {
          select: {
            templateItemId: true,
            valueText: true,
            valueNumber: true,
            valueBoolean: true,
            valueJson: true,
            valueDate: true,
            valueDateTime: true,
          },
        },
      },
    });

    // SAVR only, narrowed to the chosen MAINHEAD (resolved exactly as the report
    // UI does: the linked mainhead record name, else the free-text mainhead).
    const scoped = inspections.filter((insp) => {
      const resolvedScope =
        insp.operationalScope ??
        insp.asset.assetType?.operationalScope ??
        inferOperationalScopeFromAssetTypeCode(insp.asset.assetType?.code) ??
        DEFAULT_OPERATIONAL_SCOPE;
      if (resolvedScope !== OperationalScope.SAVR) {
        return false;
      }
      if (allMainheads) {
        return true;
      }
      const name = (
        insp.siteVisit?.mainheadRecord?.name ??
        insp.siteVisit?.mainhead ??
        ''
      ).trim();
      return name === mainheadFilter;
    });

    // One row per asset = its latest inspection (list is newest-first); grouped by
    // Pencawang then pole code so each Pencawang's poles stay together.
    const latestByAsset = new Map<string, (typeof scoped)[number]>();
    for (const insp of scoped) {
      if (!latestByAsset.has(insp.assetId)) {
        latestByAsset.set(insp.assetId, insp);
      }
    }
    const chosen = [...latestByAsset.values()].sort((a, b) => {
      const pa =
        a.asset.substation?.name ?? a.siteVisit?.pencawangName ?? '';
      const pb =
        b.asset.substation?.name ?? b.siteVisit?.pencawangName ?? '';
      return (
        pa.localeCompare(pb) || a.asset.assetCode.localeCompare(b.asset.assetCode)
      );
    });

    // Map live template items by normalized label (as the per-Pencawang fixed
    // export does) so the fixed columns line up across every Pencawang's template.
    const templateIds = [...new Set(chosen.map((i) => i.templateId))];
    const templateItems = templateIds.length
      ? await this.prisma.inspectionTemplateItem.findMany({
          where: { templateId: { in: templateIds } },
          select: { id: true, label: true, inputType: true },
        })
      : [];
    const itemsByLabel = new Map<
      string,
      { inputType: InspectionItemInputType; itemIds: Set<string> }
    >();
    for (const item of templateItems) {
      const norm = normalizeChecklistLabel(item.label);
      const existing = itemsByLabel.get(norm);
      if (existing) {
        existing.itemIds.add(item.id);
      } else {
        itemsByLabel.set(norm, {
          inputType: item.inputType,
          itemIds: new Set([item.id]),
        });
      }
    }

    // A single MAINHEAD picks its fixed item list (KUANTAN has its own); "all
    // mainheads" falls back to the standard SAVR-KLB layout — KUANTAN-only items
    // simply map blank there.
    const fixedItemLabels =
      !allMainheads &&
      normalizeChecklistLabel(mainheadFilter) === KUANTAN_MAINHEAD_NAME
        ? KUANTAN_FIXED_ITEM_LABELS
        : SAVR_FIXED_ITEM_LABELS;

    const workbook = new Workbook();
    workbook.creator = 'ASCURE';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('CHECKLIST');
    sheet.addRow([...SAVR_FIXED_META_HEADERS, ...fixedItemLabels]);
    sheet.getRow(1).font = { bold: true };

    for (const insp of chosen) {
      const resultByItemId = new Map<string, (typeof insp.results)[number]>();
      for (const r of insp.results) {
        resultByItemId.set(r.templateItemId, r);
      }
      const verdictByItemId = new Map<string, InspectionItemResultValue>();
      for (const ir of insp.itemResults) {
        if (ir.checklistItemId) {
          verdictByItemId.set(ir.checklistItemId, ir.result);
        }
      }

      const meta: (string | number)[] = [
        sanitizeText(
          insp.siteVisit?.mainheadRecord?.name ?? insp.siteVisit?.mainhead ?? '',
        ),
        sanitizeText(
          insp.siteVisit?.team?.name ?? insp.siteVisit?.team?.code ?? '',
        ),
        formatDate(insp.submittedAt ?? insp.createdAt),
        insp.asset.latitude != null && insp.asset.longitude != null
          ? `${Number(insp.asset.latitude)}, ${Number(insp.asset.longitude)}`
          : '',
        // The pole's CURRENT Pencawang first (matches the screens); the visit
        // snapshot only fills in if the relation is somehow missing.
        sanitizeText(
          insp.asset.substation?.code ?? insp.siteVisit?.pencawangCode ?? '',
        ),
        sanitizeText(
          insp.asset.substation?.name ?? insp.siteVisit?.pencawangName ?? '',
        ),
        sanitizeText(insp.asset.assetCode),
        sanitizeText(insp.asset.noTiangLama || insp.asset.name || ''),
      ];

      const itemCells = fixedItemLabels.map((label) => {
        const col = itemsByLabel.get(normalizeChecklistLabel(label));
        if (!col) {
          return '';
        }
        let result: (typeof insp.results)[number] | undefined;
        let verdict: InspectionItemResultValue | undefined;
        for (const id of col.itemIds) {
          if (!result) result = resultByItemId.get(id);
          if (!verdict) verdict = verdictByItemId.get(id);
        }
        return resolveTemplateCell(col.inputType, result, verdict);
      });

      sheet.addRow([...meta, ...itemCells]);
    }

    sheet.columns.forEach((column, index) => {
      column.width = index < SAVR_FIXED_META_HEADERS.length ? 18 : 16;
    });

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer as ArrayBuffer);
    const base = allMainheads ? 'ALL_PENCAWANG' : mainheadFilter;
    const safe =
      base.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') ||
      'ALL_PENCAWANG';
    const statusTag = lifecycleStatus ? `_${lifecycleStatus}` : '';
    return { buffer, filename: `${safe}${statusTag}_CHECKLIST.xlsx` };
  }

  /**
   * SAVT routes for the report selector — the distinct routes (KOD TIANG) across
   * the tenant's SAVT site visits, each with its From/To Pencawang and a count of
   * inspected poles. SAVT data is grouped by ROUTE (From → To), not by Pencawang.
   */
  async listSavtRoutes(user: RequestUser) {
    await this.assertCanReport(user);

    const visits = await this.prisma.siteVisit.findMany({
      where: {
        tenantId: user.tenantId,
        operationalScope: OperationalScope.SAVT,
        routeCode: { not: null },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        // Presence only — enough to know the visit carries a compiled report.
        reports: { select: { id: true }, take: 1 },
        routeCode: true,
        functionalLocation: true,
        pencawangName: true,
        pencawangCode: true,
        fromPencawang: { select: { name: true, code: true } },
        toPencawang: { select: { name: true, code: true } },
        status: true,
        lifecycleStatus: true,
        checkInLatitude: true,
        checkInLongitude: true,
      },
    });

    // Inspected-pole counts per route (distinct assets whose inspection's visit
    // carries the route code) — a route can be re-surveyed across cycles.
    const poleRows = await this.prisma.inspection.findMany({
      where: {
        tenantId: user.tenantId,
        siteVisit: { operationalScope: OperationalScope.SAVT, routeCode: { not: null } },
      },
      select: { assetId: true, siteVisit: { select: { routeCode: true } } },
    });
    const polesByRoute = new Map<string, Set<string>>();
    for (const row of poleRows) {
      const code = (row.siteVisit?.routeCode ?? '').trim();
      if (!code) {
        continue;
      }
      let set = polesByRoute.get(code);
      if (!set) {
        set = new Set<string>();
        polesByRoute.set(code, set);
      }
      set.add(row.assetId);
    }

    // First visit seen per route = the most recent (ordered desc) → its From/To.
    const byRoute = new Map<
      string,
      {
        routeCode: string;
        fromName: string;
        fromCode: string;
        fromFunctionalLocation: string;
        toName: string;
        toCode: string;
        poleCount: number;
      }
    >();
    // Every lifecycle status seen on a route (across cycles) for the status filter.
    const statusesByRoute = new Map<string, Set<SurveyLifecycleStatus>>();
    const displayStatusByRoute = new Map<string, DisplayStatus>();
    // Newest visit on the route that actually HAS a compiled visual report.
    const reportVisitByRoute = new Map<string, string>();
    const coordsByRoute = new Map<
      string,
      { latitude: number; longitude: number }
    >();
    for (const visit of visits) {
      const code = (visit.routeCode ?? '').trim();
      if (!code) {
        continue;
      }

      if (visit.lifecycleStatus) {
        let statuses = statusesByRoute.get(code);
        if (!statuses) {
          statuses = new Set<SurveyLifecycleStatus>();
          statusesByRoute.set(code, statuses);
        }
        statuses.add(visit.lifecycleStatus);
      }

      // First seen per route = most recent: its current status + check-in point.
      if (!displayStatusByRoute.has(code)) {
        displayStatusByRoute.set(
          code,
          deriveDisplayStatus(visit.status, visit.lifecycleStatus),
        );
      }
      if (
        !coordsByRoute.has(code) &&
        visit.checkInLatitude != null &&
        visit.checkInLongitude != null
      ) {
        coordsByRoute.set(code, {
          latitude: visit.checkInLatitude,
          longitude: visit.checkInLongitude,
        });
      }

      // Must run BEFORE the byRoute guard: that guard short-circuits every visit
      // after the newest one, but the newest is often the cycle WITHOUT a report
      // (a re-survey in progress) while an older cycle holds the compiled PDF.
      if (visit.reports.length > 0 && !reportVisitByRoute.has(code)) {
        reportVisitByRoute.set(code, visit.id);
      }

      if (byRoute.has(code)) {
        continue;
      }
      byRoute.set(code, {
        routeCode: code,
        fromName: visit.fromPencawang?.name ?? visit.pencawangName ?? '',
        fromCode: visit.fromPencawang?.code ?? visit.pencawangCode ?? '',
        fromFunctionalLocation: visit.functionalLocation ?? '',
        toName: visit.toPencawang?.name ?? '',
        toCode: visit.toPencawang?.code ?? '',
        poleCount: polesByRoute.get(code)?.size ?? 0,
      });
    }

    return [...byRoute.values()]
      .map((route) => {
        const displayStatus = displayStatusByRoute.get(route.routeCode) ?? null;
        const coords = coordsByRoute.get(route.routeCode) ?? null;
        const reportVisitId = reportVisitByRoute.get(route.routeCode) ?? null;
        return {
          ...route,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          displayStatus,
          displayStatusLabel: displayStatus
            ? DISPLAY_STATUS_LABEL[displayStatus]
            : null,
          statuses: [...(statusesByRoute.get(route.routeCode) ?? [])],
          // Drives the "Visual Report" download button (null => nothing compiled).
          reportVisitId,
          hasReport: reportVisitId != null,
        };
      })
      .sort((a, b) => a.routeCode.localeCompare(b.routeCode));
  }

  /**
   * Per-ROUTE "Download Checklist" export for SAVT (1 pole = 1 row): every pole on
   * one KOD TIANG route, with the route-flavoured meta columns (TEAM, DATE, From/To
   * Pencawang + functional location, KOD TIANG, LOCATION, No. Tiang, NO TIANG LAMA)
   * then one column per live SAVT checklist template item. The SAVT analogue of
   * buildPencawangTemplateMasterlist (per-Pencawang / SAVR). Read-only, tenant
   * scoped, optionally filtered by survey lifecycle status.
   */
  async buildSavtRouteChecklist(
    user: RequestUser,
    routeCode: string,
    lifecycleStatus?: SurveyLifecycleStatus,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertCanReport(user);

    const code = routeCode.trim();
    if (!code) {
      throw new NotFoundException('SAVT route not found.');
    }

    const inspections = await this.prisma.inspection.findMany({
      where: {
        tenantId: user.tenantId,
        ...EXPORTABLE_INSPECTION_WHERE,
        siteVisit: {
          operationalScope: OperationalScope.SAVT,
          routeCode: code,
          ...(lifecycleStatus ? { lifecycleStatus } : {}),
        },
      },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        assetId: true,
        templateId: true,
        submittedAt: true,
        createdAt: true,
        siteVisit: {
          select: {
            mainhead: true,
            mainheadRecord: { select: { name: true } },
            functionalLocation: true,
            pencawangName: true,
            team: { select: { name: true, code: true } },
            fromPencawang: { select: { name: true } },
            toPencawang: { select: { name: true } },
          },
        },
        asset: {
          select: {
            assetCode: true,
            name: true,
            noTiangLama: true,
            latitude: true,
            longitude: true,
          },
        },
        itemResults: { select: { checklistItemId: true, result: true } },
        results: {
          select: {
            templateItemId: true,
            valueText: true,
            valueNumber: true,
            valueBoolean: true,
            valueJson: true,
            valueDate: true,
            valueDateTime: true,
          },
        },
      },
    });

    // One row per asset = its latest inspection (newest-first), ordered by No.
    // Tiang along the route (numeric, branches after their trunk).
    const latestByAsset = new Map<string, (typeof inspections)[number]>();
    for (const insp of inspections) {
      if (!latestByAsset.has(insp.assetId)) {
        latestByAsset.set(insp.assetId, insp);
      }
    }
    const chosen = [...latestByAsset.values()].sort((a, b) => {
      const ka = noTiangSortKey(stripRoutePrefix(a.asset.assetCode, code));
      const kb = noTiangSortKey(stripRoutePrefix(b.asset.assetCode, code));
      return ka[0] - kb[0] || ka[1].localeCompare(kb[1]);
    });

    const columns = await this.deriveTemplateColumns([
      ...new Set(chosen.map((i) => i.templateId)),
    ]);

    const workbook = new Workbook();
    workbook.creator = 'ASCURE';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('CHECKLIST');
    // TNB matrix layout: dropdown items span one sub-column per answer with a
    // "1" under the crew's pick (see writeTemplateMatrixHeader).
    writeTemplateMatrixHeader(sheet, SAVT_META_HEADERS, columns);

    for (const insp of chosen) {
      const sv = insp.siteVisit;
      const resultByItemId = new Map<string, (typeof insp.results)[number]>();
      for (const r of insp.results) {
        resultByItemId.set(r.templateItemId, r);
      }
      const verdictByItemId = new Map<string, InspectionItemResultValue>();
      for (const ir of insp.itemResults) {
        if (ir.checklistItemId) {
          verdictByItemId.set(ir.checklistItemId, ir.result);
        }
      }

      const meta: (string | number)[] = [
        sanitizeText(sv?.mainheadRecord?.name ?? sv?.mainhead ?? ''),
        sanitizeText(sv?.team?.name ?? sv?.team?.code ?? ''),
        formatDate(insp.submittedAt ?? insp.createdAt),
        sanitizeText(sv?.functionalLocation ?? ''),
        sanitizeText(sv?.fromPencawang?.name ?? sv?.pencawangName ?? ''),
        '', // Functional Location (TO) — not captured at check-in (sample: "can be N/A")
        sanitizeText(sv?.toPencawang?.name ?? ''),
        sanitizeText(code),
        insp.asset.latitude != null && insp.asset.longitude != null
          ? `${Number(insp.asset.latitude)}, ${Number(insp.asset.longitude)}`
          : '',
        sanitizeText(stripRoutePrefix(insp.asset.assetCode, code)),
        sanitizeText(insp.asset.noTiangLama || insp.asset.name || ''),
      ];

      const itemCells = templateMatrixCells(
        columns,
        resultByItemId,
        verdictByItemId,
      );

      sheet.addRow([...meta, ...itemCells]);
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer as ArrayBuffer);
    // Filename uses the From → To Pencawang names (DC's preferred, human-readable
    // form), e.g. "MIUK - KUKUP_SAVT_CHECKLIST.xlsx". Fall back to the KOD TIANG
    // route code if either Pencawang name is missing on the route's visits.
    const routeVisit = chosen.find(
      (i) => i.siteVisit?.fromPencawang?.name && i.siteVisit?.toPencawang?.name,
    );
    const fromName = routeVisit?.siteVisit?.fromPencawang?.name?.trim() ?? '';
    const toName = routeVisit?.siteVisit?.toPencawang?.name?.trim() ?? '';
    const safe =
      fromName && toName
        ? `${fromName} - ${toName}`
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
        : code.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') ||
          'SAVT_ROUTE';
    return { buffer, filename: `${safe}_SAVT_CHECKLIST.xlsx` };
  }

  /**
   * Bulk "Download Checklist" for SAVT — every pole across ALL routes merged into
   * ONE sheet (same meta + live-template columns as the per-route export). Rows
   * self-identify via the KOD TIANG / From / To meta columns; columns are the
   * union of every route's checklist template items. Read-only, tenant scoped,
   * optionally filtered by survey lifecycle status.
   */
  async buildBulkSavtChecklist(
    user: RequestUser,
    lifecycleStatus?: SurveyLifecycleStatus,
    routeCodes?: string[],
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertCanReport(user);

    // Explicit route selection (checkbox "Download selected") narrows at the DB.
    const codeFilter = routeCodes?.map((code) => code.trim()).filter(Boolean) ?? [];
    const inspections = await this.prisma.inspection.findMany({
      where: {
        tenantId: user.tenantId,
        ...EXPORTABLE_INSPECTION_WHERE,
        siteVisit: {
          operationalScope: OperationalScope.SAVT,
          routeCode: codeFilter.length ? { in: codeFilter } : { not: null },
          ...(lifecycleStatus ? { lifecycleStatus } : {}),
        },
      },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        assetId: true,
        templateId: true,
        submittedAt: true,
        createdAt: true,
        siteVisit: {
          select: {
            mainhead: true,
            mainheadRecord: { select: { name: true } },
            functionalLocation: true,
            pencawangName: true,
            routeCode: true,
            team: { select: { name: true, code: true } },
            fromPencawang: { select: { name: true } },
            toPencawang: { select: { name: true } },
          },
        },
        asset: {
          select: {
            assetCode: true,
            name: true,
            noTiangLama: true,
            latitude: true,
            longitude: true,
          },
        },
        itemResults: { select: { checklistItemId: true, result: true } },
        results: {
          select: {
            templateItemId: true,
            valueText: true,
            valueNumber: true,
            valueBoolean: true,
            valueJson: true,
            valueDate: true,
            valueDateTime: true,
          },
        },
      },
    });

    // One row per asset = its latest inspection (newest-first), ordered by route
    // then No. Tiang so each route's poles stay together and in sequence.
    const latestByAsset = new Map<string, (typeof inspections)[number]>();
    for (const insp of inspections) {
      if (!latestByAsset.has(insp.assetId)) {
        latestByAsset.set(insp.assetId, insp);
      }
    }
    const chosen = [...latestByAsset.values()].sort((a, b) => {
      const ra = (a.siteVisit?.routeCode ?? '').trim();
      const rb = (b.siteVisit?.routeCode ?? '').trim();
      if (ra !== rb) {
        return ra.localeCompare(rb);
      }
      const ka = noTiangSortKey(stripRoutePrefix(a.asset.assetCode, ra));
      const kb = noTiangSortKey(stripRoutePrefix(b.asset.assetCode, rb));
      return ka[0] - kb[0] || ka[1].localeCompare(kb[1]);
    });

    const columns = await this.deriveTemplateColumns([
      ...new Set(chosen.map((i) => i.templateId)),
    ]);

    const workbook = new Workbook();
    workbook.creator = 'ASCURE';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('CHECKLIST');
    // TNB matrix layout: dropdown items span one sub-column per answer with a
    // "1" under the crew's pick (see writeTemplateMatrixHeader).
    writeTemplateMatrixHeader(sheet, SAVT_META_HEADERS, columns);

    for (const insp of chosen) {
      const sv = insp.siteVisit;
      const code = (sv?.routeCode ?? '').trim();
      const resultByItemId = new Map<string, (typeof insp.results)[number]>();
      for (const r of insp.results) {
        resultByItemId.set(r.templateItemId, r);
      }
      const verdictByItemId = new Map<string, InspectionItemResultValue>();
      for (const ir of insp.itemResults) {
        if (ir.checklistItemId) {
          verdictByItemId.set(ir.checklistItemId, ir.result);
        }
      }

      const meta: (string | number)[] = [
        sanitizeText(sv?.mainheadRecord?.name ?? sv?.mainhead ?? ''),
        sanitizeText(sv?.team?.name ?? sv?.team?.code ?? ''),
        formatDate(insp.submittedAt ?? insp.createdAt),
        sanitizeText(sv?.functionalLocation ?? ''),
        sanitizeText(sv?.fromPencawang?.name ?? sv?.pencawangName ?? ''),
        '', // Functional Location (TO) — not captured at check-in
        sanitizeText(sv?.toPencawang?.name ?? ''),
        sanitizeText(code),
        insp.asset.latitude != null && insp.asset.longitude != null
          ? `${Number(insp.asset.latitude)}, ${Number(insp.asset.longitude)}`
          : '',
        sanitizeText(stripRoutePrefix(insp.asset.assetCode, code)),
        sanitizeText(insp.asset.noTiangLama || insp.asset.name || ''),
      ];

      const itemCells = templateMatrixCells(
        columns,
        resultByItemId,
        verdictByItemId,
      );

      sheet.addRow([...meta, ...itemCells]);
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer as ArrayBuffer);
    const statusTag = lifecycleStatus ? `_${lifecycleStatus}` : '';
    return { buffer, filename: `ALL_SAVT_ROUTES${statusTag}_CHECKLIST.xlsx` };
  }

  /**
   * Derive the dynamic checklist columns (one per template item, deduped by key
   * across template versions, IMAGE excluded) for the live-template exports.
   */
  private async deriveTemplateColumns(templateIds: string[]) {
    const templateItems = templateIds.length
      ? await this.prisma.inspectionTemplateItem.findMany({
          where: { templateId: { in: templateIds } },
          select: {
            id: true,
            key: true,
            label: true,
            sortOrder: true,
            inputType: true,
            optionsJson: true,
          },
          orderBy: { sortOrder: 'asc' },
        })
      : [];
    const columnsByKey = new Map<string, TemplateExportColumn>();
    for (const item of templateItems) {
      if (item.inputType === InspectionItemInputType.IMAGE) {
        continue; // photos are evidence, not tabular data
      }
      const parsedOptions =
        item.inputType === InspectionItemInputType.SELECT ||
        item.inputType === InspectionItemInputType.MULTI_SELECT
          ? normalizeTemplateSelectOptions(item.optionsJson)
          : null;
      const existing = columnsByKey.get(item.key);
      if (existing) {
        existing.itemIds.add(item.id);
        // Union options across template versions (first label per value wins)
        // so a pole inspected under an older version still marks its column.
        for (const option of parsedOptions ?? []) {
          if (!existing.options?.some((o) => o.value === option.value)) {
            (existing.options ??= []).push({
              label: option.label,
              value: option.value,
            });
          }
        }
      } else {
        columnsByKey.set(item.key, {
          label: item.label,
          sortOrder: item.sortOrder,
          inputType: item.inputType,
          itemIds: new Set([item.id]),
          options:
            parsedOptions?.map((o) => ({ label: o.label, value: o.value })) ??
            null,
        });
      }
    }
    return [...columnsByKey.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
    );
  }

  /**
   * Builds the per-Pencawang inspection workbook (Asset Summary, Inspection
   * Results, Defects, Photo URLs). Read-only and tenant scoped. Inspections are
   * anchored to the substation through the inspected asset's substationId.
   * Retained as a detailed alternative; the UI download now uses the masterlist.
   */
  async buildPencawangWorkbook(user: RequestUser, substationId: string) {
    await this.assertCanReport(user);

    const substation = await this.prisma.substation.findFirst({
      where: { id: substationId, tenantId: user.tenantId },
      select: { id: true, code: true, name: true, location: true },
    });

    if (!substation) {
      throw new NotFoundException('Pencawang (substation) not found.');
    }

    const [assets, inspections] = await Promise.all([
      this.prisma.asset.findMany({
        where: { tenantId: user.tenantId, substationId },
        orderBy: [{ assetCode: 'asc' }],
        include: { assetType: { select: { code: true, name: true } } },
      }),
      this.prisma.inspection.findMany({
        where: { tenantId: user.tenantId, asset: { substationId } },
        orderBy: [{ createdAt: 'asc' }],
        include: inspectionInclude,
      }),
    ]);

    const workbook = new Workbook();
    workbook.creator = 'ASCURE';
    workbook.created = new Date();

    this.buildAssetSummarySheet(workbook, substation, assets, inspections);
    this.buildInspectionResultsSheet(workbook, substation, inspections);
    this.buildDefectsSheet(workbook, substation, inspections);
    this.buildPhotosSheet(workbook, substation, inspections);

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer as ArrayBuffer);
    const filename = buildFilename(substation.code);

    return { buffer, filename, substation };
  }

  private buildAssetSummarySheet(
    workbook: Workbook,
    substation: SubstationSummary,
    assets: AssetRecord[],
    inspections: InspectionRecord[],
  ): void {
    const sheet = workbook.addWorksheet('Asset Summary');
    sheet.columns = [
      { header: 'Pencawang Code', key: 'pencawangCode', width: 18 },
      { header: 'Pencawang Name', key: 'pencawangName', width: 26 },
      { header: 'Asset Code', key: 'assetCode', width: 20 },
      { header: 'Asset Name', key: 'assetName', width: 24 },
      { header: 'Asset Type', key: 'assetType', width: 22 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Latitude', key: 'latitude', width: 14 },
      { header: 'Longitude', key: 'longitude', width: 14 },
      { header: 'Inspections', key: 'inspectionCount', width: 13 },
      { header: 'Defects', key: 'defectCount', width: 11 },
      { header: 'Open Defects', key: 'openDefectCount', width: 14 },
      { header: 'Created (MYT)', key: 'createdAt', width: 18 },
    ];

    const inspectionCountByAsset = new Map<string, number>();
    const defectCountByAsset = new Map<string, number>();
    const openDefectCountByAsset = new Map<string, number>();

    for (const inspection of inspections) {
      const assetId = inspection.asset.id;
      inspectionCountByAsset.set(
        assetId,
        (inspectionCountByAsset.get(assetId) ?? 0) + 1,
      );

      for (const itemResult of inspection.itemResults) {
        if (!itemResult.defect) {
          continue;
        }

        defectCountByAsset.set(
          assetId,
          (defectCountByAsset.get(assetId) ?? 0) + 1,
        );

        if (!CLOSED_DEFECT_STATUSES.has(itemResult.defect.status)) {
          openDefectCountByAsset.set(
            assetId,
            (openDefectCountByAsset.get(assetId) ?? 0) + 1,
          );
        }
      }
    }

    for (const asset of assets) {
      sheet.addRow({
        pencawangCode: substation.code,
        pencawangName: sanitizeText(substation.name),
        assetCode: sanitizeText(asset.assetCode),
        assetName: sanitizeText(asset.name),
        assetType: asset.assetType
          ? `${asset.assetType.code} - ${asset.assetType.name}`
          : '',
        status: asset.status,
        latitude: asset.latitude ?? '',
        longitude: asset.longitude ?? '',
        inspectionCount: inspectionCountByAsset.get(asset.id) ?? 0,
        defectCount: defectCountByAsset.get(asset.id) ?? 0,
        openDefectCount: openDefectCountByAsset.get(asset.id) ?? 0,
        createdAt: formatDateTime(asset.createdAt),
      });
    }

    styleHeader(sheet);
  }

  private buildInspectionResultsSheet(
    workbook: Workbook,
    substation: SubstationSummary,
    inspections: InspectionRecord[],
  ): void {
    const sheet = workbook.addWorksheet('Inspection Results');
    sheet.columns = [
      { header: 'Pencawang Code', key: 'pencawangCode', width: 16 },
      { header: 'Asset Code', key: 'assetCode', width: 18 },
      { header: 'Asset Type', key: 'assetType', width: 16 },
      { header: 'Inspection ID', key: 'inspectionId', width: 38 },
      { header: 'Inspection Date (MYT)', key: 'inspectionDate', width: 20 },
      { header: 'Submitted (MYT)', key: 'submittedAt', width: 18 },
      { header: 'Inspector', key: 'inspector', width: 22 },
      { header: 'Template', key: 'template', width: 26 },
      { header: 'Cycle', key: 'cycle', width: 8 },
      { header: 'Visit Type', key: 'visitType', width: 14 },
      { header: 'Source', key: 'source', width: 12 },
      { header: 'Item Key', key: 'itemKey', width: 20 },
      { header: 'Item Label', key: 'itemLabel', width: 32 },
      { header: 'Input Type', key: 'inputType', width: 14 },
      { header: 'Outcome', key: 'outcome', width: 12 },
      { header: 'Value', key: 'value', width: 24 },
      { header: 'Is Defect', key: 'isDefect', width: 11 },
      { header: 'Severity', key: 'severity', width: 12 },
      { header: 'Remark', key: 'remark', width: 36 },
    ];

    for (const inspection of inspections) {
      const base = {
        pencawangCode: substation.code,
        assetCode: sanitizeText(inspection.asset.assetCode),
        assetType: inspection.asset.assetType?.code ?? '',
        inspectionId: inspection.id,
        inspectionDate: formatDateTime(inspection.createdAt),
        submittedAt: formatDateTime(inspection.submittedAt),
        inspector: sanitizeText(inspection.createdBy?.name),
        template: inspection.template
          ? `${inspection.template.name} v${inspection.template.version}`
          : '',
        cycle: inspection.inspectionCycle,
        visitType: inspection.siteVisit?.visitType ?? '',
      };

      // InspectionItemResult — checklist outcome (PASS/FAIL/NA) + defect flag.
      for (const itemResult of inspection.itemResults) {
        sheet.addRow({
          ...base,
          source: 'Checklist',
          itemKey: '',
          itemLabel: sanitizeText(itemResult.label),
          inputType: '',
          outcome: itemResult.result,
          value: '',
          isDefect: itemResult.isDefect ? 'Yes' : 'No',
          severity: itemResult.severity ?? '',
          remark: sanitizeText(itemResult.remark),
        });
      }

      // InspectionResult — typed readings/values captured against template items.
      const sortedResults = [...inspection.results].sort(
        (left, right) =>
          (left.templateItem?.sortOrder ?? 0) -
          (right.templateItem?.sortOrder ?? 0),
      );

      for (const result of sortedResults) {
        sheet.addRow({
          ...base,
          source: 'Reading',
          itemKey: sanitizeText(result.templateItem?.key),
          itemLabel: sanitizeText(result.templateItem?.label),
          inputType: result.templateItem?.inputType ?? '',
          outcome: '',
          value: readingValue(result),
          isDefect: '',
          severity: '',
          remark: '',
        });
      }
    }

    styleHeader(sheet);
  }

  private buildDefectsSheet(
    workbook: Workbook,
    substation: SubstationSummary,
    inspections: InspectionRecord[],
  ): void {
    const sheet = workbook.addWorksheet('Defects');
    sheet.columns = [
      { header: 'Pencawang Code', key: 'pencawangCode', width: 16 },
      { header: 'Asset Code', key: 'assetCode', width: 18 },
      { header: 'Asset Type', key: 'assetType', width: 16 },
      { header: 'Inspection ID', key: 'inspectionId', width: 38 },
      { header: 'Inspection Date (MYT)', key: 'inspectionDate', width: 20 },
      { header: 'Inspector', key: 'inspector', width: 22 },
      { header: 'Defect ID', key: 'defectId', width: 38 },
      { header: 'Item Label', key: 'itemLabel', width: 32 },
      { header: 'Severity', key: 'severity', width: 12 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Lifecycle', key: 'lifecycle', width: 20 },
      { header: 'Resolution', key: 'resolution', width: 20 },
      { header: 'Assigned To', key: 'assignedTo', width: 22 },
      { header: 'Verified By', key: 'verifiedBy', width: 20 },
      { header: 'Action Remark', key: 'actionRemark', width: 34 },
      { header: 'Due (MYT)', key: 'dueDate', width: 18 },
      { header: 'Resolved (MYT)', key: 'resolvedAt', width: 18 },
      { header: 'Closed (MYT)', key: 'closedAt', width: 18 },
      { header: 'Created (MYT)', key: 'createdAt', width: 18 },
      { header: 'Evidence Photos', key: 'evidenceCount', width: 16 },
    ];

    for (const inspection of inspections) {
      for (const itemResult of inspection.itemResults) {
        const defect = itemResult.defect;
        if (!defect) {
          continue;
        }

        const assignedTo =
          defect.assignedToUser?.name ?? defect.assignedToTeam?.name ?? '';

        sheet.addRow({
          pencawangCode: substation.code,
          assetCode: sanitizeText(inspection.asset.assetCode),
          assetType: inspection.asset.assetType?.code ?? '',
          inspectionId: inspection.id,
          inspectionDate: formatDateTime(inspection.createdAt),
          inspector: sanitizeText(inspection.createdBy?.name),
          defectId: defect.id,
          itemLabel: sanitizeText(itemResult.label),
          severity: defect.severity,
          status: defect.status,
          lifecycle: defect.lifecycleStatus ?? '',
          resolution: defect.resolutionOutcome ?? '',
          assignedTo: sanitizeText(assignedTo),
          verifiedBy: sanitizeText(defect.verifiedByUser?.name),
          actionRemark: sanitizeText(defect.actionRemark),
          dueDate: formatDateTime(defect.dueDate),
          resolvedAt: formatDateTime(defect.resolvedAt),
          closedAt: formatDateTime(defect.closedAt),
          createdAt: formatDateTime(defect.createdAt),
          evidenceCount: defect.evidenceImages.length,
        });
      }
    }

    styleHeader(sheet);
  }

  private buildPhotosSheet(
    workbook: Workbook,
    substation: SubstationSummary,
    inspections: InspectionRecord[],
  ): void {
    const sheet = workbook.addWorksheet('Photo URLs');
    sheet.columns = [
      { header: 'Pencawang Code', key: 'pencawangCode', width: 16 },
      { header: 'Asset Code', key: 'assetCode', width: 18 },
      { header: 'Inspection ID', key: 'inspectionId', width: 38 },
      { header: 'Source', key: 'source', width: 26 },
      { header: 'Defect ID', key: 'defectId', width: 38 },
      { header: 'File Name', key: 'fileName', width: 28 },
      { header: 'URL', key: 'url', width: 52 },
      { header: 'Latitude', key: 'latitude', width: 14 },
      { header: 'Longitude', key: 'longitude', width: 14 },
      { header: 'Captured (MYT)', key: 'capturedAt', width: 18 },
      { header: 'Note', key: 'note', width: 30 },
    ];

    for (const inspection of inspections) {
      const assetCode = sanitizeText(inspection.asset.assetCode);

      // InspectionImage — dedicated inspection photos (GPS + capture time).
      for (const image of inspection.inspectionImages) {
        sheet.addRow({
          pencawangCode: substation.code,
          assetCode,
          inspectionId: inspection.id,
          source: 'Inspection Photo',
          defectId: '',
          fileName: sanitizeText(image.filename),
          url: resolveImageUrl(image.url, null),
          latitude: image.latitude ?? '',
          longitude: image.longitude ?? '',
          capturedAt: formatDateTime(image.timestamp ?? image.createdAt),
          note: '',
        });
      }

      // Image — generic image records linked to the inspection.
      for (const image of inspection.images) {
        sheet.addRow({
          pencawangCode: substation.code,
          assetCode,
          inspectionId: inspection.id,
          source: 'Inspection Image',
          defectId: '',
          fileName: sanitizeText(image.fileName),
          url: resolveImageUrl(image.url, image.storageKey),
          latitude: '',
          longitude: '',
          capturedAt: formatDateTime(image.createdAt),
          note: '',
        });
      }

      // DefectEvidenceImage — maintenance / closure proof photos.
      for (const itemResult of inspection.itemResults) {
        const defect = itemResult.defect;
        if (!defect) {
          continue;
        }

        for (const evidence of defect.evidenceImages) {
          sheet.addRow({
            pencawangCode: substation.code,
            assetCode,
            inspectionId: inspection.id,
            source: `Defect Evidence (${evidence.evidenceType})`,
            defectId: defect.id,
            fileName: sanitizeText(evidence.fileName),
            url: resolveImageUrl(evidence.url, evidence.storageKey),
            latitude: evidence.latitude ?? '',
            longitude: evidence.longitude ?? '',
            capturedAt: formatDateTime(evidence.timestamp ?? evidence.createdAt),
            note: sanitizeText(evidence.note),
          });
        }
      }
    }

    styleHeader(sheet);
  }
}

function styleHeader(sheet: Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' },
  };
  header.alignment = { vertical: 'middle' };
  header.commit();
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Normalise a label for matching (same scheme as the importer's header match). */
function normLabel(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/** Recover the original AppSheet UNIQUEID from a stored externalRef. */
function reverseExternalRef(ref: string | null | undefined): string {
  if (!ref) {
    return '';
  }
  const prefix = 'appsheet:savr-klb:';
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}

function buildFilename(code: string): string {
  const safeCode =
    (code || 'pencawang')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'pencawang';

  return `ascure-pencawang-${safeCode}-${formatDate(new Date())}.xlsx`;
}

/**
 * Mitigates spreadsheet formula injection: free-text values that begin with a
 * formula trigger (= + - @, tab, CR) are prefixed with a single quote so Excel
 * treats them as literal text.
 */
function sanitizeText(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    return `'${text}`;
  }

  return text;
}

/** Times are rendered in Malaysia time (MYT, UTC+8 — no DST). */
function formatDateTime(value: Date | null | undefined): string {
  if (!value) {
    return '';
  }

  const myt = new Date(value.getTime() + 8 * 60 * 60 * 1000);
  return `${myt.toISOString().slice(0, 10)} ${myt.toISOString().slice(11, 16)}`;
}

function formatDate(value: Date | null | undefined): string {
  if (!value) {
    return '';
  }

  const myt = new Date(value.getTime() + 8 * 60 * 60 * 1000);
  return myt.toISOString().slice(0, 10);
}

type RecordedResult = {
  valueText: string | null;
  valueNumber: Prisma.Decimal | null;
  valueBoolean: boolean | null;
  valueJson: unknown;
  // Optional: the masterlist export's rows don't fetch the date columns (its
  // fixed SAVR-KLB layout has no date items); the template-driven exports do.
  valueDate?: Date | null;
  valueDateTime?: Date | null;
};

/**
 * True when this InspectionResult row still carries any recorded value. A row
 * whose every column is blank is a value the office CLEARED — and the verdict
 * follows the value (same rule as overlayItemResult in assets.service), so
 * verdict-driven cells and defect marks treat such an item as withdrawn.
 */
function hasRecordedValue(result: RecordedResult): boolean {
  return Boolean(
    result.valueText?.trim() ||
      result.valueNumber != null ||
      result.valueBoolean != null ||
      result.valueDate != null ||
      result.valueDateTime != null ||
      (Array.isArray(result.valueJson) && result.valueJson.length > 0),
  );
}

/**
 * A template-driven export column. SELECT / MULTI_SELECT columns carry their
 * options so the sheet can render TNB's one-hot MATRIX layout — the item name
 * merged across one sub-column per answer, and a "1" mark under the answer the
 * crew picked — instead of a free-text value cell. (This is how the official
 * TNB SAVT checklist reads: e.g. "Cable Tray" spans "Keadaan Baik | Perlu
 * Tukar | Tiada Cable Tray", and each pole's row marks exactly one of them.)
 */
type TemplateExportColumn = {
  label: string;
  sortOrder: number;
  inputType: InspectionItemInputType;
  itemIds: Set<string>;
  options: { label: string; value: string }[] | null;
};

function isMatrixColumn(column: TemplateExportColumn): boolean {
  return (
    (column.inputType === InspectionItemInputType.SELECT ||
      column.inputType === InspectionItemInputType.MULTI_SELECT) &&
    (column.options?.length ?? 0) > 0
  );
}

/**
 * Two-row TNB-style header: meta cells merged vertically; each matrix item's
 * name merged across its answer sub-columns with the answer labels rotated 90°
 * beneath (narrow columns); non-matrix items keep a single merged cell.
 */
function writeTemplateMatrixHeader(
  sheet: Worksheet,
  metaHeaders: string[],
  columns: TemplateExportColumn[],
): void {
  const row1: string[] = [...metaHeaders];
  const row2: string[] = metaHeaders.map(() => '');
  for (const column of columns) {
    if (isMatrixColumn(column)) {
      column.options!.forEach((option, index) => {
        row1.push(index === 0 ? column.label : '');
        row2.push(option.label);
      });
    } else {
      row1.push(column.label);
      row2.push('');
    }
  }
  sheet.addRow(row1);
  sheet.addRow(row2);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(2).font = { bold: true };
  sheet.getRow(2).height = 95;

  let columnIndex = 1;
  for (let meta = 0; meta < metaHeaders.length; meta++) {
    sheet.mergeCells(1, columnIndex, 2, columnIndex);
    sheet.getCell(1, columnIndex).alignment = {
      vertical: 'middle',
      wrapText: true,
    };
    sheet.getColumn(columnIndex).width = 18;
    columnIndex += 1;
  }
  for (const column of columns) {
    if (isMatrixColumn(column)) {
      const span = column.options!.length;
      if (span > 1) {
        sheet.mergeCells(1, columnIndex, 1, columnIndex + span - 1);
      }
      sheet.getCell(1, columnIndex).alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      for (let sub = 0; sub < span; sub++) {
        const cell = sheet.getRow(2).getCell(columnIndex + sub);
        cell.alignment = {
          textRotation: 90,
          vertical: 'bottom',
          horizontal: 'center',
        };
        sheet.getColumn(columnIndex + sub).width = 5;
      }
      columnIndex += span;
    } else {
      sheet.mergeCells(1, columnIndex, 2, columnIndex);
      sheet.getCell(1, columnIndex).alignment = {
        vertical: 'middle',
        wrapText: true,
      };
      sheet.getColumn(columnIndex).width = 16;
      columnIndex += 1;
    }
  }
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
}

/**
 * One pole's item cells for the matrix layout: a matrix column writes 1 under
 * the picked answer (MULTI_SELECT marks every pick; a cleared or unanswered
 * item marks nothing); every other column keeps its value cell via
 * resolveTemplateCell.
 */
function templateMatrixCells(
  columns: TemplateExportColumn[],
  resultByItemId: ReadonlyMap<string, RecordedResult>,
  verdictByItemId: ReadonlyMap<string, InspectionItemResultValue>,
): (string | number)[] {
  const cells: (string | number)[] = [];
  for (const column of columns) {
    let result: RecordedResult | undefined;
    let verdict: InspectionItemResultValue | undefined;
    for (const id of column.itemIds) {
      if (!result) result = resultByItemId.get(id);
      if (!verdict) verdict = verdictByItemId.get(id);
    }
    if (isMatrixColumn(column)) {
      const picked = new Set<string>();
      if (result) {
        if (Array.isArray(result.valueJson)) {
          for (const entry of result.valueJson) {
            if (typeof entry === 'string') picked.add(entry.trim());
          }
        }
        const text = result.valueText?.trim();
        if (text) picked.add(text);
      }
      for (const option of column.options!) {
        cells.push(picked.has(option.value) ? 1 : '');
      }
    } else {
      cells.push(resolveTemplateCell(column.inputType, result, verdict));
    }
  }
  return cells;
}

/**
 * Resolve a single template-driven report cell by field type. (IMAGE items are
 * excluded from the report upstream, so they never reach here.)
 * - BOOLEAN: YES (defect / FAIL) or NO (no defect / PASS); N/A or unanswered →
 *   blank. Driven by the PASS/FAIL/NA verdict, NOT valueBoolean — valueBoolean
 *   is an inverse "passed?" flag (true = PASS), so reading it directly inverts.
 * - MULTI_SELECT: the chosen values, comma-separated.
 * - OCR / NUMBER / READING: the keyed-in number.
 * - TEXT / SELECT (dropdown) / DATE / DATETIME / GPS / JSON: the value verbatim.
 */
function resolveTemplateCell(
  inputType: InspectionItemInputType,
  result: RecordedResult | undefined,
  verdict: InspectionItemResultValue | undefined,
): string {
  switch (inputType) {
    case InspectionItemInputType.BOOLEAN:
      // A cleared value withdraws the verdict — a row exists but is blank, so
      // the frozen PASS/FAIL must not resurface here (the system shows blank).
      if (result && !hasRecordedValue(result)) return '';
      if (verdict === InspectionItemResultValue.FAIL) return 'YES';
      if (verdict === InspectionItemResultValue.PASS) return 'NO';
      return ''; // NA or unanswered → blank

    case InspectionItemInputType.MULTI_SELECT: {
      const json = result?.valueJson;
      const picks = Array.isArray(json) ? json.map((v) => String(v)) : [];
      // v1 "Other (free text)" rides in valueText alongside the picks; append it.
      const other = result?.valueText?.trim() ? result.valueText.trim() : '';
      const parts = other ? [...picks, other] : picks;
      if (parts.length > 0) {
        return sanitizeText(parts.join(', '));
      }
      return sanitizeText(result?.valueText ?? '');
    }

    case InspectionItemInputType.OCR:
    case InspectionItemInputType.NUMBER:
    case InspectionItemInputType.READING:
      if (result?.valueText && result.valueText.trim()) {
        return sanitizeText(result.valueText);
      }
      if (result?.valueNumber != null) {
        return String(result.valueNumber.toNumber());
      }
      return '';

    default: {
      // TEXT, SELECT (dropdown), DATE, DATETIME, GPS, JSON → recorded value,
      // read in the shared checklistResultValue priority (text, number, dates,
      // multi-select picks) so the cell matches what every screen shows.
      if (result?.valueText != null && result.valueText !== '') {
        return sanitizeText(result.valueText);
      }
      if (result?.valueNumber != null) {
        return String(result.valueNumber.toNumber());
      }
      if (result?.valueDate != null) {
        return formatDate(result.valueDate);
      }
      if (result?.valueDateTime != null) {
        return formatDateTime(result.valueDateTime);
      }
      const json = result?.valueJson;
      if (Array.isArray(json)) {
        return sanitizeText(json.map((v) => String(v)).join(', '));
      }
      return '';
    }
  }
}

/**
 * Owner's fixed SAVR checklist arrangement ("SUSUNAN UNTUK ML DOWNLOAD",
 * 2026-06-22): the exact column order for the "Download Checklist" export,
 * applied to every SAVR mainhead except KUANTAN (which uses its own fixed list,
 * KUANTAN_FIXED_ITEM_LABELS). Item columns are matched to the live template items
 * by normalized label, so these item headers must match the checklist item
 * labels verbatim (whitespace-insensitive). Photo (IMAGE) values are not
 * embedded — the GAMBAR KELEGAAN columns surface the OCR reading.
 */
const SAVR_FIXED_META_HEADERS = [
  'MAINHEAD',
  'TEAM',
  'DATE',
  'LOCATION',
  'Pencawang Code',
  'Pencawang Name',
  'NO TIANG RONDAAN',
  'NO TIANG LAMA',
];

const SAVR_FIXED_ITEM_LABELS = [
  'JENIS TIANG',
  'SAIZ TIANG',
  'ABC (SPAN) - 3 X 185',
  'ABC (SPAN) - 3 X 95',
  'BARE (SPAN) - 7 /173 (3 PHASE)',
  'BARE (SPAN) - 7 /122 (SINGLE PHASE)',
  'BARE (SPAN) - 3 /132',
  'ABC (SPAN) - 3 X 16',
  'ABC (SPAN) - 1 X 16',
  'PVC (SPAN) - 9 /064 (3 PHASE)',
  'PVC (SPAN) - 7 /083 (SINGLE PHASE)',
  'PVC (SPAN) - 7 /044',
  'TIANG - REPUT / RETAK',
  'TIANG - CONDONG',
  'TIANG - NO. TIANG PUDAR / TIADA',
  'TALIAN (UTAMA / SERVIS) - PENGGUNAAN IPC / MARUKU  JOINT BAGI SAMBUNGAN TENGAH',
  'TALIAN (UTAMA / SERVIS) - PERLU RENTIS',
  'TALIAN (UTAMA / SERVIS) - TIDAK PATUH GROUND CLEARANCE',
  'UMBANG - KENDUR / PUTUS',
  'UMBANG - ULAN (CREEPERS)',
  'UMBANG - TIADA STAY INSULATOR / ROSAK',
  'UMBANG - STAY PLATE / PANGKAL STAY TERBONGKAH',
  'UMBANG - TERBANG / SUPPORT POLE',
  'IPC - KESAN BAKAR',
  'IPC - TIDAK CUKUP',
  'BLACK BOX - KESAN BAKAR',
  'BIL BLACK BOX',
  'JUMPER - TIADA UV SLEEVE',
  'JUMPER - KESAN BAKAR',
  'PENANGKAP KILAT - ROSAK',
  'SERVIS - TALIAN SERVIS BERADA DI ATAS BUMBUNG',
  'SERVIS - WON PIECE TANGGAL',
  'BILANGAN SERVIS MELIBATKAN 1 PENGGUNA SAHAJA',
  'PEMBUMIAN - TIADA SAMBUNGAN KE NEUTRAL',
  'PAPAN TANDA  -  OFF POINT / BEKALAN DUA HALA - PAPAN TANDA PUDAR / ROSAK / TIADA',
  'SESALUR KAKI LIMA - WAYAR TANGGAL',
  'SESALUR KAKI LIMA - DALAM RUMAH / RENOVATION',
  'SESALUR KAKI LIMA - JUNCTION BOX / IPC',
  'SESALUR KAKI LIMA - JUNCTION BOX TANGGAL / KESAN BAKAR',
  'BIL LVPT CAP BANK',
  'CATITAN',
  'GAMBAR KELEGAAN 1',
  'KEADAAN DI TAPAK 1',
  'GAMBAR KELEGAAN 2',
  'KEADAAN DI TAPAK 2',
  'GAMBAR KELEGAAN 3',
  'KEADAAN DI TAPAK 3',
  'KAWASAN - LAIN - LAIN (SILA NYATAKAN)',
];

/**
 * KUANTAN's fixed checklist arrangement — the exact column order for KUANTAN's
 * "Download Checklist" export, taken verbatim from the owner's PE_DC_TESTING
 * sample (2026-06-27). Like SAVR_FIXED_ITEM_LABELS, item columns map to the live
 * template items by normalized label, so these headers must match the KUANTAN
 * checklist item labels verbatim (whitespace-insensitive); the meta columns
 * reuse SAVR_FIXED_META_HEADERS.
 */
const KUANTAN_FIXED_ITEM_LABELS = [
  'TIANG - NO. TIANG PUDAR / TIADA',
  'TIANG - REPUT / RETAK',
  'TIANG - CONDONG',
  'TIANG - KEPERLUAN UMBANG',
  'JENIS TIANG',
  'SAIZ TIANG',
  'ABC (SPAN) - 3 X 185',
  'ABC (SPAN) - 3 X 95',
  'BILANGAN SERVIS MELIBATKAN 1 PENGGUNA SAHAJA',
  'BARE (SPAN) - 7 /173 (3 PHASE)',
  'BARE (SPAN) - 7 /122 (SINGLE PHASE)',
  'BARE (SPAN) - 3 /132',
  'ABC (SPAN) - 3 X 16',
  'ABC (SPAN) - 1 X 16',
  'PVC (SPAN) - 9 /064 (3 PHASE)',
  'PVC (SPAN) - 7 /083 (SINGLE PHASE)',
  'PVC (SPAN) - 7 /044',
  'CATITAN',
  'BLACK BOX - KESAN BAKAR',
  'BLACK BOX - USANG / LAMA',
  'BLACK BOX - BOLEH DICAPAI (<3.5 METER)',
  'BIL BLACK BOX',
  'AKSESORI - SADDLE LINE TAP PADA TALIAN ABC',
  'AKSESORI - SUSPENSION CLAMP (A) PATAH / TERBALIK (C) / TIADA (C)',
  'AKSESORI - DEAD END CLAMP PATAH / TERBALIK',
  'AKSESORI - CABLE TIE',
  'UMBANG - TERBANG / SUPPORT POLE',
  'UMBANG - KENDUR / PUTUS',
  'UMBANG - TIADA STAY INSULATOR / ROSAK',
  'UMBANG - STAY PLATE / PANGKAL STAY TERBONGKAH',
  'PENANGKAP KILAT - ROSAK',
  'PEMBUMIAN - EARTHING CONNECTED PADA DEVICE & AKSESORI',
  'PEMBUMIAN - TIADA SAMBUNGAN KE NEUTRAL',
  'PEMBUMIAN - TIDAK MENGGUNAKAN IPC ABC - BARE',
  'SAMBUNGAN UG-OH / JUMPER - TIADA TRANSITION JOINT (MENGGUNAKAN IPC)',
  'SAMBUNGAN UG-OH / JUMPER - TIADA UV SLEEVE',
  'SAMBUNGAN UG-OH / JUMPER - KESAN BAKAR',
  'SAMBUNGAN UG-OH / JUMPER - PAIP KABEL ROSAK / TIDAK STANDARD / TIADA PAIP',
  'PAPAN TANDA  -  OFF POINT / BEKALAN DUA HALA - PAPAN TANDA PUDAR / ROSAK / TIADA',
  'BIL LVPT CAP BANK',
  'IPC - BILANGAN IPC NEUTRAL KURANG 2 NOS',
  'IPC - TIUP PEMATI (END CAP) TIADA / TIDAK DIPASANG',
  'IPC - IPC KESAN BAKAR TERBALIK / TIDAK MENCUKUPI (NEUTRAL)',
  'LAMPU JALAN - SAMBUNGAN IPC DI SERVIS (TINDAKAN TEAM SL)',
  'LAIN-LAIN - HAZARD BIO (TEBUAN, ETC.)',
  'SERVIS - METER BOX ROSAK DI TIANG',
  'TALIAN (UTAMA / SERVIS) - PENGGUNAAN IPC / MARUKU  JOINT BAGI SAMBUNGAN TENGAH',
  'TALIAN (UTAMA / SERVIS) - TIDAK PATUH GROUND CLEARANCE',
  'TALIAN (UTAMA / SERVIS) - PERLU RESLEEVE',
  'TALIAN (UTAMA / SERVIS) - CROSSING JLN YG BERISIKO TIDAK MENGGUNAKAN WIRE MASSENGER',
  'TALIAN (UTAMA / SERVIS) - UZUR / USANG',
  'TALIAN (UTAMA / SERVIS) - TALIAN ATAS DIRENTANG MELINTASI / BERSENTUHAN BUMBUNG',
  'RENTIS - PERLU RENTIS.   (A) MELINTASI JALAN UTAMA, (B) BAHU JALAN, (C) JALAN TIDAK DIMASUKI KENDERAAN',
  'RENTIS - ULAN (CREEPERS)',
  'SERVIS - TALIAN SERVIS BERSENTUHAN PADA BUMBUNG',
  'SERVIS - SERVIS KENA ZINK',
  'SERVIS - WON PIECE TANGGAL',
  'SESALUR KAKI LIMA - WAYAR TANGGAL',
  'SESALUR KAKI LIMA - JUNCTION BOX TANGGAL / KESAN BAKAR',
  'SESALUR KAKI LIMA - USIKAN PENGGUNA',
  'SERVIS - SERVIS TERBIAR / TIDAK DIGUNAKAN',
  'SERVIS - USANG / LAMA',
  'GAMBAR KELEGAAN 1',
  'KEADAAN DI TAPAK 1',
  'GAMBAR KELEGAAN 2',
  'KEADAAN DI TAPAK 2',
  'GAMBAR KELEGAAN 3',
  'KEADAAN DI TAPAK 3',
  'KAWASAN - LAIN - LAIN (SILA NYATAKAN)',
];

/** The mainhead with its own fixed checklist arrangement (KUANTAN_FIXED_ITEM_LABELS). */
const KUANTAN_MAINHEAD_NAME = 'KUANTAN';

/**
 * SAVT route-checklist meta columns (the "few extra columns" before the live SAVT
 * checklist items), taken from the owner's SAMPLE SAVT.xlsx. Functional Location
 * (TO) has no captured source today, so it comes through blank (sample: "can be
 * N/A"). The From details come from the route's check-in (always at the From).
 */
const SAVT_META_HEADERS = [
  'MAINHEAD',
  'TEAM',
  'DATE',
  'FUNCTIONAL LOCATION (FROM)',
  'FROM (NAMA PENCAWANG)',
  'FUNCTIONAL LOCATION (TO)',
  'TO (NAMA PENCAWANG)',
  'KOD TIANG',
  'LOCATION',
  'No. Tiang',
  'NO TIANG LAMA',
];

/**
 * Strip a SAVT route's "{KOD TIANG} " prefix from a pole's assetCode to recover
 * its No. Tiang (e.g. "MI - KUK 33/1" -> "33/1"). The assetCode prefix is stored
 * uppercased (normalizeOperationalText), so match case-insensitively.
 */
function stripRoutePrefix(assetCode: string, routeCode: string): string {
  const prefix = `${routeCode.trim()} `;
  if (assetCode.toUpperCase().startsWith(prefix.toUpperCase())) {
    return assetCode.slice(prefix.length).trim();
  }
  return assetCode;
}

/**
 * Sort key for a No. Tiang: the leading integer first (so 2 sorts before 10),
 * then the whole string (so "33" precedes its branch "33/1").
 */
function noTiangSortKey(noTiang: string): [number, string] {
  const match = noTiang.match(/^(\d+)/);
  return [match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER, noTiang];
}

/** Whitespace-insensitive, case-insensitive label key for matching. */
function normalizeChecklistLabel(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * The MAINHEAD a per-Pencawang export belongs to — taken from the inspections'
 * site visit (the linked MAINHEAD record, else the free-text mainhead). Returns
 * the first non-empty one (a Pencawang's inspections share a mainhead).
 */
function resolveExportMainheadName(
  inspections: {
    siteVisit: {
      mainhead: string | null;
      mainheadRecord: { name: string } | null;
    } | null;
  }[],
): string {
  for (const insp of inspections) {
    const name =
      insp.siteVisit?.mainheadRecord?.name ?? insp.siteVisit?.mainhead ?? '';
    if (name && name.trim()) {
      return name;
    }
  }
  return '';
}

function resolveImageUrl(
  url: string | null | undefined,
  storageKey: string | null | undefined,
): string {
  if (url && url.trim()) {
    return url;
  }

  if (storageKey && storageKey.trim()) {
    return `${UPLOADS_URL_PREFIX}/${storageKey.replace(/^\/+/, '')}`;
  }

  return '';
}

function readingValue(result: InspectionResultRecord): string | number {
  if (result.valueText !== null && result.valueText !== undefined) {
    return sanitizeText(result.valueText);
  }

  if (result.valueNumber !== null && result.valueNumber !== undefined) {
    return result.valueNumber.toNumber();
  }

  if (result.valueBoolean !== null && result.valueBoolean !== undefined) {
    return result.valueBoolean ? 'TRUE' : 'FALSE';
  }

  if (result.valueDateTime !== null && result.valueDateTime !== undefined) {
    return formatDateTime(result.valueDateTime);
  }

  if (result.valueDate !== null && result.valueDate !== undefined) {
    return formatDate(result.valueDate);
  }

  if (result.valueJson !== null && result.valueJson !== undefined) {
    return sanitizeText(JSON.stringify(result.valueJson));
  }

  return '';
}

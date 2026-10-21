import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DefectLifecycleStatus, Prisma, ResolutionOutcome } from '@prisma/client';
import { Workbook } from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleSheetsClient, SheetCellUpdate } from './google-sheets.client';
import {
  compact,
  distanceMetres,
  groupForItem,
  malaysiaDate,
  normaliseCellDate,
  parseCoordinate,
  parseLayout,
  poleKey,
  SheetGroupId,
} from './sheet-sync.logic';

/** A row's GPS must sit this close to the ASCURE pole (loose: ~1% of rows have 3–4 decimals). */
const GPS_TOLERANCE_M = 15;
/** Nightly at 22:00 Malaysia time = 14:00 UTC — TNB verifies after working hours. */
const NIGHTLY_UTC_HOUR = 14;
/** "Cannot repair" outcomes leave the date blank (owner D6). */
const CANNOT_REPAIR: ResolutionOutcome[] = [
  ResolutionOutcome.EXTERNAL_CONSTRAINT,
  ResolutionOutcome.ESCALATED,
  ResolutionOutcome.DEFERRED,
];
const MAX_ISSUES = 20_000;
const STALE_RUN_MS = 30 * 60 * 1000;

export type SheetSyncIssue = {
  type:
    | 'PE_NOT_FOUND'
    | 'POLE_NOT_FOUND'
    | 'GPS_MISMATCH'
    | 'NO_GPS'
    | 'DUPLICATE_ROW'
    | 'CLASH'
    | 'NO_COLUMN'
    | 'UNKNOWN_GROUP';
  row?: number; // 1-based, as the sheet shows it
  pencawang?: string;
  pole?: string;
  group?: string;
  sheetValue?: string;
  ascureValue?: string;
  detail?: string;
  count?: number;
};

type SheetRow = { index: number; fl: string; name: string; pole: string; coord: string; cells: string[] };

const ISSUE_LABELS: Record<SheetSyncIssue['type'], string> = {
  PE_NOT_FOUND: 'Pencawang not in ASCURE',
  POLE_NOT_FOUND: 'No Tiang not in ASCURE',
  GPS_MISMATCH: 'GPS too far from the ASCURE pole',
  NO_GPS: 'No GPS to confirm',
  DUPLICATE_ROW: 'Pole is on more than one row',
  CLASH: 'Cell already has a different date',
  NO_COLUMN: 'Repaired item has no column',
  UNKNOWN_GROUP: 'Date column with an unknown group',
};

/**
 * docs/PLAN-google-sheet-repair-sync.md — writes the repair date of every
 * TNB-verified repair into the matching "Tarikh Pembaikan" cell of a QR03 tab.
 * Never overwrites what TNB typed: a cell is written only when empty or still
 * holding ASCURE's own last value (SheetSyncCell).
 */
@Injectable()
export class SheetSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SheetSync');
  private timer: NodeJS.Timeout | null = null;
  private client: GoogleSheetsClient | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!process.env.SHEET_SYNC_KEY_FILE?.trim()) {
      this.logger.log('SHEET_SYNC_KEY_FILE not set — Google Sheet sync is off.');
      return;
    }
    if (process.env.SHEET_SYNC_NIGHTLY === 'false') {
      this.logger.log('SHEET_SYNC_NIGHTLY=false — nightly run off (manual runs still work).');
      return;
    }
    this.scheduleNext();
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext() {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), NIGHTLY_UTC_HOUR));
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    this.timer = setTimeout(() => {
      void this.runNightly().finally(() => this.scheduleNext());
    }, next.getTime() - now.getTime());
    this.timer.unref();
    this.logger.log(`next nightly run ${next.toISOString()}`);
  }

  /** Every active target: real writes where switched on, a dry run otherwise. */
  private async runNightly() {
    const targets = await this.prisma.sheetSyncTarget.findMany({ where: { isActive: true } });
    for (const target of targets) {
      try {
        await this.execute(target.id, 'NIGHTLY', !target.writeEnabled, null);
      } catch (error) {
        this.logger.error(`nightly run for "${target.name}" failed: ${(error as Error).message}`);
      }
    }
  }

  private getClient() {
    const keyFile = process.env.SHEET_SYNC_KEY_FILE?.trim();
    if (!keyFile) {
      throw new BadRequestException('Google Sheet sync is not set up on this server (SHEET_SYNC_KEY_FILE).');
    }
    this.client ??= GoogleSheetsClient.fromKeyFile(keyFile);
    return this.client;
  }

  serviceAccountEmail() {
    try {
      return this.getClient().serviceAccountEmail;
    } catch {
      return null;
    }
  }

  // ── targets ────────────────────────────────────────────────────────────────

  async listTargets(tenantId: string) {
    const targets = await this.prisma.sheetSyncTarget.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: {
        runs: { orderBy: { startedAt: 'desc' }, take: 1, select: RUN_SELECT },
        _count: { select: { cells: true } },
      },
    });
    return {
      serviceAccountEmail: this.serviceAccountEmail(),
      targets: targets.map(({ runs, _count, ...target }) => ({
        ...target,
        cellsWritten: _count.cells,
        lastRun: runs[0] ?? null,
      })),
    };
  }

  /** Accepts the full sheet link or the bare id. */
  static spreadsheetIdFrom(input: string) {
    const trimmed = input.trim();
    const fromUrl = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(trimmed)?.[1];
    if (fromUrl) return fromUrl;
    if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return trimmed;
    throw new BadRequestException('Paste the Google Sheet link (…/spreadsheets/d/…).');
  }

  async createTarget(tenantId: string, input: { name: string; spreadsheet: string; sheetTitle?: string }) {
    const spreadsheetId = SheetSyncService.spreadsheetIdFrom(input.spreadsheet);
    const sheetTitle = input.sheetTitle?.trim() || 'QR03';
    // Fail now (not at 22:00) when the sheet isn't shared with the service account.
    await this.getClient()
      .findSheet(spreadsheetId, sheetTitle)
      .catch((error: Error) => {
        throw new BadRequestException(error.message);
      });
    return this.prisma.sheetSyncTarget.create({
      data: { tenantId, name: input.name.trim(), spreadsheetId, sheetTitle },
    });
  }

  async updateTarget(
    tenantId: string,
    id: string,
    input: { name?: string; sheetTitle?: string; writeEnabled?: boolean; isActive?: boolean },
  ) {
    await this.findTarget(tenantId, id);
    return this.prisma.sheetSyncTarget.update({
      where: { id },
      data: {
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(input.sheetTitle?.trim() ? { sheetTitle: input.sheetTitle.trim() } : {}),
        ...(input.writeEnabled !== undefined ? { writeEnabled: input.writeEnabled } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  private async findTarget(tenantId: string, id: string) {
    const target = await this.prisma.sheetSyncTarget.findFirst({ where: { id, tenantId } });
    if (!target) throw new NotFoundException('Sheet not found.');
    return target;
  }

  // ── runs ───────────────────────────────────────────────────────────────────

  async listRuns(tenantId: string, targetId: string) {
    await this.findTarget(tenantId, targetId);
    return this.prisma.sheetSyncRun.findMany({
      where: { targetId },
      orderBy: { startedAt: 'desc' },
      take: 30,
      select: RUN_SELECT,
    });
  }

  private async findRun(tenantId: string, runId: string) {
    const run = await this.prisma.sheetSyncRun.findFirst({
      where: { id: runId, target: { tenantId } },
      include: { target: { select: { name: true } } },
    });
    if (!run) throw new NotFoundException('Run not found.');
    return run;
  }

  /** Starts a run in the background and returns it (the page polls). */
  async startRun(tenantId: string, targetId: string, dryRun: boolean, email: string) {
    const target = await this.findTarget(tenantId, targetId);
    if (!dryRun && !target.writeEnabled) {
      throw new BadRequestException('Writing is off for this sheet — run a dry run, or switch writing on first.');
    }
    this.getClient();
    const run = await this.claimRun(target.id, 'MANUAL', dryRun, email);
    void this.process(run.id, target.id, dryRun);
    return run;
  }

  private async execute(targetId: string, trigger: string, dryRun: boolean, email: string | null) {
    const run = await this.claimRun(targetId, trigger, dryRun, email);
    await this.process(run.id, targetId, dryRun);
  }

  /** One run at a time per sheet; a run stuck RUNNING for 30 min no longer blocks. */
  private async claimRun(targetId: string, trigger: string, dryRun: boolean, email: string | null) {
    const busy = await this.prisma.sheetSyncRun.findFirst({
      where: { targetId, status: 'RUNNING', startedAt: { gt: new Date(Date.now() - STALE_RUN_MS) } },
      select: { id: true },
    });
    if (busy) throw new ConflictException('A sync is already running for this sheet.');
    return this.prisma.sheetSyncRun.create({
      data: { targetId, trigger, dryRun, triggeredByEmail: email },
      select: RUN_SELECT,
    });
  }

  private async process(runId: string, targetId: string, dryRun: boolean) {
    try {
      const { summary, issues } = await this.sync(targetId, dryRun);
      await this.prisma.sheetSyncRun.update({
        where: { id: runId },
        data: {
          status: 'OK',
          summary: summary as Prisma.InputJsonValue,
          issues: issues as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      this.logger.log(`run ${runId} ${dryRun ? '(dry) ' : ''}done: ${JSON.stringify(summary)}`);
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      this.logger.error(`run ${runId} failed: ${message}`);
      await this.prisma.sheetSyncRun.update({
        where: { id: runId },
        data: { status: 'FAILED', error: message.slice(0, 2000), finishedAt: new Date() },
      });
    }
  }

  async getRun(tenantId: string, runId: string) {
    const run = await this.findRun(tenantId, runId);
    const issues = (run.issues as SheetSyncIssue[] | null) ?? [];
    return { ...run, issues: issues.slice(0, 500), issueCount: issues.length };
  }

  async issuesWorkbook(tenantId: string, runId: string) {
    const run = await this.findRun(tenantId, runId);
    const issues = (run.issues as SheetSyncIssue[] | null) ?? [];
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Check list');
    sheet.columns = [
      { header: 'Issue', key: 'type', width: 34 },
      { header: 'Sheet row', key: 'row', width: 10 },
      { header: 'Pencawang', key: 'pencawang', width: 40 },
      { header: 'No Tiang', key: 'pole', width: 18 },
      { header: 'Group', key: 'group', width: 22 },
      { header: 'In the sheet', key: 'sheetValue', width: 14 },
      { header: 'ASCURE', key: 'ascureValue', width: 14 },
      { header: 'Detail', key: 'detail', width: 50 },
      { header: 'Count', key: 'count', width: 8 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const issue of issues) sheet.addRow({ ...issue, type: ISSUE_LABELS[issue.type] ?? issue.type });
    const stamp = run.startedAt.toISOString().slice(0, 10);
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: `sheet-sync-check-list-${stamp}.xlsx`,
    };
  }

  // ── the sync itself ────────────────────────────────────────────────────────

  private async sync(targetId: string, dryRun: boolean) {
    const target = await this.prisma.sheetSyncTarget.findUniqueOrThrow({ where: { id: targetId } });
    const client = this.getClient();
    const sheet = await client.findSheet(target.spreadsheetId, target.sheetTitle);
    const values = await client.readFormatted(target.spreadsheetId, target.sheetTitle);
    const layout = parseLayout(values);
    const issues: SheetSyncIssue[] = [];
    const addIssue = (issue: SheetSyncIssue) => {
      if (issues.length < MAX_ISSUES) issues.push(issue);
    };
    for (const heading of layout.unknownGroups) addIssue({ type: 'UNKNOWN_GROUP', detail: heading });

    const rows: SheetRow[] = [];
    for (let index = layout.headerRow + 1; index < values.length; index += 1) {
      const cells = values[index] ?? [];
      const pole = (cells[layout.poleCol] ?? '').trim();
      const fl = (cells[layout.flCol] ?? '').trim();
      if (!pole && !fl) continue;
      rows.push({
        index,
        fl,
        name: (cells[layout.nameCol] ?? '').trim(),
        pole,
        coord: cells[layout.coordCol] ?? '',
        cells,
      });
    }

    // Pencawang: FL code against Kod Pencawang / Functional Location, then the name.
    const substations = await this.prisma.substation.findMany({
      where: { tenantId: target.tenantId },
      select: { id: true, code: true, location: true, name: true },
    });
    const index = new Map<string, Set<string>>();
    const put = (key: string, id: string) => {
      if (!key) return;
      const set = index.get(key) ?? new Set<string>();
      set.add(id);
      index.set(key, set);
    };
    for (const substation of substations) {
      put(`FL:${compact(substation.code)}`, substation.id);
      put(`FL:${compact(substation.location)}`, substation.id);
      put(`NAME:${compact(substation.name)}`, substation.id);
    }
    const peFor = new Map<string, string[]>();
    const resolvePe = (row: SheetRow) => {
      const cacheKey = `${row.fl}|${row.name}`;
      let ids = peFor.get(cacheKey);
      if (!ids) {
        const byFl = row.fl ? index.get(`FL:${compact(row.fl)}`) : undefined;
        const byName = row.name ? index.get(`NAME:${compact(row.name)}`) : undefined;
        ids = [...(byFl?.size ? byFl : byName ?? [])];
        peFor.set(cacheKey, ids);
      }
      return ids;
    };
    const matchedSubstationIds = new Set<string>();
    for (const row of rows) resolvePe(row).forEach((id) => matchedSubstationIds.add(id));

    const assets = await this.prisma.asset.findMany({
      where: { tenantId: target.tenantId, substationId: { in: [...matchedSubstationIds] } },
      select: { id: true, assetCode: true, latitude: true, longitude: true, substationId: true },
    });
    const poles = new Map<string, typeof assets>();
    for (const asset of assets) {
      const key = `${asset.substationId}|${poleKey(asset.assetCode)}`;
      poles.set(key, [...(poles.get(key) ?? []), asset]);
    }
    const assetsBySubstation = new Map<string, typeof assets>();
    for (const asset of assets) {
      const list = assetsBySubstation.get(asset.substationId ?? '') ?? [];
      list.push(asset);
      assetsBySubstation.set(asset.substationId ?? '', list);
    }

    // Row → pole: No Tiang within the Pencawang, confirmed by GPS.
    const matches: Array<{ row: SheetRow; assetId: string; rowKey: string }> = [];
    const missingPe = new Map<string, number>();
    let poleNotFound = 0;
    let gpsMismatch = 0;
    let noGps = 0;
    for (const row of rows) {
      const peIds = resolvePe(row);
      const label = row.name || row.fl;
      if (!peIds.length) {
        missingPe.set(label, (missingPe.get(label) ?? 0) + 1);
        continue;
      }
      const candidates = peIds.flatMap((id) => poles.get(`${id}|${poleKey(row.pole)}`) ?? []);
      const sheetGps = parseCoordinate(row.coord);
      if (candidates.length !== 1) {
        poleNotFound += 1;
        let detail = candidates.length > 1 ? 'More than one ASCURE pole with this No Tiang' : undefined;
        if (!candidates.length && sheetGps) {
          const near = peIds
            .flatMap((id) => assetsBySubstation.get(id) ?? [])
            .filter((asset) => asset.latitude != null && asset.longitude != null)
            .map((asset) => ({ asset, metres: distanceMetres(sheetGps, { lat: asset.latitude!, lng: asset.longitude! }) }))
            .sort((a, b) => a.metres - b.metres)[0];
          if (near && near.metres <= GPS_TOLERANCE_M) {
            detail = `GPS points to ASCURE pole "${near.asset.assetCode}" (${Math.round(near.metres)} m)`;
          }
        }
        addIssue({ type: 'POLE_NOT_FOUND', row: row.index + 1, pencawang: label, pole: row.pole, detail });
        continue;
      }
      const asset = candidates[0];
      if (!sheetGps || asset.latitude == null || asset.longitude == null) {
        noGps += 1;
        addIssue({
          type: 'NO_GPS',
          row: row.index + 1,
          pencawang: label,
          pole: row.pole,
          detail: sheetGps ? 'The ASCURE pole has no GPS' : 'The sheet row has no readable COORDINATE TIANG',
        });
        continue;
      }
      const metres = distanceMetres(sheetGps, { lat: asset.latitude, lng: asset.longitude });
      if (metres > GPS_TOLERANCE_M) {
        gpsMismatch += 1;
        addIssue({
          type: 'GPS_MISMATCH',
          row: row.index + 1,
          pencawang: label,
          pole: row.pole,
          detail: `${Math.round(metres)} m apart`,
        });
        continue;
      }
      matches.push({ row, assetId: asset.id, rowKey: `${compact(row.fl || row.name)}|${poleKey(row.pole)}` });
    }
    for (const [pencawang, count] of missingPe) addIssue({ type: 'PE_NOT_FOUND', pencawang, count });

    const seen = new Map<string, number>();
    for (const match of matches) seen.set(match.rowKey, (seen.get(match.rowKey) ?? 0) + 1);
    let duplicateRows = 0;
    for (const match of matches) {
      if ((seen.get(match.rowKey) ?? 0) > 1) {
        duplicateRows += 1;
        addIssue({
          type: 'DUPLICATE_ROW',
          row: match.row.index + 1,
          pencawang: match.row.name || match.row.fl,
          pole: match.row.pole,
          detail: 'Written on every copy',
        });
      }
    }

    // Verified repairs → first repair date per pole × group.
    const firstRepair = new Map<string, Map<SheetGroupId, Date>>();
    const noColumn = new Map<string, number>();
    let verifiedRepairs = 0;
    const assetIds = [...new Set(matches.map((match) => match.assetId))];
    for (let start = 0; start < assetIds.length; start += 2000) {
      const defects = await this.prisma.defect.findMany({
        where: {
          closureVerifiedAt: { not: null },
          lifecycleStatus: DefectLifecycleStatus.CLOSED,
          maintainedAt: { not: null },
          OR: [{ resolutionOutcome: null }, { resolutionOutcome: { notIn: CANNOT_REPAIR } }],
          inspectionItemResult: { inspection: { assetId: { in: assetIds.slice(start, start + 2000) } } },
        },
        select: {
          maintainedAt: true,
          inspectionItemResult: {
            select: { label: true, checklistItemId: true, inspection: { select: { assetId: true } } },
          },
        },
      });
      const itemIds = [
        ...new Set(defects.map((defect) => defect.inspectionItemResult.checklistItemId).filter((id): id is string => !!id)),
      ];
      const sections = new Map(
        (
          await this.prisma.inspectionTemplateItem.findMany({
            where: { id: { in: itemIds } },
            select: { id: true, section: { select: { title: true } } },
          })
        ).map((item) => [item.id, item.section.title]),
      );
      for (const defect of defects) {
        const result = defect.inspectionItemResult;
        const group = groupForItem(result.label, result.checklistItemId ? sections.get(result.checklistItemId) : null);
        if (!group || !layout.groups.some((entry) => entry.id === group)) {
          noColumn.set(result.label, (noColumn.get(result.label) ?? 0) + 1);
          continue;
        }
        verifiedRepairs += 1;
        const perPole = firstRepair.get(result.inspection.assetId) ?? new Map<SheetGroupId, Date>();
        const current = perPole.get(group);
        if (!current || defect.maintainedAt! < current) perPole.set(group, defect.maintainedAt!);
        firstRepair.set(result.inspection.assetId, perPole);
      }
    }
    for (const [label, count] of noColumn) addIssue({ type: 'NO_COLUMN', detail: label, count });

    // Decide each cell against what is there and what ASCURE wrote before.
    const records = new Map(
      (await this.prisma.sheetSyncCell.findMany({ where: { targetId } })).map((cell) => [
        `${cell.rowKey}#${cell.groupKey}`,
        cell,
      ]),
    );
    const updates: SheetCellUpdate[] = [];
    const upserts = new Map<string, { rowKey: string; groupKey: string; value: string }>();
    const deletes = new Set<string>();
    let written = 0;
    let updated = 0;
    let alreadyCorrect = 0;
    let clashes = 0;
    let cleared = 0;
    for (const match of matches) {
      const perPole = firstRepair.get(match.assetId);
      for (const group of layout.groups) {
        const key = `${match.rowKey}#${group.id}`;
        const prior = records.get(key);
        const current = normaliseCellDate(match.row.cells[group.dateCol]);
        const repairedAt = perPole?.get(group.id);
        if (repairedAt) {
          const date = malaysiaDate(repairedAt);
          if (current === date.text) {
            alreadyCorrect += 1;
            if (prior && prior.value !== date.text) upserts.set(key, { rowKey: match.rowKey, groupKey: group.id, value: date.text });
          } else if (!current || (prior && current === prior.value)) {
            if (current) updated += 1;
            else written += 1;
            updates.push({ row: match.row.index, col: group.dateCol, dateSerial: date.serial });
            upserts.set(key, { rowKey: match.rowKey, groupKey: group.id, value: date.text });
          } else {
            clashes += 1;
            addIssue({
              type: 'CLASH',
              row: match.row.index + 1,
              pencawang: match.row.name || match.row.fl,
              pole: match.row.pole,
              group: group.heading,
              sheetValue: current,
              ascureValue: date.text,
            });
          }
        } else if (prior) {
          // No longer verified (sent back): take back only ASCURE's own date.
          if (current === prior.value) {
            cleared += 1;
            updates.push({ row: match.row.index, col: group.dateCol, dateSerial: null });
          }
          deletes.add(key);
        }
      }
    }

    if (!dryRun) {
      await client.writeDates(target.spreadsheetId, sheet.sheetId, updates);
      const now = new Date();
      for (const key of deletes) {
        const prior = records.get(key);
        if (prior) await this.prisma.sheetSyncCell.delete({ where: { id: prior.id } });
      }
      const pending = [...upserts.values()];
      for (let start = 0; start < pending.length; start += 200) {
        await this.prisma.$transaction(
          pending.slice(start, start + 200).map((cell) =>
            this.prisma.sheetSyncCell.upsert({
              where: { targetId_rowKey_groupKey: { targetId, rowKey: cell.rowKey, groupKey: cell.groupKey } },
              create: { targetId, ...cell, writtenAt: now },
              update: { value: cell.value, writtenAt: now },
            }),
          ),
        );
      }
    }

    const summary = {
      spreadsheetTitle: sheet.spreadsheetTitle,
      sheetTitle: target.sheetTitle,
      rows: rows.length,
      matched: matches.length,
      pencawangNotFound: [...missingPe.values()].reduce((sum, count) => sum + count, 0),
      poleNotFound,
      gpsMismatch,
      noGps,
      duplicateRows,
      verifiedRepairs,
      noColumn: [...noColumn.values()].reduce((sum, count) => sum + count, 0),
      written,
      updated,
      alreadyCorrect,
      clashes,
      cleared,
      issuesTruncated: issues.length >= MAX_ISSUES,
    };
    return { summary, issues };
  }
}

const RUN_SELECT = {
  id: true,
  targetId: true,
  trigger: true,
  dryRun: true,
  status: true,
  error: true,
  summary: true,
  triggeredByEmail: true,
  startedAt: true,
  finishedAt: true,
} as const;

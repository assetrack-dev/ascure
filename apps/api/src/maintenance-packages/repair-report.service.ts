import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DefectLifecycleStatus,
  DefectSeverity,
  DefectStatus,
  InspectionItemResultSource,
  MaintenanceCategory,
  Prisma,
  ResolutionOutcome,
} from '@prisma/client';
import { Workbook } from 'exceljs';
import { MATERIAL_SELECT, serializeMaterials } from './maintenance-materials.util';
import archiver from 'archiver';
import { randomUUID } from 'crypto';
import { createWriteStream, existsSync } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import { resolve } from 'path';
import { MimeType } from 'easy-template-x';
import { isCannotRepairOutcome } from '../common/authorization/maintenance-closure';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { buildDefectZipDirectory } from '../common/uploads.constants';
import { PrismaService } from '../prisma/prisma.service';
import { loadReportImage } from '../report-generation/report-image.util';
import { MaintenancePackagesService } from './maintenance-packages.service';
import { RELEASED_DEFECT_WHERE } from './package-routing.util';
import {
  renderRepairReportPdf,
  RepairCategory,
  RepairReportItem,
  RepairReportPhoto,
  RepairStage,
  RepairStatus,
} from './repair-report-layout';
import { dayStart, nextDayStart, previousNoTiangLama } from './maintenance-closure.service';
import { RepairPeriodStatus } from './dto/repair-report.dto';
import { MaintenanceTasksService } from './maintenance-tasks.service';
import { effectiveLama } from './maintenance-work.service';

const CATEGORY_LABEL: Record<MaintenanceCategory, string> = {
  RENTIS: 'Rentis',
  CAT_TIANG: 'Cat tiang',
  SELENGGARAAN: 'Selenggaraan',
};

const OUTCOME_LABEL: Partial<Record<ResolutionOutcome, string>> = {
  EXTERNAL_CONSTRAINT: 'Perlu gangguan bekalan / akses / pemilik tanah',
  ESCALATED: 'Perlu tindakan TNB',
  DEFERRED: 'Ditangguhkan',
};

/** Photos per stage on one Kejanggalan — keeps a card to one or two rows. */
const MAX_PHOTOS_PER_STAGE = 4;
/** Most Pencawang in one repair-report ZIP picked on the board. */
const REPAIR_ZIP_MAX = 40;
/** A by-date ZIP (plan §21, R7) picks its own Pencawang — a month of a big company fits. */
const REPAIR_PERIOD_ZIP_MAX = 150;

/** Plan §21 (R7): the period line on the PDF and the ZIP name. */
const PERIOD_STATUS_LABEL: Record<RepairPeriodStatus, string> = {
  VERIFIED: 'Disahkan',
  COMPLETED: 'Siap di tapak, belum disahkan',
  BOTH: 'Disahkan + siap di tapak',
};

/** ringkasan.xlsx status words (same as the PDF chips). */
const STATUS_WORD: Record<RepairStatus, string> = {
  CLOSED: 'Disahkan',
  AWAITING: 'Siap di tapak - menunggu pengesahan',
  IN_PROGRESS: 'Dalam pembaikan',
  TODO: 'Belum mula',
  CANNOT_REPAIR: 'Tidak dapat dibaiki',
};

/** One Kejanggalan's row in ringkasan.xlsx. */
type RepairSummaryRow = {
  pencawang: string;
  functionalLocation: string;
  mainhead: string;
  company: string;
  team: string;
  assetCode: string;
  noTiangLama: string;
  workType: string;
  repairMethod: string;
  category: RepairCategory;
  label: string;
  status: RepairStatus;
  repairedAt: Date | null;
  repairedBy: string;
  verifiedAt: Date | null;
  verifiedBy: string;
  materials: string;
};
const REPAIR_ZIP_TTL_MS = 2 * 60 * 60 * 1000;

interface RepairZipJob {
  id: string;
  tenantId: string;
  userId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  processed: number;
  total: number;
  currentLabel: string | null;
  fileName: string;
  filePath: string;
  error: string | null;
  createdAt: number;
}

export type RepairReportOptions = {
  organizationId?: string | null;
  category?: MaintenanceCategory | null;
  /** Plan §21 (R7): only the Kejanggalan of this period (yyyy-mm-dd, inclusive) … */
  from?: string | null;
  to?: string | null;
  /** … in this status (default VERIFIED) … */
  status?: RepairPeriodStatus | null;
  /** … of this team. */
  teamId?: string | null;
};

/**
 * "Laporan Pembaikan Kejanggalan" — the per-Pencawang, per-company repair
 * report for the contractor's claim (docs/PLAN-maintenance-flow.md §8 / §16):
 * every Kejanggalan routed to that company on the PE (optionally one work
 * type) with its status, BEFORE / DURING / AFTER photos, who repaired and who
 * verified it; DRAF until all are closed. Plus a background ZIP of many PEs
 * (same in-memory job pattern as the Laporan Kejanggalan ZIP).
 */
@Injectable()
export class RepairReportService {
  private readonly logger = new Logger(RepairReportService.name);
  private readonly zipJobs = new Map<string, RepairZipJob>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly packages: MaintenancePackagesService,
    private readonly tasks: MaintenanceTasksService,
  ) {}

  /**
   * Plan §21 (R7): a report by date keeps only the Kejanggalan whose chosen
   * status falls in the period — VERIFIED = signed off then (claimable),
   * COMPLETED = marked done then and not verified yet, BOTH = either.
   */
  private periodWhere(options: RepairReportOptions): Prisma.DefectWhereInput[] {
    if (!options.from || !options.to) return [];
    const range = { gte: dayStart(options.from), lt: nextDayStart(options.to) };
    const verified: Prisma.DefectWhereInput = {
      lifecycleStatus: DefectLifecycleStatus.CLOSED,
      closureVerifiedAt: range,
    };
    const completed: Prisma.DefectWhereInput = {
      lifecycleStatus: { in: [DefectLifecycleStatus.COMPLETED, DefectLifecycleStatus.VERIFICATION_PENDING] },
      maintainedAt: range,
    };
    const status = options.status ?? 'VERIFIED';
    const where: Prisma.DefectWhereInput[] = [
      status === 'VERIFIED' ? verified : status === 'COMPLETED' ? completed : { OR: [verified, completed] },
    ];
    if (options.teamId) {
      where.push({
        OR: [
          { assignedToTeamId: options.teamId },
          { assignedToTeamId: null, assignedTeamId: options.teamId },
        ],
      });
    }
    return where;
  }

  private periodLabel(options: RepairReportOptions) {
    if (!options.from || !options.to) return undefined;
    const day = (value: string) => value.slice(0, 10).split('-').reverse().join('/');
    return `${day(options.from)} - ${day(options.to)} (${PERIOD_STATUS_LABEL[options.status ?? 'VERIFIED']})`;
  }

  async generate(
    user: RequestUser,
    siteVisitId: string,
    options: RepairReportOptions,
  ): Promise<{ buffer: Buffer; filename: string; rows: RepairSummaryRow[] }> {
    const { visit, organization } = await this.packages.resolveRepairReportScope(
      user,
      siteVisitId,
      options.organizationId,
    );
    const category = options.category ?? null;

    const [details, defects] = await Promise.all([
      this.prisma.siteVisit.findUniqueOrThrow({
        where: { id: visit.id },
        select: {
          pencawangName: true,
          pencawangCode: true,
          functionalLocation: true,
          substation: { select: { name: true, code: true } },
          mainheadRecord: { select: { name: true } },
          maintenancePackages: {
            where: { maintenanceOrganizationId: organization.id },
            select: { category: true, dueDate: true },
          },
        },
      }),
      this.prisma.defect.findMany({
        where: {
          maintenanceOrganizationId: organization.id,
          ...(category === null
            ? {}
            : category === MaintenanceCategory.SELENGGARAAN
              ? { OR: [{ maintenanceCategory: category }, { maintenanceCategory: null }] }
              : { maintenanceCategory: category }),
          AND: [
            RELEASED_DEFECT_WHERE,
            {
              OR: [
                { isEmergency: true },
                { inspectionItemResult: { inspection: { completionStatus: 'SUBMITTED' } } },
              ],
            },
            ...this.periodWhere(options),
          ],
          inspectionItemResult: { isDefect: true, inspection: { siteVisitId: visit.id } },
        },
        select: {
          id: true,
          severity: true,
          isEmergency: true,
          maintenanceCategory: true,
          lifecycleStatus: true,
          status: true,
          resolutionOutcome: true,
          maintenanceNotes: true,
          maintainedAt: true,
          closureVerifiedAt: true,
          repairMethodNote: true,
          repairMethod: { select: { label: true } },
          maintainedByUser: { select: { name: true } },
          closureVerifiedByUser: {
            select: { name: true, clientRank: true, organization: { select: { name: true } } },
          },
          assignedToTeam: { select: { name: true } },
          assignedTeam: { select: { name: true } },
          // TNB feedback #1: materials used, per Kejanggalan + a total.
          materials: { select: MATERIAL_SELECT },
          evidenceImages: {
            where: { evidenceType: { in: ['BEFORE', 'DURING', 'AFTER'] } },
            orderBy: { createdAt: 'asc' },
            select: {
              evidenceType: true,
              url: true,
              storageKey: true,
              fileName: true,
              timestamp: true,
              createdAt: true,
            },
          },
          inspectionItemResult: {
            select: {
              label: true,
              remark: true,
              source: true,
              createdAt: true,
              createdBy: { select: { name: true } },
              inspection: {
                select: {
                  asset: {
                    select: { id: true, assetCode: true, noTiangLama: true, name: true, latitude: true, longitude: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const period = this.periodLabel(options);
    if (defects.length === 0) {
      if (period) {
        throw new BadRequestException(`${organization.name} has no Kejanggalan here for ${period}.`);
      }
      throw new BadRequestException(
        category
          ? `${organization.name} has no ${CATEGORY_LABEL[category]} Kejanggalan on this Pencawang.`
          : `${organization.name} has no Kejanggalan on this Pencawang.`,
      );
    }

    const counts: Record<RepairStatus, number> = {
      CLOSED: 0,
      AWAITING: 0,
      IN_PROGRESS: 0,
      TODO: 0,
      CANNOT_REPAIR: 0,
    };
    const survey: RepairReportItem[] = [];
    const findings: RepairReportItem[] = [];
    const cannot: RepairReportItem[] = [];
    const teams = new Set<string>();
    const rows: RepairSummaryRow[] = [];

    const sorted = [...defects].sort(
      (left, right) =>
        left.inspectionItemResult.inspection.asset.assetCode.localeCompare(
          right.inspectionItemResult.inspection.asset.assetCode,
          undefined,
          { numeric: true, sensitivity: 'base' },
        ) || left.inspectionItemResult.label.localeCompare(right.inspectionItemResult.label),
    );

    // Plan §20 (P3): poles whose No Tiang Lama the crew corrected on site.
    const previousLama = await previousNoTiangLama(
      this.prisma,
      sorted.map((defect) => defect.inspectionItemResult.inspection.asset.id),
    );

    for (const defect of sorted) {
      const item = defect.inspectionItemResult;
      const asset = item.inspection.asset;
      // Closed = signed off. Mark done sets status RESOLVED with lifecycle
      // COMPLETED — that is "waiting for verification", NOT closed (K35: DRAF
      // until every Kejanggalan is verified). RESOLVED only counts for an old
      // row with no lifecycle at all.
      const closed =
        defect.lifecycleStatus === DefectLifecycleStatus.CLOSED ||
        defect.status === DefectStatus.CLOSED ||
        (defect.lifecycleStatus === null && defect.status === DefectStatus.RESOLVED);
      const cannotRepair = isCannotRepairOutcome(defect.resolutionOutcome);
      const status: RepairStatus = closed
        ? 'CLOSED'
        : cannotRepair
          ? 'CANNOT_REPAIR'
          : defect.lifecycleStatus === DefectLifecycleStatus.COMPLETED ||
              defect.lifecycleStatus === DefectLifecycleStatus.VERIFICATION_PENDING
            ? 'AWAITING'
            : defect.lifecycleStatus === DefectLifecycleStatus.IN_PROGRESS
              ? 'IN_PROGRESS'
              : 'TODO';
      counts[status] += 1;

      const team = defect.assignedToTeam?.name ?? defect.assignedTeam?.name ?? null;
      if (team) teams.add(team);
      const isFinding = item.source === InspectionItemResultSource.MAINTENANCE_FINDING;

      const notes: string[] = [];
      if (item.remark && item.remark.trim() && item.remark.trim() !== item.label.trim()) {
        notes.push(item.remark.trim());
      }
      if (defect.isEmergency) notes.push('KECEMASAN');
      if (isFinding) {
        notes.push(
          `Penemuan baharu semasa penyelenggaraan${item.createdBy?.name ? ` oleh ${item.createdBy.name}` : ''} pada ${this.fmtDate(item.createdAt)}`,
        );
      }
      if (cannotRepair) {
        notes.push(
          `Sebab tidak dapat dibaiki: ${
            (defect.resolutionOutcome && OUTCOME_LABEL[defect.resolutionOutcome]) ?? defect.resolutionOutcome
          }${defect.maintenanceNotes ? ` - ${defect.maintenanceNotes}` : ''}`,
        );
      } else if (defect.maintenanceNotes) {
        notes.push(`Catatan pasukan: ${defect.maintenanceNotes}`);
      }
      // Plan §20 (P2): what the "Lain-lain" kind of repair was.
      if (defect.repairMethodNote) {
        notes.push(`Kaedah: ${defect.repairMethodNote}`);
      }
      // Plan §20 (P3): owner — show both, so TNB sees why the number changed.
      if (previousLama.has(asset.id)) {
        notes.push(
          `No Tiang Lama: ${effectiveLama(asset) ?? '-'} (dahulu: ${previousLama.get(asset.id) ?? '-'})`,
        );
      }

      const verifier = defect.closureVerifiedByUser;
      const reportItem: RepairReportItem = {
        assetCode: asset.assetCode,
        gps:
          asset.latitude != null && asset.longitude != null
            ? `${Number(asset.latitude).toFixed(5)}, ${Number(asset.longitude).toFixed(5)}`
            : '',
        workType: defect.repairMethod
          ? `${CATEGORY_LABEL[defect.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN]} · ${defect.repairMethod.label}`
          : CATEGORY_LABEL[defect.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN],
        category: this.categoryFor(defect.severity),
        status,
        label: item.label,
        notes,
        who: this.whoLines(status, team, defect, verifier),
        materials: serializeMaterials(defect.materials),
        photos: await this.loadPhotos(defect.evidenceImages),
      };

      rows.push({
        pencawang: '',
        functionalLocation: '',
        mainhead: '',
        company: organization.name,
        team: team ?? '',
        assetCode: asset.assetCode,
        noTiangLama: effectiveLama(asset) ?? '',
        workType: CATEGORY_LABEL[defect.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN],
        repairMethod: defect.repairMethod
          ? `${defect.repairMethod.label}${defect.repairMethodNote ? ` - ${defect.repairMethodNote}` : ''}`
          : '',
        category: reportItem.category,
        label: item.label,
        status,
        repairedAt: defect.maintainedAt,
        repairedBy: defect.maintainedByUser?.name ?? '',
        verifiedAt: status === 'CLOSED' ? defect.closureVerifiedAt : null,
        verifiedBy: status === 'CLOSED' ? (verifier?.name ?? '') : '',
        materials: reportItem.materials
          .map((material) => `${material.description} ${material.quantity} ${material.unit}`.trim())
          .join('; '),
      });

      if (cannotRepair) cannot.push(reportItem);
      else if (isFinding) findings.push(reportItem);
      else survey.push(reportItem);
    }

    const dueDates = details.maintenancePackages
      .filter((pkg) => category === null || pkg.category === null || pkg.category === category)
      .map((pkg) => pkg.dueDate)
      .filter((date): date is Date => date !== null)
      .sort((left, right) => left.getTime() - right.getTime());
    const pencawangName =
      details.substation?.name ?? details.pencawangName ?? details.pencawangCode ?? '';

    const buffer = await renderRepairReportPdf({
      pencawangName,
      functionalLocation: details.functionalLocation ?? details.pencawangCode ?? details.substation?.code ?? '',
      mainhead: details.mainheadRecord?.name ?? '',
      company: organization.name,
      teams: [...teams].sort().join(', '),
      scope: category ? CATEGORY_LABEL[category] : 'Semua jenis kerja',
      targetDate: dueDates[0] ? this.fmtDate(dueDates[0]) : '',
      period,
      generatedAt: this.fmtDateTime(new Date()),
      draft: counts.CLOSED < defects.length,
      counts,
      sections: [
        { title: 'KEJANGGALAN DARIPADA RONDAAN', items: survey },
        { title: 'PENEMUAN BAHARU (TIADA DALAM RONDAAN)', items: findings },
        { title: 'TIDAK DAPAT DIBAIKI', items: cannot },
      ],
      sanitize: (value) => this.winAnsiSafe(value),
    });

    const functionalLocation = details.functionalLocation ?? details.pencawangCode ?? details.substation?.code ?? '';
    for (const row of rows) {
      row.pencawang = pencawangName;
      row.functionalLocation = functionalLocation;
      row.mainhead = details.mainheadRecord?.name ?? '';
    }

    const periodPart =
      options.from && options.to ? `-${options.from.slice(0, 10)}_${options.to.slice(0, 10)}` : '';
    const filename = `laporan-pembaikan-${this.forFilename(pencawangName || 'pencawang')}-${this.forFilename(
      organization.name,
    )}${category ? `-${category.toLowerCase()}` : ''}${periodPart}.pdf`;
    return { buffer, filename, rows };
  }

  // ── Batch ZIP (background) ────────────────────────────────────────────────

  async startZipJob(
    user: RequestUser,
    siteVisitIds: string[] | undefined,
    options: RepairReportOptions,
  ): Promise<{ jobId: string; total: number }> {
    const byDate = !siteVisitIds?.length;
    let targets: Array<{ siteVisitId: string; organizationId: string | null }>;
    if (byDate) {
      // Plan §21 (R7): every Pencawang (per company) with Kejanggalan of the period.
      if (!options.from || !options.to) {
        throw new BadRequestException('Pick Pencawang, or a from and a to date.');
      }
      const period = await this.tasks.periodTargets(user, options);
      targets = period.targets.map((target) => ({
        siteVisitId: target.siteVisitId,
        organizationId: target.company.id,
      }));
      if (targets.length === 0) {
        throw new BadRequestException('No Kejanggalan in that period with that status.');
      }
      if (targets.length > REPAIR_PERIOD_ZIP_MAX) {
        throw new BadRequestException(
          `That period covers ${targets.length} Pencawang; at most ${REPAIR_PERIOD_ZIP_MAX} per ZIP. Pick a shorter period or one work type.`,
        );
      }
    } else {
      const ids = [...new Set(siteVisitIds)];
      if (ids.length > REPAIR_ZIP_MAX) {
        throw new BadRequestException(`At most ${REPAIR_ZIP_MAX} Pencawang per repair-report ZIP.`);
      }
      // Fails fast (403) for someone who may not use the board at all.
      await this.packages.resolveRepairReportScope(user, ids[0], options.organizationId).catch((error) => {
        if (error instanceof HttpException && error.getStatus() === 403) throw error;
      });
      targets = ids.map((siteVisitId) => ({ siteVisitId, organizationId: options.organizationId ?? null }));
    }

    const now = Date.now();
    for (const [jobId, job] of this.zipJobs) {
      if (now - job.createdAt > REPAIR_ZIP_TTL_MS) {
        this.zipJobs.delete(jobId);
        void unlink(job.filePath).catch(() => undefined);
      }
    }

    const directory = buildDefectZipDirectory();
    await mkdir(directory, { recursive: true });
    const jobId = randomUUID();
    const stamp =
      byDate && options.from && options.to
        ? `${options.from.slice(0, 10)}_${options.to.slice(0, 10)}`
        : new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const job: RepairZipJob = {
      id: jobId,
      tenantId: user.tenantId,
      userId: user.id,
      status: 'RUNNING',
      processed: 0,
      total: targets.length,
      currentLabel: null,
      fileName: `laporan-pembaikan-${stamp}.zip`,
      filePath: resolve(directory, `repair-${jobId}.zip`),
      error: null,
      createdAt: now,
    };
    this.zipJobs.set(jobId, job);
    void this.runZipJob(job, targets, user, options, byDate);
    return { jobId, total: targets.length };
  }

  private async runZipJob(
    job: RepairZipJob,
    targets: Array<{ siteVisitId: string; organizationId: string | null }>,
    user: RequestUser,
    options: RepairReportOptions,
    byDate: boolean,
  ): Promise<void> {
    const siteVisitIds = [...new Set(targets.map((target) => target.siteVisitId))];
    try {
      const output = createWriteStream(job.filePath);
      const archive = archiver('zip', { store: true });
      const closed = new Promise<void>((resolveClosed, rejectClosed) => {
        output.on('close', () => resolveClosed());
        output.on('error', rejectClosed);
        archive.on('error', rejectClosed);
      });
      archive.pipe(output);

      const visits = await this.prisma.siteVisit.findMany({
        where: { id: { in: siteVisitIds }, tenantId: user.tenantId },
        select: { id: true, pencawangName: true, pencawangCode: true, substation: { select: { name: true } } },
      });
      const labelOf = new Map(
        visits.map((visit) => [
          visit.id,
          visit.substation?.name ?? visit.pencawangName ?? visit.pencawangCode ?? visit.id,
        ]),
      );
      const manifest: string[] = [];
      const usedNames = new Set<string>();
      const summary: RepairSummaryRow[] = [];
      // Sequential on purpose: one report's photos in memory at a time.
      for (const { siteVisitId, organizationId } of targets) {
        const label = labelOf.get(siteVisitId) ?? siteVisitId;
        job.currentLabel = label;
        try {
          const { buffer, filename, rows } = await this.generate(user, siteVisitId, {
            ...options,
            organizationId: organizationId ?? options.organizationId,
          });
          summary.push(...rows);
          let entryName = filename;
          if (usedNames.has(entryName)) {
            entryName = entryName.replace(/\.pdf$/, ` (${siteVisitId.slice(0, 8)}).pdf`);
          }
          usedNames.add(entryName);
          archive.append(buffer, { name: entryName });
          manifest.push(`${entryName} - ${label}`);
        } catch (error) {
          manifest.push(`TIADA - ${label} (${error instanceof Error ? error.message : String(error)})`);
        }
        job.processed += 1;
      }
      const period = this.periodLabel(options);
      archive.append(
        `Laporan Pembaikan Kejanggalan ASCURE - ${new Date().toISOString()}\n${
          period ? `Tempoh: ${period}\n` : ''
        }\n${manifest.join('\n')}\n`,
        { name: 'SENARAI.txt' },
      );
      // Plan §21 (R7): one row per Kejanggalan of the period, for the claim.
      if (byDate) {
        archive.append(await this.summaryWorkbook(summary, period ?? ''), { name: 'ringkasan.xlsx' });
      }
      await archive.finalize();
      await closed;
      job.currentLabel = null;
      job.status = 'COMPLETED';
    } catch (error) {
      job.status = 'FAILED';
      job.error = error instanceof Error ? error.message : String(error);
      job.currentLabel = null;
      void unlink(job.filePath).catch(() => undefined);
      this.logger.error(`Repair-report ZIP job ${job.id} failed: ${job.error}`);
    }
  }

  private jobFor(user: RequestUser, jobId: string) {
    const job = this.zipJobs.get(jobId);
    if (!job || job.tenantId !== user.tenantId || job.userId !== user.id) {
      throw new NotFoundException('ZIP job not found — it may have expired or the API restarted; start it again.');
    }
    return job;
  }

  getZipJobStatus(user: RequestUser, jobId: string) {
    const job = this.jobFor(user, jobId);
    return {
      status: job.status,
      processed: job.processed,
      total: job.total,
      currentLabel: job.currentLabel,
      error: job.error,
    };
  }

  getZipFile(user: RequestUser, jobId: string): { filePath: string; fileName: string } {
    const job = this.jobFor(user, jobId);
    if (job.status !== 'COMPLETED') {
      throw new BadRequestException(
        job.status === 'FAILED' ? `The ZIP job failed: ${job.error ?? 'unknown error'}` : 'The ZIP is still being generated.',
      );
    }
    if (!existsSync(job.filePath)) {
      this.zipJobs.delete(jobId);
      throw new NotFoundException('The ZIP file is gone (expired or the API restarted) — start the job again.');
    }
    return { filePath: job.filePath, fileName: job.fileName };
  }

  /** ringkasan.xlsx — every Kejanggalan in the by-date ZIP, one row each. */
  private async summaryWorkbook(rows: RepairSummaryRow[], period: string): Promise<Buffer> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Ringkasan');
    const columns: Array<{ header: string; width: number; value: (row: RepairSummaryRow) => string | Date | null }> = [
      { header: 'Pencawang', width: 30, value: (row) => row.pencawang },
      { header: 'Lokasi Fungsian', width: 18, value: (row) => row.functionalLocation },
      { header: 'Mainhead', width: 18, value: (row) => row.mainhead },
      { header: 'Syarikat', width: 24, value: (row) => row.company },
      { header: 'Pasukan', width: 18, value: (row) => row.team },
      { header: 'No Tiang', width: 18, value: (row) => row.assetCode },
      { header: 'No Tiang Lama', width: 16, value: (row) => row.noTiangLama },
      { header: 'Jenis Kerja', width: 14, value: (row) => row.workType },
      { header: 'Kaedah', width: 20, value: (row) => row.repairMethod },
      { header: 'Kategori', width: 9, value: (row) => row.category },
      { header: 'Kejanggalan', width: 40, value: (row) => row.label },
      { header: 'Status', width: 30, value: (row) => STATUS_WORD[row.status] },
      { header: 'Tarikh Dibaiki', width: 14, value: (row) => row.repairedAt },
      { header: 'Dibaiki Oleh', width: 20, value: (row) => row.repairedBy },
      { header: 'Tarikh Disahkan', width: 14, value: (row) => row.verifiedAt },
      { header: 'Disahkan Oleh', width: 20, value: (row) => row.verifiedBy },
      { header: 'Bahan Digunakan', width: 40, value: (row) => row.materials },
    ];
    sheet.columns = columns.map((column) => ({ width: column.width }));
    sheet.addRow([`Laporan Pembaikan Kejanggalan - ${period}`]).font = { bold: true };
    sheet.addRow([]);
    sheet.addRow(columns.map((column) => column.header)).font = { bold: true };
    // Dates as Malaysia calendar days (a sheet has no time zone).
    const asDay = (value: Date) => new Date(`${this.fmtDate(value).split('/').reverse().join('-')}T00:00:00Z`);
    for (const row of rows) {
      const added = sheet.addRow(
        columns.map((column) => {
          const value = column.value(row);
          return value instanceof Date ? asDay(value) : value;
        }),
      );
      for (const index of [13, 15]) added.getCell(index).numFmt = 'dd/mm/yyyy';
    }
    sheet.views = [{ state: 'frozen', ySplit: 3 }];
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async loadPhotos(
    images: Array<{
      evidenceType: string;
      url: string | null;
      storageKey: string | null;
      fileName: string | null;
      timestamp: Date | null;
      createdAt: Date;
    }>,
  ): Promise<RepairReportPhoto[]> {
    const photos: RepairReportPhoto[] = [];
    for (const stage of ['BEFORE', 'DURING', 'AFTER'] as RepairStage[]) {
      const stageImages = images.filter((image) => image.evidenceType === stage).slice(-MAX_PHOTOS_PER_STAGE);
      for (const image of stageImages) {
        const loaded = await loadReportImage(image);
        if (!loaded) continue;
        const format =
          loaded.format === MimeType.Jpeg ? ('jpeg' as const) : loaded.format === MimeType.Png ? ('png' as const) : null;
        if (!format) continue;
        photos.push({
          data: loaded.source as Buffer,
          format,
          stage,
          takenAt: this.fmtDateTime(image.timestamp ?? image.createdAt),
        });
      }
    }
    return photos;
  }

  /**
   * "Dibaiki" only once the crew finished (awaiting verification / closed);
   * open work names the team; cannot-repair says who reported it.
   */
  private whoLines(
    status: RepairStatus,
    team: string | null,
    defect: { maintainedAt: Date | null; maintainedByUser: { name: string } | null; closureVerifiedAt: Date | null },
    verifier: { name: string; clientRank: string | null; organization: { name: string } | null } | null,
  ): string[] {
    const lines: string[] = [];
    const done = [team, defect.maintainedByUser?.name, this.fmtDate(defect.maintainedAt)].filter(Boolean).join(' - ');
    if ((status === 'AWAITING' || status === 'CLOSED') && defect.maintainedAt) {
      lines.push(`Dibaiki: ${done}`);
    } else if (status === 'CANNOT_REPAIR' && defect.maintainedAt) {
      lines.push(`Dilaporkan: ${done}`);
    } else if (team) {
      lines.push(`Pasukan: ${team} (belum selesai)`);
    }
    if (status === 'CLOSED' && defect.closureVerifiedAt) {
      lines.push(
        `Disahkan: ${[
          verifier?.name,
          verifier?.clientRank ? `TNB ${verifier.clientRank}` : verifier?.organization?.name,
          this.fmtDate(defect.closureVerifiedAt),
        ]
          .filter(Boolean)
          .join(' - ')}`,
      );
    }
    return lines;
  }

  /** A/B/C = the mobile mark-circle mapping (CRITICAL/HIGH→A, MEDIUM→B, LOW→C). */
  private categoryFor(severity: DefectSeverity | null): RepairCategory {
    if (severity === DefectSeverity.CRITICAL || severity === DefectSeverity.HIGH) return 'A';
    if (severity === DefectSeverity.LOW) return 'C';
    return 'B';
  }

  private fmtDate(date: Date | null | undefined) {
    if (!date) return '';
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur' }).format(date);
  }

  private fmtDateTime(date: Date | null | undefined) {
    if (!date) return '';
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
    return `${this.fmtDate(date)} ${time}`;
  }

  private static readonly WINANSI_EXTRAS = new Set(
    '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split('').map((ch) => ch.charCodeAt(0)),
  );

  /** StandardFonts throw outside cp1252 — map the rest to '?'. */
  private winAnsiSafe(value: string): string {
    return [...value.replace(/→/g, '-')]
      .map((ch) => {
        const code = ch.charCodeAt(0);
        return (code >= 0x20 && code <= 0xff) || RepairReportService.WINANSI_EXTRAS.has(code) ? ch : '?';
      })
      .join('');
  }

  private forFilename(value: string) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'x';
  }
}


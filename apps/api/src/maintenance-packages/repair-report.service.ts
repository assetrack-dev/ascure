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
  ResolutionOutcome,
} from '@prisma/client';
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
/** Most Pencawang in one repair-report ZIP. */
const REPAIR_ZIP_MAX = 40;
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
  ) {}

  async generate(
    user: RequestUser,
    siteVisitId: string,
    options: RepairReportOptions,
  ): Promise<{ buffer: Buffer; filename: string }> {
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
          maintainedByUser: { select: { name: true } },
          closureVerifiedByUser: {
            select: { name: true, clientRank: true, organization: { select: { name: true } } },
          },
          assignedToTeam: { select: { name: true } },
          assignedTeam: { select: { name: true } },
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
                    select: { assetCode: true, latitude: true, longitude: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    if (defects.length === 0) {
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

    const sorted = [...defects].sort(
      (left, right) =>
        left.inspectionItemResult.inspection.asset.assetCode.localeCompare(
          right.inspectionItemResult.inspection.asset.assetCode,
          undefined,
          { numeric: true, sensitivity: 'base' },
        ) || left.inspectionItemResult.label.localeCompare(right.inspectionItemResult.label),
    );

    for (const defect of sorted) {
      const item = defect.inspectionItemResult;
      const asset = item.inspection.asset;
      const closed =
        defect.lifecycleStatus === DefectLifecycleStatus.CLOSED ||
        defect.status === DefectStatus.RESOLVED ||
        defect.status === DefectStatus.CLOSED;
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

      const verifier = defect.closureVerifiedByUser;
      const reportItem: RepairReportItem = {
        assetCode: asset.assetCode,
        gps:
          asset.latitude != null && asset.longitude != null
            ? `${Number(asset.latitude).toFixed(5)}, ${Number(asset.longitude).toFixed(5)}`
            : '',
        workType: CATEGORY_LABEL[defect.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN],
        category: this.categoryFor(defect.severity),
        status,
        label: item.label,
        notes,
        who: this.whoLines(status, team, defect, verifier),
        photos: await this.loadPhotos(defect.evidenceImages),
      };

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

    const filename = `laporan-pembaikan-${this.forFilename(pencawangName || 'pencawang')}-${this.forFilename(
      organization.name,
    )}${category ? `-${category.toLowerCase()}` : ''}.pdf`;
    return { buffer, filename };
  }

  // ── Batch ZIP (background) ────────────────────────────────────────────────

  async startZipJob(
    user: RequestUser,
    siteVisitIds: string[],
    options: RepairReportOptions,
  ): Promise<{ jobId: string; total: number }> {
    const ids = [...new Set(siteVisitIds)];
    if (ids.length === 0) {
      throw new BadRequestException('No Pencawang were selected.');
    }
    if (ids.length > REPAIR_ZIP_MAX) {
      throw new BadRequestException(`At most ${REPAIR_ZIP_MAX} Pencawang per repair-report ZIP.`);
    }
    // Fails fast (403) for someone who may not use the board at all.
    await this.packages.resolveRepairReportScope(user, ids[0], options.organizationId).catch((error) => {
      if (error instanceof HttpException && error.getStatus() === 403) throw error;
    });

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
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const job: RepairZipJob = {
      id: jobId,
      tenantId: user.tenantId,
      userId: user.id,
      status: 'RUNNING',
      processed: 0,
      total: ids.length,
      currentLabel: null,
      fileName: `laporan-pembaikan-${stamp}.zip`,
      filePath: resolve(directory, `repair-${jobId}.zip`),
      error: null,
      createdAt: now,
    };
    this.zipJobs.set(jobId, job);
    void this.runZipJob(job, ids, user, options);
    return { jobId, total: ids.length };
  }

  private async runZipJob(
    job: RepairZipJob,
    siteVisitIds: string[],
    user: RequestUser,
    options: RepairReportOptions,
  ): Promise<void> {
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
      // Sequential on purpose: one report's photos in memory at a time.
      for (const siteVisitId of siteVisitIds) {
        const label = labelOf.get(siteVisitId) ?? siteVisitId;
        job.currentLabel = label;
        try {
          const { buffer, filename } = await this.generate(user, siteVisitId, options);
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
      archive.append(
        `Laporan Pembaikan Kejanggalan ASCURE - ${new Date().toISOString()}\n\n${manifest.join('\n')}\n`,
        { name: 'SENARAI.txt' },
      );
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


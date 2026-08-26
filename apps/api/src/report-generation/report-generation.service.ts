import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import archiver from 'archiver';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { resolve } from 'path';
import {
  InspectionCompletionStatus,
  OperationalScope,
  Prisma,
  ReportTemplate,
  SiteVisitReport,
  SiteVisitStatus,
  SurveyLifecycleStatus,
  UserRole,
} from '@prisma/client';
import { TemplateHandler } from 'easy-template-x';
import type { ImageContent, TemplateData } from 'easy-template-x';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { resolveCanReport } from '../common/authorization/reporting-actor';
import { releaseDefectsOnReport } from '../common/authorization/defect-governance';
import { normalizeChecklistLabel } from '../common/checklist-columns';
import { buildVisitReleasePlan } from '../defects/defect-release.util';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { inferOperationalScopeFromAssetTypeCode } from '../common/operational-scope';
import {
  buildReportTemplatePath,
  buildReportTemplateUrl,
  buildReportTemplatesDirectory,
  buildSiteVisitReportPath,
  buildSiteVisitReportUrl,
  buildSiteVisitReportsDirectory,
  resolveUploadPath,
} from '../common/uploads.constants';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { GotenbergService } from './gotenberg.service';
import { loadReportImage } from './report-image.util';

/**
 * Everything the `.docx` template can reference. Fixed scalar tags plus the
 * loop arrays (`{#readings}…{/readings}`, etc.) and conditional flags
 * (`{#hasDefects}…{/hasDefects}`). Documented for template authors in
 * apps/api/src/report-generation/PLACEHOLDER-CONTRACT.md.
 */
interface AssetReportData {
  assetCode: string;
  assetName: string;
  assetType: string;
  operationalScope: string;
  status: string;
  latitude: string;
  longitude: string;
  gps: string;
  noTiangLama: string;
  pencawang: string;
  pencawangCode: string;
  pencawangName: string;
  functionalLocation: string;
  mainhead: string;
  // SAVT route identity (blank on non-route surveys): the KOD TIANG route code,
  // the From/To Pencawang names, and `route` = "FROM → TO" ready-made.
  routeCode: string;
  fromPencawang: string;
  toPencawang: string;
  route: string;
  inspector: string;
  inspectorEmail: string;
  inspectionDate: string;
  submittedDate: string;
  visitType: string;
  cycle: string;
  generatedAt: string;
  readingCount: string;
  checkCount: string;
  defectCount: string;
  photoCount: string;
  hasReadings: boolean;
  hasChecks: boolean;
  hasDefects: boolean;
  hasPhotos: boolean;
  readings: Array<{ key: string; label: string; type: string; value: string }>;
  checks: Array<{
    label: string;
    result: string;
    remark: string;
    severity: string;
  }>;
  defects: Array<{
    label: string;
    severity: string;
    status: string;
    lifecycle: string;
    dueDate: string;
    remark: string;
  }>;
  photos: Array<{ image: ImageContent; caption: string; source: string }>;
  // Per-IMAGE-item photos for the labelled loop ({#photoItems}); each item's
  // photo is ALSO exposed as a flat {img_<KEY>} tag for direct placement.
  photoItems: Array<{ key: string; label: string; tag: string; image: ImageContent }>;
  // Everything NOT tied to a checklist IMAGE item (ad-hoc captures + defect
  // evidence) — use {#otherPhotos} so placed item photos aren't duplicated.
  otherPhotos: Array<{ image: ImageContent; caption: string; source: string }>;
  hasPhotoItems: boolean;
  hasOtherPhotos: boolean;
}

const assetReportInclude = {
  asset: {
    select: {
      id: true,
      assetCode: true,
      name: true,
      status: true,
      latitude: true,
      longitude: true,
      noTiangLama: true,
      assetType: {
        select: { code: true, name: true, operationalScope: true },
      },
      // The pole's CURRENT Pencawang — report name tags prefer the live entity
      // (what every screen shows) over the visit-creation snapshot.
      substation: { select: { name: true, code: true } },
    },
  },
  siteVisit: {
    select: {
      id: true,
      pencawangCode: true,
      pencawangName: true,
      functionalLocation: true,
      mainhead: true,
      mainheadRecord: { select: { code: true, name: true } },
      visitType: true,
      startedAt: true,
      completedAt: true,
      // SAVT route identity for the {routeCode}/{fromPencawang}/{toPencawang}
      // template tags — null/absent on SAVR visits.
      routeCode: true,
      fromPencawang: { select: { name: true, code: true } },
      toPencawang: { select: { name: true, code: true } },
    },
  },
  createdBy: { select: { name: true, email: true } },
  results: {
    include: {
      templateItem: {
        select: { key: true, label: true, inputType: true, sortOrder: true },
      },
    },
  },
  itemResults: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      // Links the verdict row to its checklist item so the LIVE recorded value
      // (InspectionResult) can overlay the frozen submit-time remark.
      checklistItemId: true,
      label: true,
      result: true,
      remark: true,
      isDefect: true,
      severity: true,
      defect: {
        select: {
          status: true,
          lifecycleStatus: true,
          severity: true,
          dueDate: true,
          actionRemark: true,
          evidenceImages: {
            orderBy: { createdAt: 'asc' },
            select: {
              fileName: true,
              storageKey: true,
              url: true,
              note: true,
              evidenceType: true,
            },
          },
        },
      },
    },
  },
  inspectionImages: {
    orderBy: { createdAt: 'asc' },
    select: {
      url: true,
      filename: true,
      templateItemId: true,
      latitude: true,
      longitude: true,
      timestamp: true,
      createdAt: true,
    },
  },
} satisfies Prisma.InspectionInclude;

type AssetReportInspection = Prisma.InspectionGetPayload<{
  include: typeof assetReportInclude;
}>;

const A4_PORTRAIT: [number, number] = [595.28, 841.89];

/**
 * Poles per compiled VOLUME (Jilid). Photos are downscaled before embedding
 * (report-image.util.ts), so a normal survey — even 300+ poles — compiles into
 * ONE manageable PDF; volume splitting survives only as a backstop for
 * enormous surveys where a single file would again strain memory/downloads.
 * Overridable via env for testing (REPORT_VOLUME_SIZE=1 forces one volume per
 * pole).
 */
const REPORT_VOLUME_SIZE = Math.max(
  1,
  Number(process.env.REPORT_VOLUME_SIZE ?? 500) || 500,
);

/** Sanity backstop on a single compile run (well above any real Pencawang). */
const MAX_ASSETS_PER_COMPILE = 2000;

/** Most site visits accepted into one batch generate / batch ZIP download. */
const BATCH_COMPILE_MAX = 20;

/** SiteVisitReportRun.status values. QUEUED runs belong to a batch and are
 *  waiting their turn — the batch loop compiles them strictly one at a time
 *  so a 10-survey batch never floods Gotenberg. */
const RUN_QUEUED = 'QUEUED';
const RUN_RUNNING = 'RUNNING';
const RUN_COMPLETED = 'COMPLETED';
const RUN_FAILED = 'FAILED';

/** The lifecycle states a compile may start from: the DC's review queue, the
 *  deprecated manager-approved state for in-flight surveys, AND an already
 *  frozen survey (LAPORAN SELESAI) — that last one is a REGENERATE: the report
 *  is re-issued from current data with the currently-active template as a NEW
 *  immutable version (downloads always serve the latest; older versions stay
 *  stored), e.g. after a template upgrade. */
const COMPILABLE_LIFECYCLE_STATES: SurveyLifecycleStatus[] = [
  SurveyLifecycleStatus.RONDAAN_SELESAI,
  SurveyLifecycleStatus.DISAHKAN_PENGURUS,
  SurveyLifecycleStatus.LAPORAN_SELESAI,
];

@Injectable()
export class ReportGenerationService implements OnModuleInit {
  private readonly logger = new Logger(ReportGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly gotenberg: GotenbergService,
  ) {}

  /** A compile run lives in this process only — an API restart orphans any
   *  RUNNING row, so sweep them to FAILED at boot (the survey lifecycle was
   *  never touched; the user simply generates again). */
  async onModuleInit(): Promise<void> {
    const swept = await this.prisma.siteVisitReportRun.updateMany({
      where: { status: RUN_RUNNING },
      data: {
        status: RUN_FAILED,
        error: 'Interrupted by an API restart — generate the report again.',
        finishedAt: new Date(),
      },
    });
    if (swept.count > 0) {
      this.logger.warn(
        `Marked ${swept.count} interrupted report compile run(s) as FAILED.`,
      );
    }
  }

  // ─── Template management (ADMIN) ──────────────────────────────────────────

  async uploadTemplate(
    user: RequestUser,
    file:
      | { originalname: string; mimetype: string; size: number; buffer: Buffer }
      | undefined,
    input: { name: string; operationalScope: OperationalScope },
  ): Promise<ReportTemplate> {
    this.assertAdmin(user);

    if (!file?.buffer?.length) {
      throw new BadRequestException('A .docx template file is required.');
    }
    if (!file.originalname.toLowerCase().endsWith('.docx')) {
      throw new BadRequestException('The template must be a .docx file.');
    }

    const directory = buildReportTemplatesDirectory();
    await mkdir(directory, { recursive: true });

    const fileName = `${Date.now()}-${randomUUID()}.docx`;
    await writeFile(resolve(directory, fileName), file.buffer);

    const storageKey = buildReportTemplatePath(fileName);
    const url = buildReportTemplateUrl(fileName);

    // Versioned: the new upload becomes the active template for its scope and
    // supersedes any prior active one (history is retained).
    const previousMax = await this.prisma.reportTemplate.aggregate({
      where: { tenantId: user.tenantId, operationalScope: input.operationalScope },
      _max: { version: true },
    });
    const version = (previousMax._max.version ?? 0) + 1;

    const [, template] = await this.prisma.$transaction([
      this.prisma.reportTemplate.updateMany({
        where: {
          tenantId: user.tenantId,
          operationalScope: input.operationalScope,
          isActive: true,
        },
        data: { isActive: false },
      }),
      this.prisma.reportTemplate.create({
        data: {
          tenantId: user.tenantId,
          name: input.name.trim() || file.originalname,
          operationalScope: input.operationalScope,
          fileName: file.originalname,
          storageKey,
          url,
          version,
          isActive: true,
          uploadedByUserId: user.id,
        },
      }),
    ]);

    return template;
  }

  async listTemplates(user: RequestUser): Promise<ReportTemplate[]> {
    await this.assertCanReport(user);
    return this.prisma.reportTemplate.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ operationalScope: 'asc' }, { version: 'desc' }],
    });
  }

  /**
   * Hard-delete a template (DB row + the `.docx` on disk). Safe: compiled
   * reports don't reference the template row (it's only used at compile time),
   * so removing one has no downstream effect. The file removal is best-effort.
   */
  async deleteTemplate(
    user: RequestUser,
    id: string,
  ): Promise<{ id: string }> {
    this.assertAdmin(user);

    const template = await this.prisma.reportTemplate.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!template) {
      throw new NotFoundException('Report template not found.');
    }

    await this.prisma.reportTemplate.delete({ where: { id: template.id } });

    try {
      await unlink(resolveUploadPath(template.storageKey));
    } catch (error) {
      this.logger.warn(
        `Deleted template ${template.id} row but its file was not removed ` +
          `(${template.storageKey}): ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }

    return { id: template.id };
  }

  // ─── Per-asset preview (on demand) ────────────────────────────────────────

  async generateAssetReport(
    user: RequestUser,
    assetId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertCanReport(user);

    const inspection = await this.findLatestSubmittedInspection(
      user.tenantId,
      assetId,
    );
    if (!inspection) {
      throw new NotFoundException(
        'No submitted inspection found for this asset.',
      );
    }

    const scope = this.resolveScope(inspection);
    if (!scope) {
      throw new BadRequestException(
        'This asset has no operational scope, so no report template can be matched.',
      );
    }

    const template = await this.loadActiveTemplate(user.tenantId, scope);
    if (!template) {
      throw new BadRequestException(
        `No active report template for ${scope}. Upload one under Report Templates.`,
      );
    }

    const pdf = await this.renderAssetPdf(inspection, template.buffer);
    const filename = `laporan-${this.sanitizeForFilename(
      inspection.asset.assetCode,
    )}.pdf`;
    return { buffer: pdf, filename };
  }

  // ─── Compile + freeze (LAPORAN SELESAI) — background run + volumes ────────

  /**
   * Start a BACKGROUND compile of a survey's visual report. Validates
   * everything that can fail fast (state, permissions, size, converter
   * health), records a SiteVisitReportRun and returns immediately — a
   * 400-pole Pencawang takes many minutes, far beyond any HTTP timeout. The
   * admin app polls {@link getCompileStatus} for progress. On success the run
   * commits its volume rows AND the LAPORAN SELESAI flip in one transaction;
   * on failure the lifecycle is untouched and the run carries the error.
   */
  async startCompileRun(
    user: RequestUser,
    siteVisitId: string,
  ): Promise<{ runId: string; totalAssets: number; status: string }> {
    await this.assertCanReport(user);

    const siteVisit = await this.prisma.siteVisit.findFirst({
      where: { id: siteVisitId, tenantId: user.tenantId },
      select: {
        id: true,
        tenantId: true,
        status: true,
        lifecycleStatus: true,
        visitAssets: { select: { assetId: true } },
      },
    });
    if (!siteVisit) {
      throw new NotFoundException('Site visit not found.');
    }
    if (siteVisit.status === SiteVisitStatus.CANCELLED) {
      throw new BadRequestException(
        'This site visit is cancelled; no report can be compiled.',
      );
    }
    if (
      !COMPILABLE_LIFECYCLE_STATES.includes(
        siteVisit.lifecycleStatus as SurveyLifecycleStatus,
      )
    ) {
      throw new BadRequestException(
        'A report is compiled from RONDAAN SELESAI (the DC review queue) or ' +
          'DISAHKAN PENGURUS — or regenerated from LAPORAN SELESAI.',
      );
    }

    const running = await this.prisma.siteVisitReportRun.findFirst({
      where: { siteVisitId, status: { in: [RUN_RUNNING, RUN_QUEUED] } },
      select: { id: true },
    });
    if (running) {
      throw new ConflictException(
        'A report compile is already queued or running for this survey.',
      );
    }

    const totalAssets = siteVisit.visitAssets.length;
    if (totalAssets === 0) {
      throw new BadRequestException('This survey has no linked assets.');
    }
    if (totalAssets > MAX_ASSETS_PER_COMPILE) {
      throw new BadRequestException(
        `This survey has ${totalAssets} assets; the compiler is capped at ` +
          `${MAX_ASSETS_PER_COMPILE}.`,
      );
    }

    // Fail fast if the converter is down — better than a run that dies on the
    // first pole.
    if (!(await this.gotenberg.isHealthy())) {
      throw new ServiceUnavailableException(
        'The document conversion service (Gotenberg) is unavailable. ' +
          'Ensure the ascure-gotenberg container is running, then retry.',
      );
    }

    const run = await this.prisma.siteVisitReportRun.create({
      data: {
        tenantId: siteVisit.tenantId,
        siteVisitId,
        totalAssets,
        startedByUserId: user.id,
      },
    });

    // Detached on purpose: the request returns now; the run row is the
    // progress/result channel. executeCompileRun catches its own errors — this
    // outer catch only guards against the failure-marking itself throwing.
    void this.executeCompileRun(run.id, user).catch((error) => {
      this.logger.error(
        `Report compile run ${run.id} crashed outside its own handler: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    });

    return { runId: run.id, totalAssets, status: RUN_RUNNING };
  }

  /** The background body of a compile run: resolve which poles are includable,
   *  split them into volumes (Jilid) by pole number, render each pole into its
   *  volume, then commit rows + the lifecycle flip atomically. */
  private async executeCompileRun(
    runId: string,
    user: RequestUser,
  ): Promise<void> {
    const writtenFiles: string[] = [];
    try {
      const run = await this.prisma.siteVisitReportRun.findUnique({
        where: { id: runId },
      });
      if (!run) {
        return;
      }
      if (run.status === RUN_QUEUED) {
        // A batch run's turn has come: flip it live and restart its clock so
        // the progress panel times the compile, not the time spent queued.
        await this.prisma.siteVisitReportRun.update({
          where: { id: runId },
          data: { status: RUN_RUNNING, startedAt: new Date() },
        });
      }
      const siteVisit = await this.prisma.siteVisit.findUnique({
        where: { id: run.siteVisitId },
        select: {
          id: true,
          tenantId: true,
          pencawangCode: true,
          pencawangName: true,
          visitType: true,
          startedAt: true,
          completedAt: true,
          substation: { select: { name: true, code: true } },
          // SAVT route identity for the cover page — null on SAVR visits.
          routeCode: true,
          fromPencawang: { select: { name: true, code: true } },
          toPencawang: { select: { name: true, code: true } },
          visitAssets: {
            orderBy: { addedAt: 'asc' },
            select: { assetId: true },
          },
        },
      });
      if (!siteVisit) {
        throw new Error('Site visit not found.');
      }

      // Resolve pass (cheap queries, no rendering): which poles CAN be
      // included, which are legitimately skipped, and each pole's code so
      // volumes split in pole order. Templates are resolved once per scope.
      const templateCache = new Map<
        OperationalScope,
        { buffer: Buffer } | null
      >();
      const loadTemplateCached = async (scope: OperationalScope) => {
        if (!templateCache.has(scope)) {
          templateCache.set(
            scope,
            await this.loadActiveTemplate(siteVisit.tenantId, scope),
          );
        }
        return templateCache.get(scope) ?? null;
      };

      const included: Array<{ assetId: string; assetCode: string }> = [];
      const skipped: Array<{ assetId: string; reason: string }> = [];
      for (const { assetId } of siteVisit.visitAssets) {
        const light = await this.prisma.inspection.findFirst({
          where: {
            tenantId: siteVisit.tenantId,
            assetId,
            completionStatus: InspectionCompletionStatus.SUBMITTED,
          },
          orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
          select: {
            operationalScope: true,
            asset: {
              select: {
                assetCode: true,
                assetType: { select: { code: true, operationalScope: true } },
              },
            },
          },
        });
        if (!light) {
          skipped.push({ assetId, reason: 'no submitted inspection' });
          continue;
        }
        const scope = this.resolveScope(light);
        if (!scope) {
          skipped.push({ assetId, reason: 'no operational scope' });
          continue;
        }
        if (!(await loadTemplateCached(scope))) {
          skipped.push({ assetId, reason: `no active template for ${scope}` });
          continue;
        }
        included.push({ assetId, assetCode: light.asset.assetCode });
      }

      if (included.length === 0) {
        throw new Error(
          'No asset reports could be generated. Ensure assets have submitted ' +
            'inspections and an active template exists for their operational scope.',
        );
      }

      // Volumes split in pole-number order so each Jilid covers a clean range.
      included.sort((a, b) =>
        a.assetCode.localeCompare(b.assetCode, undefined, { numeric: true }),
      );
      const volumes: Array<typeof included> = [];
      for (let i = 0; i < included.length; i += REPORT_VOLUME_SIZE) {
        volumes.push(included.slice(i, i + REPORT_VOLUME_SIZE));
      }

      const version = await this.nextReportVersion(siteVisit.id);
      const directory = buildSiteVisitReportsDirectory(siteVisit.id);
      await mkdir(directory, { recursive: true });

      const createInputs: Prisma.SiteVisitReportUncheckedCreateInput[] = [];
      let processed = 0;

      for (const [index, volumeAssets] of volumes.entries()) {
        const part = index + 1;
        const range =
          volumeAssets.length > 1
            ? `${volumeAssets[0].assetCode} — ${volumeAssets[volumeAssets.length - 1].assetCode}`
            : volumeAssets[0].assetCode;

        // Incremental merge: each pole's PDF is copied into the volume and its
        // buffer released — only ONE volume is ever in memory.
        const volumeDoc = await PDFDocument.create();
        await this.drawCoverPage(volumeDoc, siteVisit, {
          version,
          part,
          partCount: volumes.length,
          assetCount: volumeAssets.length,
          totalAssets: included.length,
          range,
        });

        for (const entry of volumeAssets) {
          const inspection = await this.findLatestSubmittedInspection(
            siteVisit.tenantId,
            entry.assetId,
          );
          if (!inspection) {
            // Present in the resolve pass, gone now (e.g. sent back for
            // re-inspection mid-compile). The frozen report must be complete —
            // abort rather than silently omit the pole.
            throw new Error(
              `Pole ${entry.assetCode} lost its submitted inspection while ` +
                'the report was compiling. Generate again.',
            );
          }
          const scope = this.resolveScope(inspection);
          const template = scope ? await loadTemplateCached(scope) : null;
          if (!template) {
            throw new Error(
              `Pole ${entry.assetCode} lost its report template while the ` +
                'report was compiling. Generate again.',
            );
          }
          const pdf = await this.renderAssetPdf(inspection, template.buffer);
          const source = await PDFDocument.load(pdf);
          const pages = await volumeDoc.copyPages(
            source,
            source.getPageIndices(),
          );
          pages.forEach((page) => volumeDoc.addPage(page));

          processed += 1;
          await this.prisma.siteVisitReportRun.update({
            where: { id: runId },
            data: { processedAssets: processed },
          });
        }

        const bytes = Buffer.from(await volumeDoc.save());
        // Single-volume reports (the normal case) drop the Jilid suffix.
        const fileName =
          volumes.length > 1
            ? `${Date.now()}-laporan-v${version}-jilid-${part}.pdf`
            : `${Date.now()}-laporan-v${version}.pdf`;
        await writeFile(resolve(directory, fileName), bytes);
        writtenFiles.push(resolve(directory, fileName));

        createInputs.push({
          tenantId: siteVisit.tenantId,
          siteVisitId: siteVisit.id,
          version,
          part,
          partCount: volumes.length,
          fileName,
          storageKey: buildSiteVisitReportPath(siteVisit.id, fileName),
          url: buildSiteVisitReportUrl(siteVisit.id, fileName),
          status: 'COMPLETED',
          compiledByUserId: user.id,
          metadata: {
            assetCount: volumeAssets.length,
            totalAssets: included.length,
            includedAssets: volumeAssets.map((a) => a.assetCode),
            range,
            // The skip list describes the whole run; record it once.
            ...(part === 1 ? { skipped } : {}),
            generatedAt: new Date().toISOString(),
          },
        });
      }

      await this.finalizeCompileRun(runId, user, siteVisit.id, createInputs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Report compile run ${runId} failed: ${message}`);
      await this.prisma.siteVisitReportRun
        .update({
          where: { id: runId },
          data: {
            status: RUN_FAILED,
            error: message.slice(0, 800),
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
      // The volume PDFs written so far belong to no DB row — remove them.
      await Promise.all(
        writtenFiles.map((file) => unlink(file).catch(() => undefined)),
      );
    }
  }

  /**
   * The atomic tail of a successful run: re-guard the lifecycle state (it may
   * have changed during the minutes-long compile), then commit the volume rows,
   * the LAPORAN SELESAI flip, its lifecycle event, the defect release (under
   * RELEASE_ON_REPORT) and the run's COMPLETED mark in ONE transaction —
   * exactly the invariant the old in-request compile had.
   */
  private async finalizeCompileRun(
    runId: string,
    user: RequestUser,
    siteVisitId: string,
    createInputs: Prisma.SiteVisitReportUncheckedCreateInput[],
  ): Promise<void> {
    const visit = await this.prisma.siteVisit.findUnique({
      where: { id: siteVisitId },
      select: { status: true, lifecycleStatus: true },
    });
    if (
      !visit ||
      visit.status === SiteVisitStatus.CANCELLED ||
      !COMPILABLE_LIFECYCLE_STATES.includes(
        visit.lifecycleStatus as SurveyLifecycleStatus,
      )
    ) {
      throw new Error(
        'The survey changed state while the report was compiling — nothing ' +
          'was frozen. Generate again from its current state.',
      );
    }

    // A run started FROM LAPORAN SELESAI is a REGENERATE: the survey stays
    // where it is (the original laporanSelesaiAt is the completion record),
    // the new volumes commit as the next version, and the audit trail carries
    // a self-transition event naming the re-issued version.
    const isRegenerate =
      visit.lifecycleStatus === SurveyLifecycleStatus.LAPORAN_SELESAI;
    const version = createInputs[0]?.version;

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.siteVisit.update({
        where: { id: siteVisitId },
        data: {
          lifecycleStatus: SurveyLifecycleStatus.LAPORAN_SELESAI,
          ...(isRegenerate ? {} : { laporanSelesaiAt: new Date() }),
        },
      }),
      this.prisma.siteVisitLifecycleEvent.create({
        data: {
          siteVisitId,
          fromStatus: visit.lifecycleStatus,
          toStatus: SurveyLifecycleStatus.LAPORAN_SELESAI,
          remark: isRegenerate
            ? `Laporan dijana semula (v${version}) dengan templat semasa.`
            : null,
          createdByUserId: user.id,
        },
      }),
      ...createInputs.map((data) =>
        this.prisma.siteVisitReport.create({ data }),
      ),
      this.prisma.siteVisitReportRun.update({
        where: { id: runId },
        data: { status: RUN_COMPLETED, finishedAt: new Date() },
      }),
    ];

    // The RELEASE_ON_REPORT defect handoff fires only on the FIRST freeze —
    // a regenerate re-issues the document, not the maintenance handoff.
    if (!isRegenerate && releaseDefectsOnReport()) {
      const releasePlan = await buildVisitReleasePlan(this.prisma, siteVisitId, {
        scope: 'ALL',
        actorUserId: user.id,
        now: new Date(),
      });
      ops.push(...releasePlan.ops);
    }

    await this.prisma.$transaction(ops);
    this.logger.log(
      `Report compile run ${runId} completed: ${createInputs.length} volume(s) ` +
        `frozen for visit ${siteVisitId}.`,
    );
  }

  /** Progress + volumes for the admin page's polling: the latest run and the
   *  latest version's volume list. */
  async getCompileStatus(
    user: RequestUser,
    siteVisitId: string,
  ): Promise<{
    run: {
      id: string;
      status: string;
      totalAssets: number;
      processedAssets: number;
      error: string | null;
      startedAt: string;
      finishedAt: string | null;
    } | null;
    volumes: Array<{
      version: number;
      part: number;
      partCount: number;
      fileName: string;
      assetCount: number | null;
      range: string | null;
    }>;
  }> {
    await this.assertCanReport(user);

    const visit = await this.prisma.siteVisit.findFirst({
      where: { id: siteVisitId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!visit) {
      throw new NotFoundException('Site visit not found.');
    }

    const run = await this.prisma.siteVisitReportRun.findFirst({
      where: { siteVisitId },
      orderBy: { startedAt: 'desc' },
    });

    const latest = await this.prisma.siteVisitReport.findFirst({
      where: { siteVisitId },
      orderBy: [{ version: 'desc' }, { part: 'asc' }],
      select: { version: true },
    });
    const volumes = latest
      ? await this.prisma.siteVisitReport.findMany({
          where: { siteVisitId, version: latest.version },
          orderBy: { part: 'asc' },
          select: {
            version: true,
            part: true,
            partCount: true,
            fileName: true,
            metadata: true,
          },
        })
      : [];

    return {
      run: run
        ? {
            id: run.id,
            status: run.status,
            totalAssets: run.totalAssets,
            processedAssets: run.processedAssets,
            error: run.error,
            startedAt: run.startedAt.toISOString(),
            finishedAt: run.finishedAt?.toISOString() ?? null,
          }
        : null,
      volumes: volumes.map((volume) => {
        const metadata = (volume.metadata ?? {}) as Record<string, unknown>;
        return {
          version: volume.version,
          part: volume.part,
          partCount: volume.partCount,
          fileName: volume.fileName,
          assetCount:
            typeof metadata.assetCount === 'number' ? metadata.assetCount : null,
          range: typeof metadata.range === 'string' ? metadata.range : null,
        };
      }),
    };
  }

  /** Fetch a frozen compiled report volume (latest version; `part` selects the
   *  Jilid, defaulting to the first). */
  async getCompiledReport(
    user: RequestUser,
    siteVisitId: string,
    part?: number,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertCanReport(user);

    const latest = await this.prisma.siteVisitReport.findFirst({
      where: { siteVisitId, tenantId: user.tenantId },
      orderBy: [{ version: 'desc' }, { part: 'asc' }],
    });
    if (!latest) {
      throw new NotFoundException(
        'No compiled report exists for this survey yet. It is produced when ' +
          'the survey reaches LAPORAN SELESAI.',
      );
    }

    const wantedPart = part ?? latest.part;
    const report =
      wantedPart === latest.part
        ? latest
        : await this.prisma.siteVisitReport.findFirst({
            where: {
              siteVisitId,
              tenantId: user.tenantId,
              version: latest.version,
              part: wantedPart,
            },
          });
    if (!report) {
      throw new NotFoundException(
        `This report has ${latest.partCount} volume(s); Jilid ${wantedPart} ` +
          'does not exist.',
      );
    }

    // Serve under the OWNER-FACING name (live Pencawang name), whatever the
    // stored on-disk name is — old versions get the friendly name too.
    const visit = await this.prisma.siteVisit.findUnique({
      where: { id: siteVisitId },
      select: {
        pencawangName: true,
        pencawangCode: true,
        substation: { select: { name: true } },
      },
    });
    const label =
      visit?.substation?.name ?? visit?.pencawangName ?? visit?.pencawangCode;

    const buffer = await readFile(resolveUploadPath(report.storageKey));
    return {
      buffer,
      filename: label
        ? this.reportDisplayFilename(label, report.part, report.partCount)
        : report.fileName,
    };
  }

  /**
   * The filename a human receives: `LAPORAN VISUAL <PENCAWANG>.pdf`, plus a
   * JILID suffix when the survey compiled into several volumes. Spaces are
   * kept (it's a document title, not a storage key); characters illegal on
   * Windows/macOS are stripped. Version is intentionally omitted — it lives on
   * the cover page and in the admin UI.
   */
  private reportDisplayFilename(
    label: string,
    part: number,
    partCount: number,
  ): string {
    const cleaned =
      label
        .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'LAPORAN';
    return (
      `LAPORAN VISUAL ${cleaned}` +
      (partCount > 1 ? ` JILID ${part}` : '') +
      '.pdf'
    );
  }

  // ─── Batch generate + batch download ──────────────────────────────────────

  /**
   * Queue a compile for several surveys at once. Each visit is fast-validated
   * with the same rules as {@link startCompileRun}; invalid ones are reported
   * back as `skipped` (with the reason) instead of failing the whole batch.
   * Accepted visits get a QUEUED run row each, then a detached loop compiles
   * them strictly ONE AT A TIME — Gotenberg and the API only ever carry a
   * single compile's load, exactly as if an operator pressed Generate on each
   * visit in turn. Progress is polled per-visit via {@link getBatchStatus}.
   */
  async startBatchCompile(
    user: RequestUser,
    siteVisitIds: string[],
  ): Promise<{
    accepted: Array<{ siteVisitId: string; label: string; totalAssets: number }>;
    skipped: Array<{ siteVisitId: string; label: string; reason: string }>;
  }> {
    await this.assertCanReport(user);

    const ids = [...new Set(siteVisitIds)];
    if (ids.length === 0) {
      throw new BadRequestException('No site visits were selected.');
    }
    if (ids.length > BATCH_COMPILE_MAX) {
      throw new BadRequestException(
        `A batch can generate at most ${BATCH_COMPILE_MAX} reports at a time.`,
      );
    }

    const visits = await this.prisma.siteVisit.findMany({
      where: { id: { in: ids }, tenantId: user.tenantId },
      select: {
        id: true,
        status: true,
        lifecycleStatus: true,
        pencawangName: true,
        pencawangCode: true,
        substation: { select: { name: true } },
        _count: { select: { visitAssets: true } },
      },
    });
    const visitById = new Map(visits.map((visit) => [visit.id, visit]));

    const busyRuns = await this.prisma.siteVisitReportRun.findMany({
      where: {
        siteVisitId: { in: ids },
        status: { in: [RUN_RUNNING, RUN_QUEUED] },
      },
      select: { siteVisitId: true },
    });
    const busy = new Set(busyRuns.map((run) => run.siteVisitId));

    const accepted: Array<{
      siteVisitId: string;
      label: string;
      totalAssets: number;
    }> = [];
    const skipped: Array<{
      siteVisitId: string;
      label: string;
      reason: string;
    }> = [];
    for (const id of ids) {
      const visit = visitById.get(id);
      const label =
        visit?.substation?.name ??
        visit?.pencawangName ??
        visit?.pencawangCode ??
        id;
      if (!visit) {
        skipped.push({ siteVisitId: id, label, reason: 'Visit not found.' });
        continue;
      }
      if (visit.status === SiteVisitStatus.CANCELLED) {
        skipped.push({ siteVisitId: id, label, reason: 'Visit is cancelled.' });
        continue;
      }
      if (
        !COMPILABLE_LIFECYCLE_STATES.includes(
          visit.lifecycleStatus as SurveyLifecycleStatus,
        )
      ) {
        skipped.push({
          siteVisitId: id,
          label,
          reason: 'Not in a report-ready state (needs RONDAAN SELESAI).',
        });
        continue;
      }
      if (busy.has(id)) {
        skipped.push({
          siteVisitId: id,
          label,
          reason: 'A compile is already queued or running.',
        });
        continue;
      }
      const totalAssets = visit._count.visitAssets;
      if (totalAssets === 0) {
        skipped.push({ siteVisitId: id, label, reason: 'No linked assets.' });
        continue;
      }
      if (totalAssets > MAX_ASSETS_PER_COMPILE) {
        skipped.push({
          siteVisitId: id,
          label,
          reason: `Exceeds the ${MAX_ASSETS_PER_COMPILE}-asset compile cap.`,
        });
        continue;
      }
      accepted.push({ siteVisitId: id, label, totalAssets });
    }

    if (accepted.length > 0) {
      // One health check for the whole batch — fail fast before queueing.
      if (!(await this.gotenberg.isHealthy())) {
        throw new ServiceUnavailableException(
          'The document conversion service (Gotenberg) is unavailable. ' +
            'Ensure the ascure-gotenberg container is running, then retry.',
        );
      }

      const runIds: string[] = [];
      for (const entry of accepted) {
        const run = await this.prisma.siteVisitReportRun.create({
          data: {
            tenantId: user.tenantId,
            siteVisitId: entry.siteVisitId,
            status: RUN_QUEUED,
            totalAssets: entry.totalAssets,
            startedByUserId: user.id,
          },
          select: { id: true },
        });
        runIds.push(run.id);
      }

      // Detached on purpose (same contract as the single-visit path): the
      // request returns now; the run rows are the progress/result channel.
      void this.executeBatchRuns(runIds, user);
    }

    return { accepted, skipped };
  }

  /** The background body of a batch: compile each queued run in order, one at
   *  a time. executeCompileRun handles its own failure-marking; a crash there
   *  must never take down the rest of the queue. */
  private async executeBatchRuns(
    runIds: string[],
    user: RequestUser,
  ): Promise<void> {
    for (const runId of runIds) {
      try {
        await this.executeCompileRun(runId, user);
      } catch (error) {
        this.logger.error(
          `Batch compile run ${runId} crashed outside its own handler: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** One poll for a whole selection: each visit's latest run (queued/running/
   *  completed/failed + progress) and its latest compiled version, if any. */
  async getBatchStatus(
    user: RequestUser,
    siteVisitIds: string[],
  ): Promise<
    Array<{
      siteVisitId: string;
      run: {
        status: string;
        totalAssets: number;
        processedAssets: number;
        error: string | null;
        startedAt: Date;
        finishedAt: Date | null;
      } | null;
      report: { version: number; partCount: number; generatedAt: Date } | null;
    }>
  > {
    await this.assertCanReport(user);

    const ids = [...new Set(siteVisitIds)].slice(0, 50);
    const visits = await this.prisma.siteVisit.findMany({
      where: { id: { in: ids }, tenantId: user.tenantId },
      select: { id: true },
    });
    const validIds = visits.map((visit) => visit.id);

    const [runs, reports] = await Promise.all([
      this.prisma.siteVisitReportRun.findMany({
        where: { siteVisitId: { in: validIds } },
        orderBy: { startedAt: 'desc' },
        select: {
          siteVisitId: true,
          status: true,
          totalAssets: true,
          processedAssets: true,
          error: true,
          startedAt: true,
          finishedAt: true,
        },
      }),
      this.prisma.siteVisitReport.findMany({
        where: { siteVisitId: { in: validIds }, status: 'COMPLETED' },
        orderBy: [{ version: 'desc' }, { part: 'asc' }],
        select: {
          siteVisitId: true,
          version: true,
          partCount: true,
          createdAt: true,
        },
      }),
    ]);

    // Rows are newest-first; the first seen per visit is its latest.
    const latestRun = new Map<string, (typeof runs)[number]>();
    for (const run of runs) {
      if (!latestRun.has(run.siteVisitId)) {
        latestRun.set(run.siteVisitId, run);
      }
    }
    const latestReport = new Map<string, (typeof reports)[number]>();
    for (const report of reports) {
      if (!latestReport.has(report.siteVisitId)) {
        latestReport.set(report.siteVisitId, report);
      }
    }

    return validIds.map((siteVisitId) => {
      const run = latestRun.get(siteVisitId) ?? null;
      const report = latestReport.get(siteVisitId) ?? null;
      return {
        siteVisitId,
        run: run
          ? {
              status: run.status,
              totalAssets: run.totalAssets,
              processedAssets: run.processedAssets,
              error: run.error,
              startedAt: run.startedAt,
              finishedAt: run.finishedAt,
            }
          : null,
        report: report
          ? {
              version: report.version,
              partCount: report.partCount,
              generatedAt: report.createdAt,
            }
          : null,
      };
    });
  }

  /**
   * Stream the LATEST compiled report of each selected visit into one ZIP.
   * PDFs are read straight off disk (never buffered whole into memory) and
   * stored uncompressed — PDF content doesn't deflate meaningfully and store
   * keeps the stream fast. Visits without a compiled report (or whose file is
   * missing on disk) are listed in SENARAI.txt instead of silently dropped.
   */
  async createBatchZip(
    user: RequestUser,
    siteVisitIds: string[],
  ): Promise<{ archive: archiver.Archiver; fileName: string }> {
    await this.assertCanReport(user);

    const ids = [...new Set(siteVisitIds)];
    if (ids.length === 0) {
      throw new BadRequestException('No site visits were selected.');
    }
    if (ids.length > BATCH_COMPILE_MAX) {
      throw new BadRequestException(
        `A batch can download at most ${BATCH_COMPILE_MAX} reports at a time.`,
      );
    }

    const visits = await this.prisma.siteVisit.findMany({
      where: { id: { in: ids }, tenantId: user.tenantId },
      select: {
        id: true,
        pencawangName: true,
        pencawangCode: true,
        substation: { select: { name: true } },
      },
    });
    if (visits.length === 0) {
      throw new NotFoundException('None of the selected site visits exist.');
    }

    const reports = await this.prisma.siteVisitReport.findMany({
      where: {
        siteVisitId: { in: visits.map((visit) => visit.id) },
        status: 'COMPLETED',
      },
      orderBy: [{ version: 'desc' }, { part: 'asc' }],
      select: {
        siteVisitId: true,
        version: true,
        part: true,
        partCount: true,
        storageKey: true,
      },
    });
    // Keep only each visit's latest version (rows are version-desc, part-asc).
    const latestVersion = new Map<string, number>();
    for (const report of reports) {
      if (!latestVersion.has(report.siteVisitId)) {
        latestVersion.set(report.siteVisitId, report.version);
      }
    }

    const archive = archiver('zip', { store: true });
    const manifest: string[] = [];
    const usedNames = new Set<string>();
    let included = 0;

    for (const visit of visits) {
      const label =
        visit.substation?.name ??
        visit.pencawangName ??
        visit.pencawangCode ??
        visit.id;
      const version = latestVersion.get(visit.id);
      if (version === undefined) {
        manifest.push(`TIADA LAPORAN — ${label} (belum dijana)`);
        continue;
      }
      const parts = reports.filter(
        (report) =>
          report.siteVisitId === visit.id && report.version === version,
      );
      for (const part of parts) {
        const diskPath = resolveUploadPath(part.storageKey);
        // A missing file must not abort the whole stream mid-response.
        if (!existsSync(diskPath)) {
          manifest.push(
            `FAIL HILANG — ${label} v${version}` +
              (part.partCount > 1 ? ` jilid ${part.part}` : ''),
          );
          continue;
        }
        let entryName = this.reportDisplayFilename(
          label,
          part.part,
          part.partCount,
        );
        // Two visits can share a Pencawang name — keep entries unique.
        if (usedNames.has(entryName)) {
          entryName = entryName.replace(
            /\.pdf$/,
            ` (${visit.id.slice(0, 8)}).pdf`,
          );
        }
        usedNames.add(entryName);
        archive.file(diskPath, { name: entryName });
        manifest.push(
          `${entryName} — ${label} v${version}` +
            (part.partCount > 1 ? ` (jilid ${part.part}/${part.partCount})` : ''),
        );
        included += 1;
      }
    }

    if (included === 0) {
      throw new NotFoundException(
        'None of the selected surveys have a compiled report yet.',
      );
    }

    archive.append(
      `Laporan ASCURE — ${new Date().toISOString()}\n\n` +
        manifest.join('\n') +
        '\n',
      { name: 'SENARAI.txt' },
    );

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return { archive, fileName: `ascure-laporan-${stamp}.zip` };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async renderAssetPdf(
    inspection: AssetReportInspection,
    templateBuffer: Buffer,
  ): Promise<Buffer> {
    const data = await this.buildAssetReportData(inspection);
    const handler = new TemplateHandler();
    // AssetReportData is intentionally a fixed shape; easy-template-x's
    // TemplateData is an open index signature it structurally satisfies.
    const docx = await handler.process(
      templateBuffer,
      data as unknown as TemplateData,
    );
    return this.gotenberg.convertDocxToPdf(
      docx,
      `${this.sanitizeForFilename(inspection.asset.assetCode)}.docx`,
    );
  }

  private async buildAssetReportData(
    inspection: AssetReportInspection,
  ): Promise<AssetReportData> {
    const asset = inspection.asset;
    const visit = inspection.siteVisit;
    const scope = this.resolveScope(inspection);

    const readings = [...inspection.results]
      .sort(
        (a, b) =>
          (a.templateItem?.sortOrder ?? 0) - (b.templateItem?.sortOrder ?? 0),
      )
      .map((result) => ({
        key: result.templateItem?.key ?? '',
        label: result.templateItem?.label ?? '',
        type: result.templateItem?.inputType ?? '',
        value: this.readingValue(result),
      }));

    // The LIVE recorded value per checklist item (InspectionResult) — the
    // itemResult remark/verdict is a copy frozen at submit that office edits
    // never update. Same rules as the screens (overlayItemResult in
    // assets.service): a live value overlays the remark; a CLEARED value (row
    // exists, every column blank) withdraws the whole verdict; no row keeps
    // the frozen copy — it is the only record there is.
    const liveRowById = new Map<string, AssetReportInspection['results'][number]>();
    const liveIdsByLabel = new Map<string, string[]>();
    for (const result of inspection.results) {
      liveRowById.set(result.templateItemId, result);
      const label = result.templateItem?.label;
      if (label) {
        const key = normalizeChecklistLabel(label);
        const ids = liveIdsByLabel.get(key) ?? [];
        ids.push(result.templateItemId);
        liveIdsByLabel.set(key, ids);
      }
    }
    const liveRowFor = (item: { checklistItemId: string | null; label: string }) => {
      if (item.checklistItemId && liveRowById.has(item.checklistItemId)) {
        return liveRowById.get(item.checklistItemId);
      }
      for (const id of liveIdsByLabel.get(normalizeChecklistLabel(item.label)) ?? []) {
        const row = liveRowById.get(id);
        if (row && this.readingValue(row).trim() !== '') {
          return row;
        }
      }
      return undefined;
    };
    const withdrawnItemIds = new Set<string>();

    const checks = inspection.itemResults.map((item) => {
      const liveRow = liveRowFor(item);
      if (liveRow) {
        const liveValue = this.readingValue(liveRow).trim();
        if (liveValue === '') {
          // Cleared by the office — the verdict follows the value.
          withdrawnItemIds.add(item.id);
          return { label: item.label, result: '', remark: '', severity: '' };
        }
        return {
          label: item.label,
          result: item.result,
          remark: liveValue,
          severity: item.severity ?? '',
        };
      }
      return {
        label: item.label,
        result: item.result,
        remark: item.remark ?? '',
        severity: item.severity ?? '',
      };
    });

    const defects = inspection.itemResults
      .filter((item) => item.isDefect && !withdrawnItemIds.has(item.id))
      .map((item) => ({
        label: item.label,
        severity: item.severity ?? item.defect?.severity ?? '',
        status: item.defect?.status ?? '',
        lifecycle: item.defect?.lifecycleStatus ?? '',
        dueDate: this.fmtDate(item.defect?.dueDate),
        remark: item.remark ?? item.defect?.actionRemark ?? '',
      }));

    const itemImageMap = await this.buildItemImageMap(inspection.inspectionImages);
    const { photos, photoItems, otherPhotos, namedImages, itemImageLoops } =
      await this.collectPhotos(inspection, itemImageMap);

    // SAVT route identity — a route visit's From Pencawang doubles as its
    // check-in Pencawang, so the From label falls back to the visit snapshot.
    const fromPencawangLabel =
      visit?.fromPencawang?.name ??
      visit?.fromPencawang?.code ??
      (visit?.routeCode ? (visit?.pencawangName ?? visit?.pencawangCode ?? '') : '');
    const toPencawangLabel =
      visit?.toPencawang?.name ?? visit?.toPencawang?.code ?? '';

    const data: AssetReportData = {
      assetCode: asset.assetCode,
      assetName: asset.name ?? '',
      assetType: asset.assetType?.name ?? '',
      operationalScope: scope ?? '',
      status: asset.status,
      latitude: asset.latitude != null ? String(asset.latitude) : '',
      longitude: asset.longitude != null ? String(asset.longitude) : '',
      gps:
        asset.latitude != null && asset.longitude != null
          ? `${asset.latitude}, ${asset.longitude}`
          : '',
      // NO TIANG LAMA: the SAVR mobile workflow captures the painted label as
      // the asset NAME (Asset Code = NO TIANG RONDAAN); only the F2 import
      // populates asset.noTiangLama. Prefer the dedicated field, fall back to
      // the name so field-created poles aren't blank — same rule as the Excel
      // masterlist export (reports.service.ts).
      noTiangLama: asset.noTiangLama ?? asset.name ?? '',
      // Live entity names first (what every screen shows since Deploy 127);
      // the visit's frozen snapshot is only a fallback.
      pencawang:
        asset.substation?.name ??
        visit?.pencawangName ??
        visit?.pencawangCode ??
        '',
      pencawangCode: asset.substation?.code ?? visit?.pencawangCode ?? '',
      pencawangName: asset.substation?.name ?? visit?.pencawangName ?? '',
      functionalLocation: visit?.functionalLocation ?? '',
      mainhead: visit?.mainheadRecord?.name ?? visit?.mainhead ?? '',
      routeCode: visit?.routeCode ?? '',
      fromPencawang: fromPencawangLabel,
      toPencawang: toPencawangLabel,
      route:
        fromPencawangLabel && toPencawangLabel
          ? `${fromPencawangLabel} → ${toPencawangLabel}`
          : fromPencawangLabel || toPencawangLabel,
      inspector: inspection.createdBy?.name ?? '',
      inspectorEmail: inspection.createdBy?.email ?? '',
      inspectionDate: this.fmtDateTime(inspection.createdAt),
      submittedDate: this.fmtDateTime(inspection.submittedAt),
      visitType: visit?.visitType ?? '',
      cycle: String(inspection.inspectionCycle ?? 1),
      generatedAt: this.fmtDateTime(new Date()),
      readingCount: String(readings.length),
      checkCount: String(checks.length),
      defectCount: String(defects.length),
      photoCount: String(photos.length),
      hasReadings: readings.length > 0,
      hasChecks: checks.length > 0,
      hasDefects: defects.length > 0,
      hasPhotos: photos.length > 0,
      readings,
      checks,
      defects,
      photos,
      photoItems,
      otherPhotos,
      hasPhotoItems: photoItems.length > 0,
      hasOtherPhotos: otherPhotos.length > 0,
    };

    // Per-item IMAGE-field photos are also exposed as flat {img_<KEY>} tags so a
    // template can place a specific photo (e.g. {img_GAMBAR_PENUH_TIANG}) exactly
    // where it wants; {#otherPhotos} then carries everything NOT placed this way,
    // so there is no duplication.
    const dynamic = data as unknown as Record<string, unknown>;
    for (const [tag, image] of Object.entries(namedImages)) {
      dynamic[tag] = image;
    }
    // Per-item photo loops ({#imgs_<KEY>} … {/imgs_<KEY>}) — every photo of
    // one checklist item, for fields that can carry more than one capture.
    for (const [loopKey, entries] of Object.entries(itemImageLoops)) {
      dynamic[loopKey] = entries;
    }

    return data;
  }

  private async buildItemImageMap(
    images: ReadonlyArray<{ templateItemId: string | null }>,
  ): Promise<Map<string, { key: string; label: string }>> {
    const ids = [
      ...new Set(
        images
          .map((image) => image.templateItemId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    if (ids.length === 0) {
      return new Map();
    }

    const items = await this.prisma.inspectionTemplateItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, key: true, label: true },
    });

    return new Map(
      items.map((item) => [item.id, { key: item.key, label: item.label }]),
    );
  }

  /**
   * Flat, tag-safe placeholder name for a checklist item's photo, e.g. key
   * "GAMBAR PENUH TIANG" -> "img_GAMBAR_PENUH_TIANG" -> {img_GAMBAR_PENUH_TIANG}.
   */
  private imageTagForKey(key: string): string {
    const safe = key
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `img_${safe || 'ITEM'}`;
  }

  private async collectPhotos(
    inspection: AssetReportInspection,
    itemImageMap: Map<string, { key: string; label: string }>,
  ): Promise<{
    photos: AssetReportData['photos'];
    photoItems: AssetReportData['photoItems'];
    otherPhotos: AssetReportData['otherPhotos'];
    namedImages: Record<string, ImageContent>;
    itemImageLoops: Record<
      string,
      Array<{ image: ImageContent; caption: string; index: string }>
    >;
  }> {
    const photos: AssetReportData['photos'] = [];
    const photoItems: AssetReportData['photoItems'] = [];
    const otherPhotos: AssetReportData['otherPhotos'] = [];
    const namedImages: Record<string, ImageContent> = {};
    // How many photos each IMAGE item has produced so far — numbers the flat
    // tags: 1st photo = {img_<KEY>}, 2nd = {img_<KEY>_2}, 3rd = {img_<KEY>_3}…
    const namedImageCounts = new Map<string, number>();
    // Per-item photo loops: {#imgs_<KEY>}{image} {caption}{/imgs_<KEY>} walks
    // EVERY photo of that one checklist item, however many there are.
    const itemImageLoops: Record<
      string,
      Array<{ image: ImageContent; caption: string; index: string }>
    > = {};

    for (const image of inspection.inspectionImages) {
      const loaded = await loadReportImage(image);
      if (!loaded) {
        continue;
      }

      const item = image.templateItemId
        ? itemImageMap.get(image.templateItemId)
        : undefined;
      const caption = item?.label ?? image.filename ?? '';

      // Every image still appears in the all-inclusive {#photos} loop.
      photos.push({ image: loaded, caption, source: 'Inspection' });

      if (item) {
        const tag = this.imageTagForKey(item.key);
        photoItems.push({ key: item.key, label: item.label, tag, image: loaded });
        const count = (namedImageCounts.get(tag) ?? 0) + 1;
        namedImageCounts.set(tag, count);
        // First photo keeps the unsuffixed {img_<KEY>} tag (backward
        // compatible); later photos of the SAME item get {img_<KEY>_2}, _3, …
        namedImages[count === 1 ? tag : `${tag}_${count}`] = loaded;
        const loopKey = `imgs_${tag.slice('img_'.length)}`;
        (itemImageLoops[loopKey] ??= []).push({
          image: loaded,
          caption: item.label,
          index: String(count),
        });
      } else {
        // Ad-hoc / global captures (no checklist item) feed {#otherPhotos}.
        otherPhotos.push({ image: loaded, caption, source: 'Inspection' });
      }
    }

    for (const item of inspection.itemResults) {
      for (const evidence of item.defect?.evidenceImages ?? []) {
        const loaded = await loadReportImage(evidence);
        if (loaded) {
          const photo = {
            image: loaded,
            caption: evidence.note ?? item.label,
            source: evidence.evidenceType ?? 'Defect evidence',
          };
          // Defect evidence is "other" (not a per-item IMAGE field).
          photos.push(photo);
          otherPhotos.push(photo);
        }
      }
    }

    return { photos, photoItems, otherPhotos, namedImages, itemImageLoops };
  }

  private async findLatestSubmittedInspection(
    tenantId: string,
    assetId: string,
  ): Promise<AssetReportInspection | null> {
    return this.prisma.inspection.findFirst({
      where: {
        tenantId,
        assetId,
        completionStatus: InspectionCompletionStatus.SUBMITTED,
      },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      include: assetReportInclude,
    });
  }

  private async loadActiveTemplate(
    tenantId: string,
    scope: OperationalScope,
  ): Promise<{ template: ReportTemplate; buffer: Buffer } | null> {
    const template = await this.prisma.reportTemplate.findFirst({
      where: { tenantId, operationalScope: scope, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!template) {
      return null;
    }
    // The DB row can outlive its file (manual deletion, restore mismatch).
    // Treat a missing/unreadable template file as "no active template" rather
    // than crashing report generation with an unhandled rejection.
    try {
      const buffer = await readFile(resolveUploadPath(template.storageKey));
      return { template, buffer };
    } catch (error) {
      this.logger.error(
        `Active template ${template.id} (${scope}) file is unreadable at ` +
          `${template.storageKey}: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      return null;
    }
  }

  private resolveScope(inspection: {
    operationalScope: OperationalScope | null;
    asset: {
      assetType: {
        code: string | null;
        operationalScope: OperationalScope | null;
      } | null;
    };
  }): OperationalScope | null {
    return (
      inspection.operationalScope ??
      inspection.asset.assetType?.operationalScope ??
      inferOperationalScopeFromAssetTypeCode(inspection.asset.assetType?.code) ??
      null
    );
  }

  private async nextReportVersion(siteVisitId: string): Promise<number> {
    const max = await this.prisma.siteVisitReport.aggregate({
      where: { siteVisitId },
      _max: { version: true },
    });
    return (max._max.version ?? 0) + 1;
  }

  private async drawCoverPage(
    doc: PDFDocument,
    siteVisit: {
      pencawangCode: string | null;
      pencawangName: string | null;
      visitType: string | null;
      startedAt: Date | null;
      completedAt: Date | null;
      // The live Pencawang entity — its name leads, the visit snapshot is the
      // fallback (same rule as every screen and export).
      substation?: { name: string | null; code: string | null } | null;
      // SAVT route identity — when routeCode is set, the cover leads with the
      // route (From → To) instead of a single Pencawang.
      routeCode?: string | null;
      fromPencawang?: { name: string | null; code: string | null } | null;
      toPencawang?: { name: string | null; code: string | null } | null;
    },
    info: {
      version: number;
      part: number;
      partCount: number;
      assetCount: number;
      totalAssets: number;
      range: string;
    },
  ): Promise<void> {
    const page = doc.addPage(A4_PORTRAIT);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const left = 56;
    let y = 770;

    page.drawText('LAPORAN PEMERIKSAAN VISUAL', {
      x: left,
      y,
      size: 22,
      font: bold,
      color: rgb(0.086, 0.102, 0.122), // ASCURE ink #161A1F
    });
    y -= 14;
    page.drawLine({
      start: { x: left, y },
      end: { x: A4_PORTRAIT[0] - left, y },
      thickness: 1,
      color: rgb(0.773, 0.8, 0.831), // mist line #C5CCD4
    });
    y -= 40;

    // A SAVT survey is a ROUTE (From → To), not a single Pencawang — its cover
    // leads with the route identity; SAVR keeps the Pencawang rows unchanged.
    const isRoute = Boolean(siteVisit.routeCode?.trim());
    const fromLabel =
      siteVisit.fromPencawang?.name ??
      siteVisit.fromPencawang?.code ??
      siteVisit.substation?.name ??
      siteVisit.pencawangName ??
      '—';
    const toLabel =
      siteVisit.toPencawang?.name ?? siteVisit.toPencawang?.code ?? '—';
    const identityRows: Array<[string, string]> = isRoute
      ? [
          ['Laluan', `${fromLabel} → ${toLabel}`],
          ['Kod Laluan (KOD TIANG)', siteVisit.routeCode?.trim() ?? '—'],
        ]
      : [
          [
            'Pencawang',
            siteVisit.substation?.name ??
              siteVisit.pencawangName ??
              siteVisit.pencawangCode ??
              '—',
          ],
          [
            'Kod Pencawang',
            siteVisit.substation?.code ?? siteVisit.pencawangCode ?? '—',
          ],
        ];
    const rows: Array<[string, string]> = [
      ...identityRows,
      ['Jenis Lawatan', siteVisit.visitType ?? '—'],
      ['Tarikh Mula', this.fmtDate(siteVisit.startedAt) || '—'],
      ['Tarikh Siap', this.fmtDate(siteVisit.completedAt) || '—'],
      ...(info.partCount > 1
        ? ([
            ['Jilid', `${info.part} / ${info.partCount}`],
            ['Julat Tiang', info.range],
            ['Bilangan Aset (jilid ini)', String(info.assetCount)],
            ['Jumlah Aset', String(info.totalAssets)],
          ] as Array<[string, string]>)
        : ([['Bilangan Aset', String(info.assetCount)]] as Array<
            [string, string]
          >)),
      ['Versi Laporan', `v${info.version}`],
      ['Dijana Pada', this.fmtDateTime(new Date())],
    ];

    for (const [label, value] of rows) {
      page.drawText(`${label}:`, { x: left, y, size: 12, font: bold });
      page.drawText(value, { x: left + 150, y, size: 12, font: regular });
      y -= 26;
    }
  }

  private readingValue(result: {
    valueText: string | null;
    valueNumber: Prisma.Decimal | null;
    valueBoolean: boolean | null;
    valueDate: Date | null;
    valueDateTime: Date | null;
    valueJson: Prisma.JsonValue | null;
  }): string {
    // MULTI_SELECT picks live ONLY in valueJson (string array); an item that
    // allows "Other (free text)" keeps that answer in valueText alongside the
    // picks — join them the way every screen does ("A, B, other note") instead
    // of dumping raw JSON.
    if (Array.isArray(result.valueJson)) {
      const picks = result.valueJson
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (picks.length > 0) {
        const other = result.valueText?.trim();
        return other ? `${picks.join(', ')}, ${other}` : picks.join(', ');
      }
    }
    if (result.valueText != null) {
      return result.valueText;
    }
    if (result.valueNumber != null) {
      return result.valueNumber.toString();
    }
    if (result.valueBoolean != null) {
      return result.valueBoolean ? 'YA' : 'TIDAK';
    }
    if (result.valueDateTime != null) {
      return this.fmtDateTime(result.valueDateTime);
    }
    if (result.valueDate != null) {
      return this.fmtDate(result.valueDate);
    }
    if (result.valueJson != null) {
      return JSON.stringify(result.valueJson);
    }
    return '';
  }

  private fmtDate(date?: Date | null): string {
    if (!date) {
      return '';
    }
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
    }).format(date);
  }

  private fmtDateTime(date?: Date | null): string {
    if (!date) {
      return '';
    }
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
    }).format(date);
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
    return `${day} ${time}`;
  }

  private sanitizeForFilename(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'asset';
  }

  private async assertCanReport(user: RequestUser): Promise<void> {
    if (await resolveCanReport(this.usersService, user)) {
      return;
    }
    throw new ForbiddenException(
      'This action requires REPORTING authority (ADMIN or a reporting user).',
    );
  }

  private assertAdmin(user: RequestUser): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Managing report templates requires an administrator.',
      );
    }
  }
}

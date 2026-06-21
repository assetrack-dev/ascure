import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
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

/** Upper bound on assets compiled into one report — guards against compiling a
 *  pathologically large survey entirely in memory (each asset PDF is buffered). */
const MAX_ASSETS_PER_REPORT = 300;

@Injectable()
export class ReportGenerationService {
  private readonly logger = new Logger(ReportGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly gotenberg: GotenbergService,
  ) {}

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

  // ─── Compile + freeze (LAPORAN SELESAI) ───────────────────────────────────

  /**
   * Compile every asset's report in a survey into one frozen PDF (cover + each
   * asset's report, merged) and persist it as a versioned SiteVisitReport.
   * Standalone entry point; the survey lifecycle uses
   * {@link prepareSiteVisitReportCreate} instead so the row is written in the
   * same transaction as the status change.
   */
  async compileSiteVisitReport(
    user: RequestUser,
    siteVisitId: string,
  ): Promise<SiteVisitReport> {
    const data = await this.buildSiteVisitReportData(user, siteVisitId);
    return this.prisma.siteVisitReport.create({ data });
  }

  /**
   * Build the frozen report (render + merge + write to disk) and return the
   * Prisma create *input data* (NOT a query). The caller persists it inside the
   * same `$transaction` that flips the survey to LAPORAN SELESAI, so the DB
   * stays consistent: if the status commit fails, no SiteVisitReport row is left
   * behind (only an orphaned PDF on disk, which is harmless). Returning the data
   * — not a PrismaPromise — avoids `await` executing the query early (a
   * PrismaPromise is thenable).
   */
  async buildSiteVisitReportData(
    user: RequestUser,
    siteVisitId: string,
  ): Promise<Prisma.SiteVisitReportUncheckedCreateInput> {
    await this.assertCanReport(user);

    const siteVisit = await this.prisma.siteVisit.findFirst({
      where: { id: siteVisitId, tenantId: user.tenantId },
      select: {
        id: true,
        tenantId: true,
        status: true,
        lifecycleStatus: true,
        pencawangCode: true,
        pencawangName: true,
        visitType: true,
        startedAt: true,
        completedAt: true,
        visitAssets: {
          orderBy: { addedAt: 'asc' },
          select: { assetId: true },
        },
      },
    });
    if (!siteVisit) {
      throw new NotFoundException('Site visit not found.');
    }

    // Re-validate state at compile time (the caller's guard ran earlier; guard
    // again here against a concurrent cancel / lifecycle change).
    if (siteVisit.status === SiteVisitStatus.CANCELLED) {
      throw new BadRequestException(
        'This site visit is cancelled; no report can be compiled.',
      );
    }
    // The DC compiles the report once the team's MANAGER has approved the survey
    // (DISAHKAN PENGURUS) — the gate the lifecycle's generateReport() enforces.
    // This re-check runs at compile time (inside generateReport's beforeCommit,
    // before the status flips to LAPORAN SELESAI), so the committed status here is
    // still DISAHKAN PENGURUS; it must match the lifecycle gate or report
    // generation throws on every call.
    if (siteVisit.lifecycleStatus !== SurveyLifecycleStatus.DISAHKAN_PENGURUS) {
      throw new BadRequestException(
        'A report is only compiled from DISAHKAN PENGURUS (after manager approval).',
      );
    }

    if (siteVisit.visitAssets.length > MAX_ASSETS_PER_REPORT) {
      throw new BadRequestException(
        `This survey has ${siteVisit.visitAssets.length} assets; the compiled ` +
          `report is capped at ${MAX_ASSETS_PER_REPORT}. Split the survey first.`,
      );
    }

    // Fail fast if the converter is down — better than producing a report that
    // silently drops the assets that happened to be rendered after the outage.
    if (!(await this.gotenberg.isHealthy())) {
      throw new ServiceUnavailableException(
        'The document conversion service (Gotenberg) is unavailable. ' +
          'Ensure the ascure-gotenberg container is running, then retry.',
      );
    }

    const assetPdfs: Buffer[] = [];
    const included: string[] = [];
    const skipped: Array<{ assetId: string; reason: string }> = [];

    for (const { assetId } of siteVisit.visitAssets) {
      const inspection = await this.findLatestSubmittedInspection(
        siteVisit.tenantId,
        assetId,
      );
      if (!inspection) {
        skipped.push({ assetId, reason: 'no submitted inspection' });
        continue;
      }

      const scope = this.resolveScope(inspection);
      if (!scope) {
        skipped.push({ assetId, reason: 'no operational scope' });
        continue;
      }

      const template = await this.loadActiveTemplate(siteVisit.tenantId, scope);
      if (!template) {
        skipped.push({ assetId, reason: `no active template for ${scope}` });
        continue;
      }

      // A render/convert failure aborts the whole compile (the frozen report
      // must be complete, never silently missing assets). The survey stays in
      // RONDAAN SELESAI so it can be retried once the cause is fixed.
      assetPdfs.push(await this.renderAssetPdf(inspection, template.buffer));
      included.push(inspection.asset.assetCode);
    }

    if (assetPdfs.length === 0) {
      throw new BadRequestException(
        'No asset reports could be generated. Ensure assets have submitted ' +
          'inspections and an active template exists for their operational scope.',
      );
    }

    const version = await this.nextReportVersion(siteVisitId);
    const merged = await this.mergeReports(siteVisit, assetPdfs, version);

    const directory = buildSiteVisitReportsDirectory(siteVisitId);
    await mkdir(directory, { recursive: true });
    const fileName = `${Date.now()}-laporan-v${version}.pdf`;
    await writeFile(resolve(directory, fileName), merged);

    return {
      tenantId: siteVisit.tenantId,
      siteVisitId,
      version,
      fileName,
      storageKey: buildSiteVisitReportPath(siteVisitId, fileName),
      url: buildSiteVisitReportUrl(siteVisitId, fileName),
      status: 'COMPLETED',
      compiledByUserId: user.id,
      metadata: {
        assetCount: included.length,
        includedAssets: included,
        skipped,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /** Fetch the frozen compiled report (latest version) for download. */
  async getCompiledReport(
    user: RequestUser,
    siteVisitId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertCanReport(user);

    const report = await this.prisma.siteVisitReport.findFirst({
      where: { siteVisitId, tenantId: user.tenantId },
      orderBy: { version: 'desc' },
    });
    if (!report) {
      throw new NotFoundException(
        'No compiled report exists for this survey yet. It is produced when ' +
          'the survey reaches LAPORAN SELESAI.',
      );
    }

    const buffer = await readFile(resolveUploadPath(report.storageKey));
    return { buffer, filename: report.fileName };
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

    const checks = inspection.itemResults.map((item) => ({
      label: item.label,
      result: item.result,
      remark: item.remark ?? '',
      severity: item.severity ?? '',
    }));

    const defects = inspection.itemResults
      .filter((item) => item.isDefect)
      .map((item) => ({
        label: item.label,
        severity: item.severity ?? item.defect?.severity ?? '',
        status: item.defect?.status ?? '',
        lifecycle: item.defect?.lifecycleStatus ?? '',
        dueDate: this.fmtDate(item.defect?.dueDate),
        remark: item.remark ?? item.defect?.actionRemark ?? '',
      }));

    const itemImageMap = await this.buildItemImageMap(inspection.inspectionImages);
    const { photos, photoItems, otherPhotos, namedImages } = await this.collectPhotos(
      inspection,
      itemImageMap,
    );

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
      noTiangLama: asset.noTiangLama ?? '',
      pencawang: visit?.pencawangName ?? visit?.pencawangCode ?? '',
      pencawangCode: visit?.pencawangCode ?? '',
      pencawangName: visit?.pencawangName ?? '',
      functionalLocation: visit?.functionalLocation ?? '',
      mainhead: visit?.mainhead ?? visit?.mainheadRecord?.name ?? '',
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
  }> {
    const photos: AssetReportData['photos'] = [];
    const photoItems: AssetReportData['photoItems'] = [];
    const otherPhotos: AssetReportData['otherPhotos'] = [];
    const namedImages: Record<string, ImageContent> = {};

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
        // First photo for an item wins its named {img_<KEY>} placement tag.
        if (!(tag in namedImages)) {
          namedImages[tag] = loaded;
        }
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

    return { photos, photoItems, otherPhotos, namedImages };
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

  private resolveScope(
    inspection: AssetReportInspection,
  ): OperationalScope | null {
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

  private async mergeReports(
    siteVisit: {
      pencawangCode: string | null;
      pencawangName: string | null;
      visitType: string | null;
      startedAt: Date | null;
      completedAt: Date | null;
    },
    assetPdfs: Buffer[],
    version: number,
  ): Promise<Buffer> {
    const merged = await PDFDocument.create();
    await this.drawCoverPage(merged, siteVisit, assetPdfs.length, version);

    for (const pdfBytes of assetPdfs) {
      const source = await PDFDocument.load(pdfBytes);
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    }

    return Buffer.from(await merged.save());
  }

  private async drawCoverPage(
    doc: PDFDocument,
    siteVisit: {
      pencawangCode: string | null;
      pencawangName: string | null;
      visitType: string | null;
      startedAt: Date | null;
      completedAt: Date | null;
    },
    assetCount: number,
    version: number,
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

    const rows: Array<[string, string]> = [
      ['Pencawang', siteVisit.pencawangName ?? siteVisit.pencawangCode ?? '—'],
      ['Kod Pencawang', siteVisit.pencawangCode ?? '—'],
      ['Jenis Lawatan', siteVisit.visitType ?? '—'],
      ['Tarikh Mula', this.fmtDate(siteVisit.startedAt) || '—'],
      ['Tarikh Siap', this.fmtDate(siteVisit.completedAt) || '—'],
      ['Bilangan Aset', String(assetCount)],
      ['Versi Laporan', `v${version}`],
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

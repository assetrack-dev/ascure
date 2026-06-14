import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DefectStatus,
  OperationalScope,
  Prisma,
  SurveyLifecycleStatus,
} from '@prisma/client';
import { Workbook, Worksheet } from 'exceljs';
import { resolveCanReport } from '../common/authorization/reporting-actor';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { inferOperationalScopeFromAssetTypeCode } from '../common/operational-scope';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  buildMasterlistFilename,
  buildMasterlistWorkbook,
  type MasterlistRawValue,
  type MasterlistRow,
} from './savr-masterlist';

const UPLOADS_URL_PREFIX = '/uploads';

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

  /** Pencawang (substation) options for the report selector — tenant scoped. */
  async listSubstations(user: RequestUser) {
    await this.assertCanReport(user);

    return this.prisma.substation.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      orderBy: [{ name: 'asc' }],
      select: { id: true, code: true, name: true, location: true },
    });
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

    const rows: MasterlistRow[] = chosen
      .map((insp): MasterlistRow => {
        const defectKeys = new Set<string>();
        for (const ir of insp.itemResults) {
          if (!ir.isDefect) {
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
          mainhead: insp.siteVisit?.mainhead ?? '',
          team: insp.siteVisit?.team?.name ?? insp.siteVisit?.team?.code ?? '',
          functionalLocation: insp.siteVisit?.functionalLocation ?? '',
          location: lat != null && lng != null ? `${lat}, ${lng}` : '',
          pencawangName: insp.siteVisit?.pencawangName ?? substation.name,
          pencawangCode: insp.siteVisit?.pencawangCode ?? substation.code,
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

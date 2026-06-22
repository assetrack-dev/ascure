import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DefectStatus,
  InspectionItemInputType,
  InspectionItemResultValue,
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
   * Per-Pencawang masterlist whose columns come from the ACTUAL checklist
   * template items the inspections used (one column per item, 1 pole = 1 row,
   * in the template's own order). Unlike buildPencawangMasterlist — which emits
   * the fixed SAVR-KLB AppSheet schema so the file round-trips the F2 importer —
   * this export always reflects the live template, so editing the checklist
   * template changes the report. Not asset-type filtered: every asset in the
   * Pencawang is included, with Asset Type + Template meta columns so rows from
   * different templates stay legible.
   */
  async buildPencawangTemplateMasterlist(
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
        id: true,
        assetId: true,
        templateId: true,
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
            assetType: { select: { code: true, name: true } },
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
          },
        },
      },
    });

    // One row per asset = its latest inspection (the list is newest-first).
    const latestByAsset = new Map<string, (typeof inspections)[number]>();
    for (const insp of inspections) {
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

    const columnsByKey = new Map<
      string,
      {
        label: string;
        sortOrder: number;
        inputType: InspectionItemInputType;
        itemIds: Set<string>;
      }
    >();
    for (const item of templateItems) {
      // IMAGE (photo) fields are evidence, not tabular data — exclude them.
      if (item.inputType === InspectionItemInputType.IMAGE) {
        continue;
      }
      const existing = columnsByKey.get(item.key);
      if (existing) {
        existing.itemIds.add(item.id);
      } else {
        columnsByKey.set(item.key, {
          label: item.label,
          sortOrder: item.sortOrder,
          inputType: item.inputType,
          itemIds: new Set([item.id]),
        });
      }
    }
    const columns = [...columnsByKey.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
    );

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

    if (!isKuantanMainhead) {
      const fixedWorkbook = new Workbook();
      fixedWorkbook.creator = 'ASCURE';
      fixedWorkbook.created = new Date();
      const fixedSheet = fixedWorkbook.addWorksheet('CHECKLIST');
      fixedSheet.addRow([...SAVR_FIXED_META_HEADERS, ...SAVR_FIXED_ITEM_LABELS]);
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
            insp.siteVisit?.team?.name ?? insp.siteVisit?.team?.code ?? '',
          ),
          formatDate(insp.submittedAt ?? insp.createdAt),
          insp.asset.latitude != null && insp.asset.longitude != null
            ? `${Number(insp.asset.latitude)}, ${Number(insp.asset.longitude)}`
            : '',
          sanitizeText(insp.siteVisit?.pencawangCode ?? substation.code),
          sanitizeText(insp.siteVisit?.pencawangName ?? substation.name),
          sanitizeText(insp.asset.assetCode),
          sanitizeText(insp.asset.noTiangLama || insp.asset.name || ''),
        ];

        const itemCells = SAVR_FIXED_ITEM_LABELS.map((label) => {
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

    const workbook = new Workbook();
    workbook.creator = 'ASCURE';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('CHECKLIST');
    sheet.addRow([...META_HEADERS, ...columns.map((c) => c.label)]);
    sheet.getRow(1).font = { bold: true };

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
        sanitizeText(insp.siteVisit?.pencawangCode ?? substation.code),
        sanitizeText(insp.siteVisit?.pencawangName ?? substation.name),
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

      const itemCells = columns.map((col) => {
        // A column may map to several item ids (same key across template
        // versions); use the first id that carries each kind of value.
        let result: (typeof insp.results)[number] | undefined;
        let verdict: InspectionItemResultValue | undefined;
        for (const id of col.itemIds) {
          if (!result) {
            result = resultByItemId.get(id);
          }
          if (!verdict) {
            verdict = verdictByItemId.get(id);
          }
        }
        return resolveTemplateCell(col.inputType, result, verdict);
      });

      sheet.addRow([...meta, ...itemCells]);
    }

    sheet.columns.forEach((column, index) => {
      column.width = index < META_HEADERS.length ? 18 : 16;
    });

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer as ArrayBuffer);
    const safe =
      (substation.name || substation.code || 'PENCAWANG')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'PENCAWANG';
    return { buffer, filename: `${safe}_CHECKLIST.xlsx` };
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
};

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
      // TEXT, SELECT (dropdown), DATE, DATETIME, GPS, JSON → recorded value.
      if (result?.valueText != null && result.valueText !== '') {
        return sanitizeText(result.valueText);
      }
      if (result?.valueNumber != null) {
        return String(result.valueNumber.toNumber());
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
 * applied to every SAVR mainhead EXCEPT "KUANTAN" (which keeps the dynamic,
 * template-driven layout). Item columns are matched to the live template items
 * by normalized label, so these item headers must match the checklist item
 * labels verbatim (whitespace-insensitive). Photo (IMAGE) values are not
 * embedded — the GAMBAR KELEGAAN columns surface the OCR reading.
 */
const SAVR_FIXED_META_HEADERS = [
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

/** The one mainhead that keeps the legacy dynamic checklist layout. */
const KUANTAN_MAINHEAD_NAME = 'KUANTAN';

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

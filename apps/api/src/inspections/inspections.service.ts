import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { extname, resolve } from 'path';
import {
  DefectLifecycleStatus,
  DefectSeverity,
  InspectionCompletionStatus,
  InspectionItemInputType,
  Prisma,
  SiteVisitStatus,
  UserRole,
} from '@prisma/client';
import {
  DEFAULT_OPERATION_MODE,
  DEFAULT_OPERATIONAL_SCOPE,
  inferOperationalScopeFromAssetTypeCode,
  scopeRequiresQAQC,
} from '../common/operational-scope';
import { buildInitialDefectData } from '../defects/defect-materialization.util';
import { releaseVisitDefects } from '../defects/defect-release.util';
import { releaseDefectsOnReport } from '../common/authorization/defect-governance';
import {
  buildInspectionImagePath,
  buildInspectionImageUrl,
  buildInspectionImagesDirectory,
} from '../common/uploads.constants';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { normalizeOperationalText } from '../common/operational-text';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeTemplateSelectOptions } from '../templates/template-builder.constants';
import { TemplatesService } from '../templates/templates.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import {
  SaveInspectionItemResultDto,
  SaveInspectionResultItemDto,
  SaveInspectionResultsDto,
} from './dto/save-inspection-results.dto';
import { UploadInspectionImageDto } from './dto/upload-inspection-image.dto';

type UploadedInspectionImageFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const ACTIVE_SITE_VISIT_STATUSES = [
  SiteVisitStatus.ACTIVE,
  SiteVisitStatus.OPEN,
  SiteVisitStatus.IN_PROGRESS,
] as const;

const OPERATIONAL_TEXT_KEYWORDS = [
  'nama pencawang',
  'functional location',
  'kod pencawang',
  'mainhead',
  'no tiang rondaan',
  'no tiang lama',
  'asset code',
  'asset name',
  'remark',
  'remarks',
  'catatan',
  'note',
  'notes',
];

@Injectable()
export class InspectionsService {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templatesService: TemplatesService,
  ) {}

  async create(user: RequestUser, dto: CreateInspectionDto) {
    this.assertCanMutate(user);

    const siteVisit = await this.prisma.siteVisit.findFirst({
      where: {
        id: dto.siteVisitId,
        tenantId: user.tenantId,
        status: {
          in: [...ACTIVE_SITE_VISIT_STATUSES],
        },
        ...this.siteVisitAccessScope(user),
      },
      include: {
        team: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!siteVisit) {
      throw new NotFoundException('Active site visit not found.');
    }

    const asset = await this.prisma.asset.findFirst({
      where: {
        id: dto.assetId,
        tenantId: user.tenantId,
      },
      include: {
        assetType: {
          select: {
            id: true,
            code: true,
            name: true,
            capabilityId: true,
            operationalScope: true,
          },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    if (asset.substationId !== siteVisit.substationId) {
      throw new BadRequestException('Asset does not belong to the substation for the selected site visit.');
    }

    // Idempotent per (asset, site visit): inspecting a pole that already has an
    // inspection this visit returns the existing one instead of minting a
    // duplicate cycle (re-taps of "Inspection" / "Save & inspect"). A genuine
    // new cycle is always a new site visit, so this never blocks re-inspection.
    const existingInspection = await this.prisma.inspection.findFirst({
      where: {
        tenantId: user.tenantId,
        siteVisitId: siteVisit.id,
        assetId: asset.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: this.inspectionInclude(),
    });

    if (existingInspection) {
      return existingInspection;
    }

    const operationalSession = dto.operationalSessionId
      ? await this.resolveOperationalSessionContext(user, dto.operationalSessionId, asset.id)
      : null;

    const templateResolution = await this.templatesService.resolveActiveTemplate(user, {
      assetTypeId: asset.assetTypeId,
      capabilityId: asset.assetType.capabilityId,
      siteVisitId: siteVisit.id,
      operationalSessionId: operationalSession?.id,
      organizationId: siteVisit.organizationId ?? operationalSession?.organizationId ?? null,
      branchId: siteVisit.branchId ?? operationalSession?.branchId ?? null,
      mainheadId: siteVisit.mainheadId ?? operationalSession?.mainheadId ?? null,
    });
    const template = templateResolution.template;
    const operationalScope =
      dto.operationalScope ??
      siteVisit.operationalScope ??
      asset.assetType.operationalScope ??
      inferOperationalScopeFromAssetTypeCode(asset.assetType.code) ??
      DEFAULT_OPERATIONAL_SCOPE;
    const operationMode =
      dto.operationMode ??
      siteVisit.operationMode ??
      DEFAULT_OPERATION_MODE;
    const requiresQAQC =
      dto.requiresQAQC ??
      siteVisit.requiresQAQC ??
      scopeRequiresQAQC(operationalScope);
    const reportingGroup =
      this.normalizeOperationalString(dto.reportingGroup) ??
      siteVisit.reportingGroup;

    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: {
          tenantId: user.tenantId,
          siteVisitId: siteVisit.id,
          assetId: asset.id,
          templateId: template.id,
          operationalSessionId: operationalSession?.id ?? null,
          createdByUserId: user.id,
          inspectionCycle: dto.inspectionCycle ?? 1,
          operationMode,
          operationalScope,
          requiresQAQC,
          reportingGroup,
        },
        include: this.inspectionInclude(),
      });

      await tx.siteVisitAsset.upsert({
        where: {
          siteVisitId_assetId: {
            siteVisitId: siteVisit.id,
            assetId: asset.id,
          },
        },
        create: {
          siteVisitId: siteVisit.id,
          assetId: asset.id,
          addedByUserId: user.id,
          source: 'INSPECTION',
        },
        update: {},
      });

      return inspection;
    });
  }

  async getForm(user: RequestUser, inspectionId: string) {
    const inspection = await this.getAccessibleInspection(inspectionId, user);

    return this.serializeInspectionForm(inspection);
  }

  async getDetail(user: RequestUser, inspectionId: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: {
        id: inspectionId,
        tenantId: user.tenantId,
        ...this.inspectionAccessScope(user),
      },
      include: {
        inspectionImages: {
          orderBy: {
            createdAt: 'asc',
          },
          select: {
            id: true,
            inspectionId: true,
            url: true,
            filename: true,
            latitude: true,
            longitude: true,
            timestamp: true,
            createdAt: true,
          },
        },
        results: {
          select: {
            valueText: true,
            templateItem: {
              select: {
                key: true,
                label: true,
              },
            },
          },
        },
        itemResults: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found.');
    }

    return {
      id: inspection.id,
      assetId: inspection.assetId,
      operationalSessionId: inspection.operationalSessionId,
      cycleNumber: inspection.inspectionCycle,
      status: inspection.completionStatus,
      operationMode: inspection.operationMode,
      operationalScope: inspection.operationalScope,
      requiresQAQC: inspection.requiresQAQC,
      reportingGroup: inspection.reportingGroup,
      submittedAt: inspection.submittedAt?.toISOString() ?? null,
      createdAt: inspection.createdAt.toISOString(),
      updatedAt: inspection.updatedAt.toISOString(),
      remarks: this.extractRemarks(inspection.results) || null,
      items: inspection.itemResults.map((item) => this.serializeInspectionItemResult(item)),
      totalDefects: inspection.itemResults.filter((item) => item.isDefect).length,
      images: inspection.inspectionImages.map((image) => this.serializeInspectionImage(image)),
    };
  }

  async saveResults(user: RequestUser, inspectionId: string, dto: SaveInspectionResultsDto) {
    this.assertCanMutate(user);

    const inspection = await this.getAccessibleInspection(inspectionId, user);

    this.assertVisitEditable(inspection.siteVisit.status);

    if (inspection.completionStatus === InspectionCompletionStatus.SUBMITTED) {
      throw new BadRequestException('Submitted inspections cannot be modified.');
    }

    await this.assertInspectionDefectEvidenceEditable(inspection.id);

    const hasStructuredItems = dto.items !== undefined;
    const hasLegacyResults = dto.results !== undefined;

    if (!hasStructuredItems && !hasLegacyResults) {
      throw new BadRequestException('Inspection results payload must include items or results.');
    }

    if (hasStructuredItems) {
      await this.saveStructuredItemResults(inspection, dto.items ?? []);
    }

    if (hasLegacyResults) {
      await this.saveLegacyTemplateResults(inspection, dto.results ?? []);
    }

    return this.getForm(user, inspectionId);
  }

  private async assertInspectionDefectEvidenceEditable(inspectionId: string) {
    const governedDefect = await this.prisma.defect.findFirst({
      where: {
        lifecycleStatus: {
          in: [
            DefectLifecycleStatus.UNDER_REVIEW,
            DefectLifecycleStatus.VERIFIED,
            DefectLifecycleStatus.REJECTED,
            DefectLifecycleStatus.ASSIGNED,
            DefectLifecycleStatus.IN_PROGRESS,
            DefectLifecycleStatus.COMPLETED,
            DefectLifecycleStatus.VERIFICATION_PENDING,
            DefectLifecycleStatus.CLOSED,
          ],
        },
        inspectionItemResult: {
          inspectionId,
        },
      },
      select: {
        id: true,
      },
    });

    if (governedDefect) {
      throw new BadRequestException(
        'Defect evidence already entered governance review and cannot be overwritten.',
      );
    }
  }

  /**
   * Block all inspection edits once the owning site visit (Pencawang) is no
   * longer active — i.e. it has been Completed or Cancelled. Inspections, and
   * the defects their checklist answers produce, are editable only while the
   * visit is open. siteVisit.status is loaded by inspectionInclude().
   */
  private assertVisitEditable(siteVisitStatus: SiteVisitStatus) {
    const isActive = (
      ACTIVE_SITE_VISIT_STATUSES as readonly SiteVisitStatus[]
    ).includes(siteVisitStatus);

    if (!isActive) {
      throw new BadRequestException(
        'This site visit has been completed. The inspection can no longer be edited.',
      );
    }
  }

  /**
   * Re-open a SUBMITTED inspection for correction (amend tweak): revert it to
   * DRAFT so the field user can fix wrongly-entered data and re-submit. Blocked
   * if any of its defects has already entered maintenance (assigned / in
   * progress / completed / etc.) — those must be resolved first. The
   * pre-maintenance auto-created defects are removed so a clean re-submit
   * regenerates them from the amended results.
   */
  async amendInspection(user: RequestUser, inspectionId: string) {
    this.assertCanMutate(user);

    const inspection = await this.getAccessibleInspection(inspectionId, user);

    this.assertVisitEditable(inspection.siteVisit.status);

    if (inspection.completionStatus !== InspectionCompletionStatus.SUBMITTED) {
      throw new BadRequestException('Only a submitted inspection can be amended.');
    }

    const itemResults = await this.prisma.inspectionItemResult.findMany({
      where: { inspectionId: inspection.id },
      select: { id: true },
    });
    const itemResultIds = itemResults.map((result) => result.id);

    if (itemResultIds.length > 0) {
      const maintainedDefect = await this.prisma.defect.findFirst({
        where: {
          inspectionItemResultId: { in: itemResultIds },
          lifecycleStatus: {
            in: [
              DefectLifecycleStatus.ASSIGNED,
              DefectLifecycleStatus.IN_PROGRESS,
              DefectLifecycleStatus.COMPLETED,
              DefectLifecycleStatus.VERIFICATION_PENDING,
              DefectLifecycleStatus.CLOSED,
            ],
          },
        },
        select: { id: true },
      });

      if (maintainedDefect) {
        throw new BadRequestException(
          'This inspection has a defect already in maintenance and cannot be amended. Resolve the defect first.',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.defect.deleteMany({
        where: { inspectionItemResultId: { in: itemResultIds } },
      }),
      this.prisma.inspection.update({
        where: { id: inspection.id },
        data: {
          completionStatus: InspectionCompletionStatus.DRAFT,
          submittedAt: null,
        },
      }),
    ]);

    return this.getForm(user, inspectionId);
  }

  private async saveStructuredItemResults(
    inspection: Awaited<ReturnType<InspectionsService['getAccessibleInspection']>>,
    items: SaveInspectionItemResultDto[],
  ) {
    const templateItems = this.flattenTemplateItems(inspection.template.sections);
    const templateItemIds = new Set(templateItems.map((item) => item.id));
    const templateItemById = new Map(templateItems.map((item) => [item.id, item]));
    const checklistItemIdByLabel = this.buildChecklistItemIdByLabel(templateItems);

    const data = items.map((item) => {
      const label = item.label.trim();

      if (!label) {
        throw new BadRequestException('Checklist item label is required.');
      }

      if (item.checklistItemId && !templateItemIds.has(item.checklistItemId)) {
        throw new BadRequestException(
          `Checklist item ${item.checklistItemId} does not belong to this inspection template.`,
        );
      }

      const checklistItemId =
        item.checklistItemId ?? checklistItemIdByLabel.get(this.normalizeLabelKey(label)) ?? null;
      const templateItem = checklistItemId ? templateItemById.get(checklistItemId) : null;
      const remark = this.normalizeOperationalString(item.remark);
      const isDefect = item.result === 'FAIL' && templateItem?.isDefectTrigger !== false;
      // Emergency only carries meaning on an actual defect — an inspector
      // flagging a dangerous-to-public condition on a failed item.
      const isEmergency = isDefect && item.isEmergency === true;
      const severity =
        templateItem && templateItem.isDefectTrigger !== false
          ? templateItem.severity ?? DefectSeverity.MEDIUM
          : null;

      return {
        inspectionId: inspection.id,
        checklistItemId,
        label,
        result: item.result,
        remark,
        isDefect,
        isEmergency,
        severity,
      };
    });

    await this.prisma.$transaction([
      this.prisma.inspectionItemResult.deleteMany({
        where: {
          inspectionId: inspection.id,
        },
      }),
      this.prisma.inspectionItemResult.createMany({
        data,
      }),
    ]);
  }

  private async saveLegacyTemplateResults(
    inspection: Awaited<ReturnType<InspectionsService['getAccessibleInspection']>>,
    results: SaveInspectionResultItemDto[],
  ) {
    const templateItems = this.flattenTemplateItems(inspection.template.sections);
    const templateItemMap = new Map(templateItems.map((item) => [item.id, item]));

    await this.prisma.$transaction(
      results.map((input) => {
        const templateItem = templateItemMap.get(input.templateItemId);
        if (!templateItem) {
          throw new BadRequestException(`Template item ${input.templateItemId} does not belong to this inspection template.`);
        }

        const valueData = this.buildResultValueData(templateItem, input);

        return this.prisma.inspectionResult.upsert({
          where: {
            inspectionId_templateItemId: {
              inspectionId: inspection.id,
              templateItemId: templateItem.id,
            },
          },
          create: {
            inspectionId: inspection.id,
            templateItemId: templateItem.id,
            ...valueData,
          },
          update: valueData,
        });
      }),
    );
  }

  async submit(user: RequestUser, inspectionId: string) {
    this.assertCanMutate(user);

    const inspection = await this.getAccessibleInspection(inspectionId, user);

    this.assertVisitEditable(inspection.siteVisit.status);

    if (inspection.completionStatus === InspectionCompletionStatus.SUBMITTED) {
      throw new BadRequestException('Inspection has already been submitted.');
    }

    const templateItems = this.flattenTemplateItems(inspection.template.sections);
    if (inspection.itemResults.length > 0) {
      const missingChecklistItems = this.findMissingStructuredChecklistItems(
        templateItems,
        inspection.itemResults,
      );

      if (missingChecklistItems.length > 0) {
        throw new BadRequestException({
          message: 'Checklist selections are missing.',
          missingItems: missingChecklistItems,
        });
      }
    } else {
      const resultMap = new Map(inspection.results.map((result) => [result.templateItemId, result]));

      const missingRequiredItems = templateItems
        .filter((item) => item.isRequired)
        .filter((item) => !this.hasStoredValue(resultMap.get(item.id)))
        .map((item) => ({
          templateItemId: item.id,
          key: item.key,
          label: item.label,
        }));

      if (missingRequiredItems.length > 0) {
        throw new BadRequestException({
          message: 'Required inspection items are missing.',
          missingItems: missingRequiredItems,
        });
      }
    }

    const defectCreateData = this.buildDefectCreateData(inspection.itemResults);
    const submitInspection = this.prisma.inspection.update({
      where: { id: inspection.id },
      data: {
        completionStatus: InspectionCompletionStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      include: this.inspectionInclude(),
    });

    if (defectCreateData.length === 0) {
      return submitInspection;
    }

    const [submittedInspection] = await this.prisma.$transaction([
      submitInspection,
      this.prisma.defect.createMany({
        data: defectCreateData,
        skipDuplicates: true,
      }),
    ]);

    // Maintenance handoff Phase 3 — emergency-flagged defects bypass the LAPORAN
    // SELESAI wait: release + route them to the MAINHEAD's maintenance company
    // immediately. Best-effort; a failure must not fail the submit (the defects
    // exist and the LAPORAN SELESAI release is the safety net for the rest).
    if (
      releaseDefectsOnReport() &&
      defectCreateData.some((defect) => defect.isEmergency)
    ) {
      try {
        await releaseVisitDefects(this.prisma, inspection.siteVisitId, {
          scope: 'EMERGENCY',
          actorUserId: user.id,
          inspectionId: inspection.id,
        });
      } catch (error) {
        this.logger.warn(
          `Emergency defect release failed for site visit ${inspection.siteVisitId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return submittedInspection;
  }

  async uploadImage(
    user: RequestUser,
    inspectionId: string,
    file: UploadedInspectionImageFile | undefined,
    dto: UploadInspectionImageDto,
  ) {
    this.assertCanMutate(user);

    if (!file?.buffer?.length) {
      throw new BadRequestException('Image file is required.');
    }

    const inspection = await this.prisma.inspection.findFirst({
      where: {
        id: inspectionId,
        tenantId: user.tenantId,
        ...this.inspectionAccessScope(user),
      },
      select: {
        id: true,
        siteVisit: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found.');
    }

    this.assertVisitEditable(inspection.siteVisit.status);

    const uploadDirectory = buildInspectionImagesDirectory(inspection.id);

    await mkdir(uploadDirectory, { recursive: true });

    const fileExtension = this.getSafeFileExtension(file.originalname);
    const filename = `${Date.now()}-${randomUUID()}${fileExtension}`;
    const filePath = resolve(uploadDirectory, filename);

    await writeFile(filePath, file.buffer);

    const image = await this.prisma.inspectionImage.create({
      data: {
        inspectionId: inspection.id,
        templateItemId: dto.templateItemId ?? null,
        url: buildInspectionImageUrl(inspection.id, filename),
        filename,
        mimeType: file.mimetype || null,
        sizeBytes: Number.isFinite(file.size) ? file.size : null,
        latitude: dto.latitude,
        longitude: dto.longitude,
        timestamp: dto.timestamp ? new Date(dto.timestamp) : null,
      },
    });

    return this.serializeInspectionImage(image, dto.type ?? null);
  }

  /**
   * Remove a single inspection image (e.g. deleting/replacing a photo while
   * amending). Same editability gate as uploadImage — the visit must be open —
   * and the image must belong to the (accessible) inspection. The DB row is the
   * source of truth; the on-disk file is removed best-effort.
   */
  async deleteImage(user: RequestUser, inspectionId: string, imageId: string) {
    this.assertCanMutate(user);

    const inspection = await this.prisma.inspection.findFirst({
      where: {
        id: inspectionId,
        tenantId: user.tenantId,
        ...this.inspectionAccessScope(user),
      },
      select: {
        id: true,
        siteVisit: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found.');
    }

    this.assertVisitEditable(inspection.siteVisit.status);

    const image = await this.prisma.inspectionImage.findFirst({
      where: {
        id: imageId,
        inspectionId: inspection.id,
      },
      select: {
        id: true,
        filename: true,
      },
    });

    if (!image) {
      throw new NotFoundException('Image not found.');
    }

    await this.prisma.inspectionImage.delete({ where: { id: image.id } });

    try {
      await unlink(resolve(buildInspectionImagesDirectory(inspection.id), image.filename));
    } catch {
      // File may already be gone; the row deletion is what matters.
    }

    return { id: image.id, deleted: true };
  }

  private serializeInspectionItemResult(item: {
    id: string;
    inspectionId: string;
    checklistItemId: string | null;
    label: string;
    result: string;
    remark: string | null;
    isDefect: boolean;
    isEmergency: boolean;
    severity: DefectSeverity | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      inspectionId: item.inspectionId,
      checklistItemId: item.checklistItemId,
      label: item.label,
      result: item.result,
      remark: item.remark,
      isDefect: item.isDefect,
      isEmergency: item.isEmergency,
      severity: item.severity,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private serializeInspectionImage(
    image: {
      id: string;
      inspectionId: string;
      url: string;
      filename: string;
      latitude: number | null;
      longitude: number | null;
      timestamp: Date | null;
      createdAt: Date;
    },
    type: string | null = null,
  ) {
    return {
      id: image.id,
      inspectionId: image.inspectionId,
      url: image.url,
      path: buildInspectionImagePath(image.inspectionId, image.filename),
      latitude: image.latitude,
      longitude: image.longitude,
      timestamp: image.timestamp?.toISOString() ?? null,
      type,
      createdAt: image.createdAt.toISOString(),
    };
  }

  private getSafeFileExtension(originalName: string | undefined) {
    const extension = extname(originalName || '').toLowerCase();

    if (/^\.[a-z0-9]{1,10}$/.test(extension)) {
      return extension;
    }

    return '.jpg';
  }

  private async getAccessibleInspection(inspectionId: string, user: RequestUser) {
    const inspection = await this.prisma.inspection.findFirst({
      where: {
        id: inspectionId,
        tenantId: user.tenantId,
        ...this.inspectionAccessScope(user),
      },
      include: {
        ...this.inspectionInclude(),
        template: {
          include: {
            sections: {
              include: {
                items: {
                  where: {
                    isActive: true,
                  },
                  orderBy: {
                    sortOrder: 'asc',
                  },
                },
              },
              orderBy: {
                sortOrder: 'asc',
              },
            },
          },
        },
        results: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        itemResults: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        // Already-uploaded photos (incl. per-item IMAGE/OCR captures tagged by
        // templateItemId) so the form can rehydrate them on re-open/amend —
        // otherwise required IMAGE items wrongly read as missing and force a
        // retake.
        inspectionImages: {
          orderBy: {
            createdAt: 'asc',
          },
          select: {
            id: true,
            inspectionId: true,
            templateItemId: true,
            url: true,
            filename: true,
            latitude: true,
            longitude: true,
            timestamp: true,
            createdAt: true,
          },
        },
      },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found.');
    }

    return inspection;
  }

  private siteVisitAccessScope(user: RequestUser) {
    if (user.role === 'ADMIN') {
      return {};
    }

    return {
      team: {
        members: {
          some: {
            userId: user.id,
            isActive: true,
          },
        },
      },
    };
  }

  private inspectionAccessScope(user: RequestUser) {
    if (user.role === 'ADMIN') {
      return {};
    }

    return {
      siteVisit: {
        team: {
          members: {
            some: {
              userId: user.id,
              isActive: true,
            },
          },
        },
      },
    };
  }

  private async resolveOperationalSessionContext(
    user: RequestUser,
    operationalSessionId: string,
    assetId: string,
  ) {
    const session = await this.prisma.operationalSession.findFirst({
      where: {
        AND: [
          {
            id: operationalSessionId,
            workspaceId: user.tenantId,
          },
          await this.operationalSessionAccessScope(user),
        ],
      },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        mainheadId: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Operational session not found.');
    }

    const assignment = await this.prisma.operationalSessionAsset.findFirst({
      where: {
        operationalSessionId: session.id,
        assetId,
        removedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!assignment) {
      throw new BadRequestException(
        'Asset is not assigned to this operational session.',
      );
    }

    return session;
  }

  private async operationalSessionAccessScope(
    user: RequestUser,
  ): Promise<Prisma.OperationalSessionWhereInput> {
    if (user.role === UserRole.ADMIN) {
      return {};
    }

    const organizationIds = await this.getUserOrganizationIds(user);
    const accessFilters: Prisma.OperationalSessionWhereInput[] = [
      {
        assignedQaUserId: user.id,
      },
    ];

    if (organizationIds.length > 0) {
      accessFilters.push({
        assignedCompanyId: {
          in: organizationIds,
        },
      });
    }

    return {
      OR: accessFilters,
    };
  }

  private async getUserOrganizationIds(user: RequestUser) {
    const currentUser = await this.prisma.user.findFirst({
      where: {
        id: user.id,
        tenantId: user.tenantId,
        isActive: true,
      },
      select: {
        organizationId: true,
        organizationMemberships: {
          where: {
            isActive: true,
          },
          select: {
            organizationId: true,
          },
        },
      },
    });

    if (!currentUser) {
      return [];
    }

    return Array.from(
      new Set(
        [
          currentUser.organizationId,
          ...currentUser.organizationMemberships.map(
            (membership) => membership.organizationId,
          ),
        ].filter((organizationId): organizationId is string =>
          Boolean(organizationId),
        ),
      ),
    );
  }

  private inspectionInclude() {
    return {
      siteVisit: {
        select: {
          id: true,
          status: true,
          operationMode: true,
          operationalScope: true,
          sessionKind: true,
          requiresQAQC: true,
          reportingGroup: true,
          startedAt: true,
          team: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          substation: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
      asset: {
        select: {
          id: true,
          assetCode: true,
          name: true,
          assetType: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          substation: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
      template: {
        select: {
          id: true,
          name: true,
          version: true,
          assetTypeId: true,
          capabilityId: true,
          scopeLevel: true,
          organizationId: true,
          branchId: true,
          mainheadId: true,
          operationalScope: true,
          requiresQAQC: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
    };
  }

  private assertCanMutate(user: RequestUser) {
    if (user.role === UserRole.VIEWER) {
      throw new ForbiddenException('VIEWER role is read-only for inspection actions.');
    }
  }

  private flattenTemplateItems(
    sections: Array<{
      items: Array<{
        id: string;
        key: string;
        label: string;
        inputType: InspectionItemInputType;
        isRequired: boolean;
        isDefectTrigger: boolean;
        severity: DefectSeverity;
        optionsJson: Prisma.JsonValue | null;
      }>;
    }>,
  ) {
    return sections.flatMap((section) => section.items);
  }

  private buildChecklistItemIdByLabel(
    templateItems: Array<{
      id: string;
      label: string;
    }>,
  ) {
    const byLabel = new Map<string, string | null>();

    for (const item of templateItems) {
      const labelKey = this.normalizeLabelKey(item.label);

      if (!labelKey) {
        continue;
      }

      byLabel.set(labelKey, byLabel.has(labelKey) ? null : item.id);
    }

    return byLabel;
  }

  private findMissingStructuredChecklistItems(
    templateItems: Array<{
      id: string;
      key: string;
      label: string;
    }>,
    itemResults: Array<{
      checklistItemId: string | null;
      label: string;
    }>,
  ) {
    const resultItemIds = new Set(
      itemResults
        .map((item) => item.checklistItemId)
        .filter((id): id is string => Boolean(id)),
    );
    const resultLabelCounts = new Map<string, number>();

    for (const item of itemResults) {
      if (item.checklistItemId) {
        continue;
      }

      const labelKey = this.normalizeLabelKey(item.label);

      if (!labelKey) {
        continue;
      }

      resultLabelCounts.set(labelKey, (resultLabelCounts.get(labelKey) ?? 0) + 1);
    }

    const missingItems: Array<{
      templateItemId: string;
      key: string;
      label: string;
    }> = [];

    for (const item of templateItems) {
      if (resultItemIds.has(item.id)) {
        continue;
      }

      const labelKey = this.normalizeLabelKey(item.label);
      const labelResultCount = resultLabelCounts.get(labelKey) ?? 0;

      if (labelResultCount > 0) {
        resultLabelCounts.set(labelKey, labelResultCount - 1);
        continue;
      }

      missingItems.push({
        templateItemId: item.id,
        key: item.key,
        label: item.label,
      });
    }

    return missingItems;
  }

  private normalizeLabelKey(label: string) {
    return label.trim().toLowerCase();
  }

  private normalizeOptionalString(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue ? trimmedValue : null;
  }

  private normalizeOperationalString(value?: string | null) {
    const normalizedValue = this.normalizeOptionalString(value);

    return normalizedValue ? normalizeOperationalText(normalizedValue) : null;
  }

  private normalizeTemplateTextValue(
    templateItem: {
      key: string;
      label: string;
    },
    value: string,
  ) {
    const trimmedValue = value.trim();

    if (!this.isOperationalTemplateTextItem(templateItem)) {
      return trimmedValue;
    }

    return this.normalizeOperationalString(trimmedValue);
  }

  private isOperationalTemplateTextItem(templateItem: { key: string; label: string }) {
    const searchText = `${templateItem.key} ${templateItem.label}`.toLowerCase();

    return OPERATIONAL_TEXT_KEYWORDS.some((keyword) => searchText.includes(keyword));
  }

  private buildResultValueData(
    templateItem: {
      id: string;
      key: string;
      label: string;
      inputType: InspectionItemInputType;
      optionsJson: Prisma.JsonValue | null;
    },
    input: SaveInspectionResultItemDto,
  ): {
    valueText: string | null;
    valueNumber: number | null;
    valueBoolean: boolean | null;
    valueDate: Date | null;
    valueDateTime: Date | null;
    valueJson: Prisma.InputJsonValue | typeof Prisma.DbNull;
  } {
    const baseValueData = {
      valueText: null,
      valueNumber: null,
      valueBoolean: null,
      valueDate: null,
      valueDateTime: null,
      valueJson: Prisma.DbNull,
    };

    switch (templateItem.inputType) {
      case InspectionItemInputType.TEXT:
        if (input.valueText === undefined) {
          throw new BadRequestException(`valueText is required for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueText:
            input.valueText === null
              ? null
              : this.normalizeTemplateTextValue(templateItem, input.valueText),
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.NUMBER:
        if (input.valueNumber === undefined) {
          throw new BadRequestException(`valueNumber is required for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueNumber: input.valueNumber,
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.OCR:
        // Smart Sensor reading (#4): stores the OCR'd / manually-entered number.
        // Lenient on null so a missing reading never blocks submission — the
        // captured photo is the evidence and the value stays editable.
        return {
          ...baseValueData,
          valueNumber: input.valueNumber ?? null,
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.BOOLEAN:
        if (input.valueBoolean === undefined) {
          throw new BadRequestException(`valueBoolean is required for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueBoolean: input.valueBoolean,
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.DATE:
        if (input.valueDate === undefined) {
          throw new BadRequestException(`valueDate is required for template item ${input.templateItemId}.`);
        }

        if (input.valueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.valueDate)) {
          throw new BadRequestException(`valueDate must be a YYYY-MM-DD string for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueDate: input.valueDate === null ? null : new Date(`${input.valueDate}T00:00:00.000Z`),
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.DATETIME:
        if (input.valueDateTime === undefined) {
          throw new BadRequestException(`valueDateTime is required for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueDateTime: input.valueDateTime === null ? null : new Date(input.valueDateTime),
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.SELECT: {
        if (input.valueText === undefined) {
          throw new BadRequestException(`valueText is required for template item ${input.templateItemId}.`);
        }

        const selectedValue = input.valueText === null ? null : input.valueText.trim();

        if (selectedValue !== null && selectedValue !== '') {
          const allowedOptions = normalizeTemplateSelectOptions(templateItem.optionsJson);

          if (!allowedOptions) {
            throw new BadRequestException(
              `Template item ${templateItem.id} has invalid SELECT options configuration.`,
            );
          }

          const isAllowedOption = allowedOptions.some((option) => option.value === selectedValue);

          if (!isAllowedOption) {
            throw new BadRequestException(
              `valueText must match one of the configured SELECT options for template item ${input.templateItemId}.`,
            );
          }
        }

        return {
          ...baseValueData,
          valueText: selectedValue === '' ? null : selectedValue,
          valueJson: Prisma.DbNull,
        };
      }

      case InspectionItemInputType.MULTI_SELECT: {
        const selectedValues = this.normalizeMultiSelectValue(templateItem, input);

        return {
          ...baseValueData,
          valueJson:
            selectedValues === null
              ? Prisma.DbNull
              : (selectedValues as Prisma.InputJsonArray),
        };
      }

      case InspectionItemInputType.IMAGE:
        return {
          ...baseValueData,
          valueJson:
            input.valueJson === undefined || input.valueJson === null
              ? Prisma.DbNull
              : (input.valueJson as Prisma.InputJsonValue),
        };

      case InspectionItemInputType.GPS:
        if (input.valueJson !== undefined) {
          return {
            ...baseValueData,
            valueJson:
              input.valueJson === null
                ? Prisma.DbNull
                : (input.valueJson as Prisma.InputJsonValue),
          };
        }

        if (input.valueText === undefined) {
          throw new BadRequestException(`valueText or valueJson is required for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueText: input.valueText === null ? null : input.valueText.trim() || null,
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.READING:
        if (input.valueNumber !== undefined) {
          return {
            ...baseValueData,
            valueNumber: input.valueNumber,
            valueJson: Prisma.DbNull,
          };
        }

        if (input.valueText !== undefined) {
          return {
            ...baseValueData,
            valueText: input.valueText === null ? null : input.valueText.trim() || null,
            valueJson: Prisma.DbNull,
          };
        }

        if (input.valueJson !== undefined) {
          return {
            ...baseValueData,
            valueJson:
              input.valueJson === null
                ? Prisma.DbNull
                : (input.valueJson as Prisma.InputJsonValue),
          };
        }

        throw new BadRequestException(`valueNumber or valueText is required for template item ${input.templateItemId}.`);

      case InspectionItemInputType.JSON:
        if (input.valueJson === undefined) {
          throw new BadRequestException(`valueJson is required for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueJson:
            input.valueJson === null
              ? Prisma.DbNull
              : (input.valueJson as Prisma.InputJsonValue),
        };

      default:
        throw new ForbiddenException(`Unsupported input type ${templateItem.inputType}.`);
    }
  }

  private normalizeMultiSelectValue(
    templateItem: {
      id: string;
      optionsJson: Prisma.JsonValue | null;
    },
    input: SaveInspectionResultItemDto,
  ) {
    const rawValues = input.valueJson ?? input.valueText;

    if (rawValues === undefined || rawValues === null || rawValues === '') {
      return null;
    }

    const selectedValues = Array.isArray(rawValues)
      ? rawValues
      : String(rawValues)
          .split(',')
          .map((value) => value.trim());
    const normalizedValues = selectedValues.filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    );

    if (normalizedValues.length === 0) {
      return null;
    }

    const allowedOptions = normalizeTemplateSelectOptions(templateItem.optionsJson);

    if (!allowedOptions) {
      throw new BadRequestException(
        `Template item ${templateItem.id} has invalid MULTI_SELECT options configuration.`,
      );
    }

    const allowedValues = new Set(allowedOptions.map((option) => option.value));
    const uniqueValues = Array.from(new Set(normalizedValues));
    const invalidValue = uniqueValues.find((value) => !allowedValues.has(value));

    if (invalidValue) {
      throw new BadRequestException(
        `valueJson contains an option that is not configured for template item ${templateItem.id}: ${invalidValue}.`,
      );
    }

    return uniqueValues;
  }

  private hasStoredValue(
    result:
      | {
          valueText: string | null;
          valueNumber: Prisma.Decimal | null;
          valueBoolean: boolean | null;
          valueDate: Date | null;
          valueDateTime: Date | null;
          valueJson: Prisma.JsonValue | null;
        }
      | undefined,
  ) {
    if (!result) {
      return false;
    }

    if (result.valueText !== null && result.valueText.trim() !== '') {
      return true;
    }

    if (result.valueNumber !== null) {
      return true;
    }

    if (result.valueBoolean !== null) {
      return true;
    }

    if (result.valueDate !== null) {
      return true;
    }

    if (result.valueDateTime !== null) {
      return true;
    }

    return result.valueJson !== null;
  }

  private extractRemarks(
    results: Array<{
      valueText: string | null;
      templateItem: {
        key: string;
        label: string;
      };
    }>,
  ) {
    const remarkResult = results.find((result) => {
      const key = result.templateItem.key.toLowerCase();
      const label = result.templateItem.label.toLowerCase();

      return (
        key.includes('remark') ||
        label.includes('remark') ||
        key.includes('catatan') ||
        label.includes('catatan')
      );
    });

    return remarkResult?.valueText?.trim() ?? '';
  }

  private serializeInspectionForm(
    inspection: Awaited<ReturnType<InspectionsService['getAccessibleInspection']>>,
  ) {
    const resultMap = new Map(inspection.results.map((result) => [result.templateItemId, result]));

    return {
      inspection: {
        id: inspection.id,
        tenantId: inspection.tenantId,
        siteVisitId: inspection.siteVisitId,
        assetId: inspection.assetId,
        templateId: inspection.templateId,
        operationalSessionId: inspection.operationalSessionId,
        inspectionCycle: inspection.inspectionCycle,
        completionStatus: inspection.completionStatus,
        operationMode: inspection.operationMode,
        operationalScope: inspection.operationalScope,
        requiresQAQC: inspection.requiresQAQC,
        reportingGroup: inspection.reportingGroup,
        submittedAt: inspection.submittedAt,
        createdAt: inspection.createdAt,
        updatedAt: inspection.updatedAt,
        siteVisit: inspection.siteVisit,
        asset: inspection.asset,
        createdBy: inspection.createdBy,
      },
      template: {
        id: inspection.template.id,
        name: inspection.template.name,
        version: inspection.template.version,
        assetTypeId: inspection.template.assetTypeId,
        capabilityId: inspection.template.capabilityId,
        scopeLevel: inspection.template.scopeLevel,
        organizationId: inspection.template.organizationId,
        branchId: inspection.template.branchId,
        mainheadId: inspection.template.mainheadId,
        operationalScope: inspection.template.operationalScope,
        requiresQAQC: inspection.template.requiresQAQC,
        sections: inspection.template.sections.map((section) => ({
          id: section.id,
          title: section.title,
          description: section.description,
          sortOrder: section.sortOrder,
          items: section.items.map((item) => ({
            id: item.id,
            key: item.key,
            label: item.label,
            helperText: item.helperText,
            inputType: item.inputType,
            isRequired: item.isRequired,
            isDefectTrigger: item.isDefectTrigger,
            severity: item.severity,
            sortOrder: item.sortOrder,
            optionsJson: item.optionsJson,
            value: this.serializeStoredValue(resultMap.get(item.id)),
          })),
        })),
      },
      results: inspection.results.map((result) => ({
        id: result.id,
        templateItemId: result.templateItemId,
        valueText: result.valueText,
        valueNumber: result.valueNumber === null ? null : Number(result.valueNumber),
        valueBoolean: result.valueBoolean,
        valueDate: result.valueDate,
        valueDateTime: result.valueDateTime,
        valueJson: result.valueJson,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      })),
      items: inspection.itemResults.map((item) => this.serializeInspectionItemResult(item)),
      images: inspection.inspectionImages.map((image) => ({
        id: image.id,
        inspectionId: image.inspectionId,
        templateItemId: image.templateItemId,
        url: image.url,
        path: buildInspectionImagePath(image.inspectionId, image.filename),
        latitude: image.latitude,
        longitude: image.longitude,
        timestamp: image.timestamp?.toISOString() ?? null,
        createdAt: image.createdAt.toISOString(),
      })),
    };
  }

  private buildDefectCreateData(
    itemResults: Array<{
      id: string;
      isDefect: boolean;
      severity: DefectSeverity | null;
      isEmergency: boolean;
    }>,
  ) {
    const now = new Date();

    return itemResults
      .filter((item) => item.isDefect)
      .map((item) => buildInitialDefectData(item, now));
  }

  private serializeStoredValue(
    result:
      | {
          valueText: string | null;
          valueNumber: Prisma.Decimal | null;
          valueBoolean: boolean | null;
          valueDate: Date | null;
          valueDateTime: Date | null;
          valueJson: Prisma.JsonValue | null;
        }
      | undefined,
  ) {
    if (!result) {
      return null;
    }

    return {
      valueText: result.valueText,
      valueNumber: result.valueNumber === null ? null : Number(result.valueNumber),
      valueBoolean: result.valueBoolean,
      valueDate: result.valueDate,
      valueDateTime: result.valueDateTime,
      valueJson: result.valueJson,
    };
  }
}

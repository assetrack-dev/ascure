import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { extname, resolve } from 'path';
import {
  DefectSeverity,
  DefectStatus,
  InspectionCompletionStatus,
  InspectionItemInputType,
  Prisma,
} from '@prisma/client';
import {
  buildInspectionImagePath,
  buildInspectionImageUrl,
  buildInspectionImagesDirectory,
} from '../common/uploads.constants';
import { RequestUser } from '../common/interfaces/request-user.interface';
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

@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templatesService: TemplatesService,
  ) {}

  async create(user: RequestUser, dto: CreateInspectionDto) {
    const siteVisit = await this.prisma.siteVisit.findFirst({
      where: {
        id: dto.siteVisitId,
        tenantId: user.tenantId,
        status: 'ACTIVE',
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

    const template = await this.templatesService.getActiveTemplate(user, asset.assetTypeId);

    return this.prisma.inspection.create({
      data: {
        tenantId: user.tenantId,
        siteVisitId: siteVisit.id,
        assetId: asset.id,
        templateId: template.id,
        createdByUserId: user.id,
        inspectionCycle: dto.inspectionCycle ?? 1,
      },
      include: this.inspectionInclude(),
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
      cycleNumber: inspection.inspectionCycle,
      status: inspection.completionStatus,
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
    const inspection = await this.getAccessibleInspection(inspectionId, user);

    if (inspection.completionStatus === InspectionCompletionStatus.SUBMITTED) {
      throw new BadRequestException('Submitted inspections cannot be modified.');
    }

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
      const remark = this.normalizeOptionalString(item.remark);
      const isDefect = item.result === 'FAIL' && templateItem?.isDefectTrigger !== false;
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
    const inspection = await this.getAccessibleInspection(inspectionId, user);

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

    return submittedInspection;
  }

  async uploadImage(
    user: RequestUser,
    inspectionId: string,
    file: UploadedInspectionImageFile | undefined,
    dto: UploadInspectionImageDto,
  ) {
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
      },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found.');
    }

    const uploadDirectory = buildInspectionImagesDirectory(inspection.id);

    await mkdir(uploadDirectory, { recursive: true });

    const fileExtension = this.getSafeFileExtension(file.originalname);
    const filename = `${Date.now()}-${randomUUID()}${fileExtension}`;
    const filePath = resolve(uploadDirectory, filename);

    await writeFile(filePath, file.buffer);

    const image = await this.prisma.inspectionImage.create({
      data: {
        inspectionId: inspection.id,
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

  private serializeInspectionItemResult(item: {
    id: string;
    inspectionId: string;
    checklistItemId: string | null;
    label: string;
    result: string;
    remark: string | null;
    isDefect: boolean;
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

  private inspectionInclude() {
    return {
      siteVisit: {
        select: {
          id: true,
          status: true,
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

  private buildResultValueData(
    templateItem: {
      id: string;
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
          valueText: input.valueText === null ? null : input.valueText.trim(),
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
        inspectionCycle: inspection.inspectionCycle,
        completionStatus: inspection.completionStatus,
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
    };
  }

  private buildDefectCreateData(
    itemResults: Array<{
      id: string;
      isDefect: boolean;
      severity: DefectSeverity | null;
    }>,
  ) {
    const now = new Date();

    return itemResults
      .filter((item) => item.isDefect)
      .map((item) => ({
        id: randomUUID(),
        inspectionItemResultId: item.id,
        status: DefectStatus.OPEN,
        severity: item.severity ?? DefectSeverity.MEDIUM,
        createdAt: now,
        updatedAt: now,
      }));
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

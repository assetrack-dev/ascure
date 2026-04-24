import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InspectionCompletionStatus,
  InspectionItemInputType,
  Prisma,
} from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeTemplateSelectOptions } from '../templates/template-builder.constants';
import { TemplatesService } from '../templates/templates.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { SaveInspectionResultItemDto, SaveInspectionResultsDto } from './dto/save-inspection-results.dto';

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

  async saveResults(user: RequestUser, inspectionId: string, dto: SaveInspectionResultsDto) {
    const inspection = await this.getAccessibleInspection(inspectionId, user);

    if (inspection.completionStatus === InspectionCompletionStatus.SUBMITTED) {
      throw new BadRequestException('Submitted inspections cannot be modified.');
    }

    const templateItems = this.flattenTemplateItems(inspection.template.sections);
    const templateItemMap = new Map(templateItems.map((item) => [item.id, item]));

    await this.prisma.$transaction(
      dto.results.map((input) => {
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

    return this.getForm(user, inspectionId);
  }

  async submit(user: RequestUser, inspectionId: string) {
    const inspection = await this.getAccessibleInspection(inspectionId, user);

    if (inspection.completionStatus === InspectionCompletionStatus.SUBMITTED) {
      throw new BadRequestException('Inspection has already been submitted.');
    }

    const templateItems = this.flattenTemplateItems(inspection.template.sections);
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

    return this.prisma.inspection.update({
      where: { id: inspection.id },
      data: {
        completionStatus: InspectionCompletionStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      include: this.inspectionInclude(),
    });
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
          code: true,
          name: true,
          serialNumber: true,
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
        optionsJson: Prisma.JsonValue | null;
      }>;
    }>,
  ) {
    return sections.flatMap((section) => section.items);
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
    };
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

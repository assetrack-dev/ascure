import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DefectSeverity,
  InspectionItemInputType,
  InspectionTemplateScopeLevel,
  InspectionTemplateStatus,
  OperationalDomain,
  Prisma,
  UserRole,
} from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { CreateTemplateItemDto, UpdateTemplateItemDto } from './dto/create-template-item.dto';
import { CreateTemplateSectionDto, UpdateTemplateSectionDto } from './dto/create-template-section.dto';
import { ListTemplatesQueryDto } from './dto/list-templates-query.dto';
import {
  isTemplateBuilderInputType,
  normalizeTemplateSelectOptions,
} from './template-builder.constants';

const templateDetailInclude = {
  assetType: {
    select: {
      id: true,
      code: true,
      name: true,
      capabilityId: true,
      capability: {
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
        },
      },
    },
  },
  capability: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
    },
  },
  organization: {
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
    },
  },
  operationalRegion: {
    select: {
      id: true,
      tenantId: true,
      code: true,
      name: true,
      state: true,
      isActive: true,
    },
  },
  branch: {
    select: {
      id: true,
      code: true,
      name: true,
      region: true,
      organizationId: true,
    },
  },
  mainhead: {
    select: {
      id: true,
      code: true,
      name: true,
      branchId: true,
    },
  },
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
} satisfies Prisma.InspectionTemplateInclude;

type TemplateDetailRecord = Prisma.InspectionTemplateGetPayload<{
  include: typeof templateDetailInclude;
}>;

type PrismaClientLike = Prisma.TransactionClient | PrismaService;
type TemplateResolutionSource =
  | 'MAINHEAD'
  | 'OPERATIONAL_REGION'
  | 'BRANCH'
  | 'ORGANIZATION'
  | 'GLOBAL';

type TemplateScopeFields = {
  scopeLevel: InspectionTemplateScopeLevel;
  organizationId: string | null;
  operationalRegionId: string | null;
  branchId: string | null;
  mainheadId: string | null;
};

type TemplateMappingInput = {
  capabilityId?: string | null;
  scopeLevel?: InspectionTemplateScopeLevel | null;
  organizationId?: string | null;
  operationalRegionId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  operationalDomain?: OperationalDomain | null;
};

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveTemplate(user: RequestUser, assetTypeId: string) {
    const resolution = await this.resolveActiveTemplate(user, { assetTypeId });

    return resolution.template;
  }

  async resolveActiveTemplate(
    user: RequestUser,
    input: {
      assetTypeId?: string;
      assetId?: string;
      capabilityId?: string | null;
      siteVisitId?: string;
      operationalSessionId?: string;
      organizationId?: string | null;
      operationalRegionId?: string | null;
      branchId?: string | null;
      mainheadId?: string | null;
    },
  ): Promise<{ template: TemplateDetailRecord; source: TemplateResolutionSource }> {
    const context = await this.resolveTemplateResolutionContext(user, input);
    const assetTypeId = context.assetTypeId ?? input.assetTypeId;
    const capabilityId =
      context.capabilityId ??
      (assetTypeId ? await this.findAssetTypeCapabilityId(user.tenantId, assetTypeId) : null);
    const baseWhere = {
      tenantId: user.tenantId,
      assetTypeId,
      capabilityId,
    };

    if (assetTypeId && context.mainheadId) {
      const mainheadTemplate = await this.findActiveTemplate({
        ...baseWhere,
        scopeLevel: InspectionTemplateScopeLevel.MAINHEAD,
        mainheadId: context.mainheadId,
      });

      if (mainheadTemplate) {
        return {
          template: mainheadTemplate,
          source: 'MAINHEAD',
        };
      }
    }

    if (assetTypeId && context.operationalRegionId) {
      const operationalRegionTemplate = await this.findActiveTemplate({
        ...baseWhere,
        scopeLevel: InspectionTemplateScopeLevel.OPERATIONAL_REGION,
        operationalRegionId: context.operationalRegionId,
      });

      if (operationalRegionTemplate) {
        return {
          template: operationalRegionTemplate,
          source: 'OPERATIONAL_REGION',
        };
      }
    }

    if (assetTypeId && context.branchId) {
      const branchTemplate = await this.findActiveTemplate({
        ...baseWhere,
        scopeLevel: InspectionTemplateScopeLevel.BRANCH,
        branchId: context.branchId,
      });

      if (branchTemplate) {
        return {
          template: branchTemplate,
          source: 'BRANCH',
        };
      }
    }

    if (assetTypeId && context.organizationId) {
      const organizationTemplate = await this.findActiveTemplate({
        ...baseWhere,
        scopeLevel: InspectionTemplateScopeLevel.ORGANIZATION,
        organizationId: context.organizationId,
      });

      if (organizationTemplate) {
        return {
          template: organizationTemplate,
          source: 'ORGANIZATION',
        };
      }
    }

    const fallbackTemplate = await this.findActiveTemplate({
      ...baseWhere,
      scopeLevel: InspectionTemplateScopeLevel.GLOBAL,
      organizationId: null,
      operationalRegionId: null,
      branchId: null,
      mainheadId: null,
    });

    if (!fallbackTemplate) {
      throw new NotFoundException('Active inspection template not found.');
    }

    return {
      template: fallbackTemplate,
      source: 'GLOBAL',
    };
  }

  private async resolveTemplateResolutionContext(
    user: RequestUser,
    input: {
      assetTypeId?: string;
      assetId?: string;
      capabilityId?: string | null;
      siteVisitId?: string;
      operationalSessionId?: string;
      organizationId?: string | null;
      operationalRegionId?: string | null;
      branchId?: string | null;
      mainheadId?: string | null;
    },
  ) {
    let assetTypeId = input.assetTypeId ?? null;
    let capabilityId = input.capabilityId ?? null;
    let organizationId = input.organizationId ?? null;
    let operationalRegionId = input.operationalRegionId ?? null;
    let branchId = input.branchId ?? null;
    let mainheadId = input.mainheadId ?? null;

    if (input.assetId && (!assetTypeId || capabilityId === null)) {
      const asset = await this.prisma.asset.findFirst({
        where: {
          id: input.assetId,
          tenantId: user.tenantId,
        },
        select: {
          assetTypeId: true,
          assetType: {
            select: {
              capabilityId: true,
            },
          },
        },
      });

      if (!asset) {
        throw new NotFoundException('Asset not found.');
      }

      assetTypeId = assetTypeId ?? asset.assetTypeId;
      capabilityId = capabilityId ?? asset.assetType.capabilityId;
    }

    if (input.siteVisitId) {
      const siteVisit = await this.prisma.siteVisit.findFirst({
        where: {
          id: input.siteVisitId,
          tenantId: user.tenantId,
          ...this.siteVisitAccessScope(user),
        },
        select: {
          organizationId: true,
          branchId: true,
          mainheadId: true,
          mainheadRecord: {
            select: {
              operationalRegionId: true,
            },
          },
          team: {
            select: {
              organizationId: true,
              branchId: true,
              mainheadId: true,
            },
          },
          project: {
            select: {
              branchId: true,
              mainheadId: true,
              branch: {
                select: {
                  organizationId: true,
                },
              },
            },
          },
          workPackage: {
            select: {
              mainheadId: true,
              project: {
                select: {
                  branchId: true,
                  mainheadId: true,
                  branch: {
                    select: {
                      organizationId: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!siteVisit) {
        throw new NotFoundException('Site visit not found.');
      }

      // Assumption: the site visit row is the authoritative inspection context.
      // Project/work package scope is a fallback for older visits that predate
      // copied organization / branch / MAINHEAD fields.
      organizationId =
        organizationId ??
        siteVisit.organizationId ??
        siteVisit.project?.branch?.organizationId ??
        siteVisit.workPackage?.project.branch?.organizationId ??
        siteVisit.team.organizationId ??
        null;
      branchId =
        branchId ??
        siteVisit.branchId ??
        siteVisit.project?.branchId ??
        siteVisit.workPackage?.project.branchId ??
        siteVisit.team.branchId ??
        null;
      mainheadId =
        mainheadId ??
        siteVisit.mainheadId ??
        siteVisit.workPackage?.mainheadId ??
        siteVisit.project?.mainheadId ??
        siteVisit.workPackage?.project.mainheadId ??
        siteVisit.team.mainheadId ??
        null;
      operationalRegionId =
        operationalRegionId ?? siteVisit.mainheadRecord?.operationalRegionId ?? null;
    }

    if (input.operationalSessionId) {
      const operationalSession = await this.prisma.operationalSession.findFirst({
        where: {
          id: input.operationalSessionId,
          workspaceId: user.tenantId,
        },
        select: {
          organizationId: true,
          branchId: true,
          mainheadId: true,
        },
      });

      if (!operationalSession) {
        throw new NotFoundException('Operational session not found.');
      }

      organizationId = organizationId ?? operationalSession.organizationId;
      branchId = branchId ?? operationalSession.branchId;
      mainheadId = mainheadId ?? operationalSession.mainheadId;
    }

    if (!organizationId || !branchId || !mainheadId || !operationalRegionId) {
      const currentUser = await this.prisma.user.findFirst({
        where: {
          id: user.id,
          tenantId: user.tenantId,
          isActive: true,
        },
        select: {
          organizationId: true,
          branchId: true,
          mainheadId: true,
          operationalRegionAccesses: {
            select: {
              operationalRegionId: true,
            },
          },
        },
      });

      organizationId = organizationId ?? currentUser?.organizationId ?? null;
      branchId = branchId ?? currentUser?.branchId ?? null;
      mainheadId = mainheadId ?? currentUser?.mainheadId ?? null;
      operationalRegionId =
        operationalRegionId ??
        (currentUser?.operationalRegionAccesses.length === 1
          ? currentUser.operationalRegionAccesses[0].operationalRegionId
          : null);
    }

    if (mainheadId && (!branchId || !organizationId || !operationalRegionId)) {
      const mainhead = await this.prisma.mainhead.findUnique({
        where: {
          id: mainheadId,
        },
        select: {
          branchId: true,
          operationalRegionId: true,
          branch: {
            select: {
              organizationId: true,
            },
          },
        },
      });

      branchId = branchId ?? mainhead?.branchId ?? null;
      operationalRegionId =
        operationalRegionId ?? mainhead?.operationalRegionId ?? null;
      organizationId = organizationId ?? mainhead?.branch?.organizationId ?? null;
    }

    if (branchId && !organizationId) {
      const branch = await this.prisma.branch.findUnique({
        where: {
          id: branchId,
        },
        select: {
          organizationId: true,
        },
      });

      organizationId = branch?.organizationId ?? null;
    }

    return {
      assetTypeId,
      capabilityId,
      organizationId,
      operationalRegionId,
      branchId,
      mainheadId,
    };
  }

  private siteVisitAccessScope(user: RequestUser): Prisma.SiteVisitWhereInput {
    if (user.role === UserRole.ADMIN) {
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

  private findActiveTemplate(where: {
    tenantId: string;
    assetTypeId?: string;
    capabilityId?: string | null;
    scopeLevel: InspectionTemplateScopeLevel;
    organizationId?: string | null;
    operationalRegionId?: string | null;
    branchId?: string | null;
    mainheadId?: string | null;
  }) {
    return this.prisma.inspectionTemplate.findFirst({
      where: {
        tenantId: where.tenantId,
        ...(where.assetTypeId ? { assetTypeId: where.assetTypeId } : {}),
        ...(where.capabilityId !== undefined ? { capabilityId: where.capabilityId } : {}),
        scopeLevel: where.scopeLevel,
        ...(where.organizationId !== undefined ? { organizationId: where.organizationId } : {}),
        ...(where.operationalRegionId !== undefined
          ? { operationalRegionId: where.operationalRegionId }
          : {}),
        ...(where.branchId !== undefined ? { branchId: where.branchId } : {}),
        ...(where.mainheadId !== undefined ? { mainheadId: where.mainheadId } : {}),
        isActive: true,
        status: InspectionTemplateStatus.ACTIVE,
      },
      include: templateDetailInclude,
      orderBy: [
        {
          publishedAt: 'desc',
        },
        {
          updatedAt: 'desc',
        },
        {
          version: 'desc',
        },
      ],
    });
  }

  private async findAssetTypeCapabilityId(tenantId: string, assetTypeId: string) {
    const assetType = await this.prisma.assetType.findFirst({
      where: {
        id: assetTypeId,
        tenantId,
      },
      select: {
        capabilityId: true,
      },
    });

    return assetType?.capabilityId ?? null;
  }

  async listTemplates(user: RequestUser, query: ListTemplatesQueryDto) {
    const templates = await this.prisma.inspectionTemplate.findMany({
      where: {
        tenantId: user.tenantId,
        ...(query.assetTypeId ? { assetTypeId: query.assetTypeId } : {}),
        ...(query.capabilityId ? { capabilityId: query.capabilityId } : {}),
        ...(query.scopeLevel ? { scopeLevel: query.scopeLevel } : {}),
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.operationalRegionId
          ? { operationalRegionId: query.operationalRegionId }
          : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.mainheadId ? { mainheadId: query.mainheadId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: {
        assetType: {
          select: {
            id: true,
            code: true,
            name: true,
            capabilityId: true,
            capability: {
              select: {
                id: true,
                code: true,
                name: true,
                isActive: true,
              },
            },
          },
        },
        capability: {
          select: {
            id: true,
            code: true,
            name: true,
            isActive: true,
          },
        },
        organization: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
          },
        },
        operationalRegion: {
          select: {
            id: true,
            tenantId: true,
            code: true,
            name: true,
            state: true,
            isActive: true,
          },
        },
        branch: {
          select: {
            id: true,
            code: true,
            name: true,
            region: true,
            organizationId: true,
          },
        },
        mainhead: {
          select: {
            id: true,
            code: true,
            name: true,
            branchId: true,
          },
        },
        _count: {
          select: {
            sections: true,
            items: true,
            inspections: true,
          },
        },
      },
      orderBy: [
        {
          createdAt: 'desc',
        },
      ],
    });

    return templates
      .sort((left, right) => {
        const assetTypeNameComparison = left.assetType.name.localeCompare(right.assetType.name);

        if (assetTypeNameComparison !== 0) {
          return assetTypeNameComparison;
        }

        return right.version - left.version;
      })
      .map((template) => ({
        id: template.id,
        assetTypeId: template.assetTypeId,
        capabilityId: template.capabilityId,
        scopeLevel: template.scopeLevel,
        organizationId: template.organizationId,
        operationalRegionId: template.operationalRegionId,
        branchId: template.branchId,
        mainheadId: template.mainheadId,
        operationalDomain: template.operationalDomain,
        name: template.name,
        version: template.version,
        status: template.status,
        isActive: template.isActive,
        publishedAt: template.publishedAt,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
        assetType: template.assetType,
        capability: template.capability ?? template.assetType.capability,
        organization: template.organization,
        operationalRegion: template.operationalRegion,
        branch: template.branch,
        mainhead: template.mainhead,
        sectionCount: template._count.sections,
        itemCount: template._count.items,
        inspectionCount: template._count.inspections,
      }));
  }

  async listTemplatesForAssetType(user: RequestUser, assetTypeId: string) {
    await this.findAssetTypeOrThrow(this.prisma, user.tenantId, assetTypeId);

    return this.listTemplates(user, { assetTypeId });
  }

  async getTemplateDetail(user: RequestUser, templateId: string) {
    const template = await this.findTemplateDetailOrThrow(this.prisma, user.tenantId, templateId);

    return this.serializeTemplateDetail(template);
  }

  async createTemplate(user: RequestUser, dto: CreateTemplateDto) {
    const assetType = await this.findAssetTypeOrThrow(this.prisma, user.tenantId, dto.assetTypeId);
    const mapping = await this.resolveTemplateMapping(this.prisma, assetType, dto);

    const version = dto.version ?? (await this.getNextVersion(this.prisma, {
      assetTypeId: dto.assetTypeId,
      ...mapping,
    }));

    await this.ensureVersionAvailable(this.prisma, user.tenantId, {
      assetTypeId: dto.assetTypeId,
      ...mapping,
    }, version);

    try {
      const template = await this.prisma.inspectionTemplate.create({
        data: {
          tenantId: user.tenantId,
          assetTypeId: dto.assetTypeId,
          capabilityId: mapping.capabilityId,
          scopeLevel: mapping.scopeLevel,
          organizationId: mapping.organizationId,
          operationalRegionId: mapping.operationalRegionId,
          branchId: mapping.branchId,
          mainheadId: mapping.mainheadId,
          operationalDomain: mapping.operationalDomain,
          name: this.normalizeRequiredText(dto.name, 'Template name'),
          version,
          status: InspectionTemplateStatus.DRAFT,
          isActive: false,
        },
      });

      return this.getTemplateDetail(user, template.id);
    } catch (error) {
      this.rethrowKnownPrismaError(
        error,
        'A template with that version already exists for the selected asset type, capability, and scope.',
      );
      throw error;
    }
  }

  async addSection(user: RequestUser, templateId: string, dto: CreateTemplateSectionDto) {
    const template = await this.findEditableTemplateOrThrow(user.tenantId, templateId);
    const normalizedTitle = this.normalizeRequiredText(dto.title, 'Section title');

    await this.ensureUniqueSectionTitle(this.prisma, template.id, normalizedTitle);
    await this.ensureUniqueSectionSortOrder(this.prisma, template.id, dto.sortOrder);

    await this.prisma.inspectionTemplateSection.create({
      data: {
        templateId: template.id,
        title: normalizedTitle,
        description: this.normalizeOptionalText(dto.description),
        sortOrder: dto.sortOrder,
      },
    });

    return this.getTemplateDetail(user, template.id);
  }

  async updateSection(
    user: RequestUser,
    templateId: string,
    sectionId: string,
    dto: UpdateTemplateSectionDto,
  ) {
    const template = await this.findEditableTemplateOrThrow(user.tenantId, templateId);
    const section = await this.findSectionOrThrow(this.prisma, template.id, sectionId);
    const nextTitle =
      dto.title === undefined ? section.title : this.normalizeRequiredText(dto.title, 'Section title');
    const nextSortOrder = dto.sortOrder ?? section.sortOrder;

    await this.ensureUniqueSectionTitle(this.prisma, template.id, nextTitle, section.id);
    await this.ensureUniqueSectionSortOrder(this.prisma, template.id, nextSortOrder, section.id);

    await this.prisma.inspectionTemplateSection.update({
      where: { id: section.id },
      data: {
        title: nextTitle,
        description:
          dto.description === undefined
            ? section.description
            : this.normalizeOptionalText(dto.description),
        sortOrder: nextSortOrder,
      },
    });

    return this.getTemplateDetail(user, template.id);
  }

  async deleteSection(user: RequestUser, templateId: string, sectionId: string) {
    const template = await this.findEditableTemplateOrThrow(user.tenantId, templateId);
    const section = await this.findSectionOrThrow(this.prisma, template.id, sectionId);
    const sectionItemCount = await this.prisma.inspectionTemplateItem.count({
      where: {
        sectionId: section.id,
      },
    });

    if (sectionItemCount > 0) {
      throw new BadRequestException(
        'Sections with items cannot be deleted. Remove the items first while the template is still a draft.',
      );
    }

    await this.prisma.inspectionTemplateSection.delete({
      where: { id: section.id },
    });

    return this.getTemplateDetail(user, template.id);
  }

  async addItem(user: RequestUser, templateId: string, dto: CreateTemplateItemDto) {
    const template = await this.findEditableTemplateOrThrow(user.tenantId, templateId);
    const section = await this.findSectionOrThrow(this.prisma, template.id, dto.sectionId);
    const normalizedKey = this.normalizeItemKey(dto.key);
    const normalizedOptions = this.normalizeOptionsJson(dto.inputType, dto.optionsJson);

    await this.ensureUniqueItemKey(this.prisma, template.id, normalizedKey);
    await this.ensureUniqueItemSortOrder(this.prisma, section.id, dto.sortOrder);

    try {
      await this.prisma.inspectionTemplateItem.create({
        data: {
          templateId: template.id,
          sectionId: section.id,
          key: normalizedKey,
          label: this.normalizeRequiredText(dto.label, 'Item label'),
          helperText: this.normalizeOptionalText(dto.helperText),
          inputType: dto.inputType,
          isRequired: dto.isRequired,
          isDefectTrigger: dto.isDefectTrigger ?? true,
          severity: dto.severity ?? DefectSeverity.MEDIUM,
          sortOrder: dto.sortOrder,
          optionsJson:
            normalizedOptions === null
              ? Prisma.DbNull
              : (normalizedOptions as Prisma.InputJsonValue),
        },
      });
    } catch (error) {
      this.rethrowKnownPrismaError(
        error,
        'An item with that key already exists in the selected template.',
      );
      throw error;
    }

    return this.getTemplateDetail(user, template.id);
  }

  async updateItem(user: RequestUser, templateId: string, itemId: string, dto: UpdateTemplateItemDto) {
    const template = await this.findEditableTemplateOrThrow(user.tenantId, templateId);
    const item = await this.findItemOrThrow(this.prisma, template.id, itemId);
    const targetSectionId = dto.sectionId ?? item.sectionId;
    const targetSection =
      targetSectionId === item.sectionId
        ? { id: item.sectionId }
        : await this.findSectionOrThrow(this.prisma, template.id, targetSectionId);
    const nextInputType = dto.inputType ?? item.inputType;
    const nextKey = dto.key === undefined ? item.key : this.normalizeItemKey(dto.key);
    const nextSortOrder = dto.sortOrder ?? item.sortOrder;
    const nextSeverity = dto.severity ?? item.severity;
    const nextOptions = this.normalizeOptionsJson(
      nextInputType,
      dto.optionsJson === undefined ? item.optionsJson : dto.optionsJson,
    );

    await this.ensureUniqueItemKey(this.prisma, template.id, nextKey, item.id);
    await this.ensureUniqueItemSortOrder(this.prisma, targetSection.id, nextSortOrder, item.id);

    try {
      await this.prisma.inspectionTemplateItem.update({
        where: { id: item.id },
        data: {
          sectionId: targetSection.id,
          key: nextKey,
          label:
            dto.label === undefined ? item.label : this.normalizeRequiredText(dto.label, 'Item label'),
          helperText:
            dto.helperText === undefined
              ? item.helperText
              : this.normalizeOptionalText(dto.helperText),
          inputType: nextInputType,
          isRequired: dto.isRequired ?? item.isRequired,
          isDefectTrigger: dto.isDefectTrigger ?? item.isDefectTrigger,
          severity: nextSeverity,
          sortOrder: nextSortOrder,
          optionsJson:
            nextOptions === null ? Prisma.DbNull : (nextOptions as Prisma.InputJsonValue),
        },
      });
    } catch (error) {
      this.rethrowKnownPrismaError(
        error,
        'An item with that key already exists in the selected template.',
      );
      throw error;
    }

    return this.getTemplateDetail(user, template.id);
  }

  async deleteItem(user: RequestUser, templateId: string, itemId: string) {
    const template = await this.findEditableTemplateOrThrow(user.tenantId, templateId);
    const item = await this.findItemOrThrow(this.prisma, template.id, itemId);

    await this.prisma.inspectionTemplateItem.delete({
      where: { id: item.id },
    });

    return this.getTemplateDetail(user, template.id);
  }

  async cloneTemplate(user: RequestUser, templateId: string) {
    const sourceTemplate = await this.findTemplateDetailOrThrow(this.prisma, user.tenantId, templateId);

    try {
      const clonedTemplate = await this.prisma.$transaction(async (tx) => {
        const nextVersion = await this.getNextVersion(tx, sourceTemplate);
        const clonedTemplateRecord = await tx.inspectionTemplate.create({
          data: {
            tenantId: user.tenantId,
            assetTypeId: sourceTemplate.assetTypeId,
            capabilityId: sourceTemplate.capabilityId,
            scopeLevel: sourceTemplate.scopeLevel,
            organizationId: sourceTemplate.organizationId,
            operationalRegionId: sourceTemplate.operationalRegionId,
            branchId: sourceTemplate.branchId,
            mainheadId: sourceTemplate.mainheadId,
            operationalDomain: sourceTemplate.operationalDomain,
            name: sourceTemplate.name,
            version: nextVersion,
            status: InspectionTemplateStatus.DRAFT,
            isActive: false,
          },
        });

        for (const section of sourceTemplate.sections) {
          const clonedSection = await tx.inspectionTemplateSection.create({
            data: {
              templateId: clonedTemplateRecord.id,
              title: section.title,
              description: section.description,
              sortOrder: section.sortOrder,
            },
          });

          if (section.items.length > 0) {
            await tx.inspectionTemplateItem.createMany({
              data: section.items.map((item) => ({
                templateId: clonedTemplateRecord.id,
                sectionId: clonedSection.id,
                key: item.key,
                label: item.label,
                helperText: item.helperText,
                inputType: item.inputType,
                isRequired: item.isRequired,
                isActive: item.isActive,
                isDefectTrigger: item.isDefectTrigger,
                severity: item.severity,
                sortOrder: item.sortOrder,
                optionsJson:
                  item.optionsJson === null
                    ? Prisma.JsonNull
                    : (item.optionsJson as Prisma.InputJsonValue),
              })),
            });
          }
        }

        return clonedTemplateRecord;
      });

      return {
        clonedFromTemplateId: sourceTemplate.id,
        clonedTemplate: await this.getTemplateDetail(user, clonedTemplate.id),
      };
    } catch (error) {
      this.rethrowKnownPrismaError(
        error,
        'Unable to clone the template because the next version number is no longer available.',
      );
      throw error;
    }
  }

  async publishTemplate(user: RequestUser, templateId: string) {
    const draftTemplate = await this.findTemplateDetailOrThrow(this.prisma, user.tenantId, templateId);

    if (draftTemplate.status !== InspectionTemplateStatus.DRAFT) {
      throw new BadRequestException('Only draft templates can be published.');
    }

    this.validateTemplateStructureForPublish(draftTemplate);

    const publishedAt = new Date();

    const publishResult = await this.prisma.$transaction(async (tx) => {
      const activeTemplate = await tx.inspectionTemplate.findFirst({
        where: {
          tenantId: user.tenantId,
          assetTypeId: draftTemplate.assetTypeId,
          capabilityId: draftTemplate.capabilityId,
          scopeLevel: draftTemplate.scopeLevel,
          organizationId: draftTemplate.organizationId,
          operationalRegionId: draftTemplate.operationalRegionId,
          branchId: draftTemplate.branchId,
          mainheadId: draftTemplate.mainheadId,
          isActive: true,
          status: InspectionTemplateStatus.ACTIVE,
        },
        select: {
          id: true,
          name: true,
          version: true,
          status: true,
          isActive: true,
          publishedAt: true,
          scopeLevel: true,
          organizationId: true,
          operationalRegionId: true,
          branchId: true,
          mainheadId: true,
        },
      });

      if (activeTemplate) {
        await tx.inspectionTemplate.update({
          where: { id: activeTemplate.id },
          data: {
            status: InspectionTemplateStatus.ARCHIVED,
            isActive: false,
          },
        });
      }

      await tx.inspectionTemplate.update({
        where: { id: draftTemplate.id },
        data: {
          status: InspectionTemplateStatus.ACTIVE,
          isActive: true,
          publishedAt,
        },
      });

      return {
        archivedTemplate: activeTemplate
          ? {
              ...activeTemplate,
              status: InspectionTemplateStatus.ARCHIVED,
              isActive: false,
            }
          : null,
      };
    });

    return {
      publishedTemplate: await this.getTemplateDetail(user, draftTemplate.id),
      archivedTemplate: publishResult.archivedTemplate,
    };
  }

  private async findTemplateDetailOrThrow(
    client: PrismaClientLike,
    tenantId: string,
    templateId: string,
  ) {
    const template = await client.inspectionTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
      },
      include: templateDetailInclude,
    });

    if (!template) {
      throw new NotFoundException('Inspection template not found.');
    }

    return template;
  }

  private async findEditableTemplateOrThrow(tenantId: string, templateId: string) {
    const template = await this.prisma.inspectionTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Inspection template not found.');
    }

    if (template.status !== InspectionTemplateStatus.DRAFT) {
      if (template.status === InspectionTemplateStatus.ARCHIVED) {
        throw new BadRequestException('Archived templates are read-only and cannot be edited.');
      }

      throw new BadRequestException(
        'Active templates cannot be edited directly. Clone the template into a new draft first.',
      );
    }

    return template;
  }

  private async findAssetTypeOrThrow(client: PrismaClientLike, tenantId: string, assetTypeId: string) {
    const assetType = await client.assetType.findFirst({
      where: {
        id: assetTypeId,
        tenantId,
      },
      select: {
        id: true,
        code: true,
        name: true,
        capabilityId: true,
      },
    });

    if (!assetType) {
      throw new NotFoundException('Asset type not found.');
    }

    return assetType;
  }

  private async resolveTemplateMapping(
    client: PrismaClientLike,
    assetType: {
      id: string;
      capabilityId: string | null;
    },
    input: TemplateMappingInput,
    fallback?: {
      capabilityId: string | null;
      scopeLevel: InspectionTemplateScopeLevel;
      organizationId: string | null;
      operationalRegionId: string | null;
      branchId: string | null;
      mainheadId: string | null;
      operationalDomain: OperationalDomain | null;
    },
  ) {
    const capabilityId =
      input.capabilityId !== undefined
        ? input.capabilityId
        : fallback?.capabilityId ?? assetType.capabilityId ?? null;
    const operationalDomain =
      input.operationalDomain !== undefined
        ? input.operationalDomain
        : fallback?.operationalDomain ?? null;
    const scope = this.normalizeTemplateScope(input, fallback);

    await this.assertCapabilityExists(client, capabilityId);
    await this.assertTemplateScopeExists(client, scope);

    return {
      capabilityId,
      ...scope,
      operationalDomain,
    };
  }

  private async assertCapabilityExists(client: PrismaClientLike, capabilityId: string | null) {
    if (!capabilityId) {
      return;
    }

    const capability = await client.capability.findUnique({
      where: {
        id: capabilityId,
      },
      select: {
        id: true,
      },
    });

    if (!capability) {
      throw new NotFoundException('Capability not found.');
    }
  }

  private normalizeTemplateScope(
    input: TemplateMappingInput,
    fallback?: TemplateScopeFields,
  ): TemplateScopeFields {
    const scopeLevel =
      input.scopeLevel ??
      (input.mainheadId ? InspectionTemplateScopeLevel.MAINHEAD : null) ??
      (input.operationalRegionId
        ? InspectionTemplateScopeLevel.OPERATIONAL_REGION
        : null) ??
      (input.branchId ? InspectionTemplateScopeLevel.BRANCH : null) ??
      (input.organizationId ? InspectionTemplateScopeLevel.ORGANIZATION : null) ??
      fallback?.scopeLevel ??
      InspectionTemplateScopeLevel.GLOBAL;

    if (scopeLevel === InspectionTemplateScopeLevel.GLOBAL) {
      if (
        input.organizationId ||
        input.operationalRegionId ||
        input.branchId ||
        input.mainheadId
      ) {
        throw new BadRequestException(
          'GLOBAL templates cannot include organizationId, operationalRegionId, branchId, or mainheadId.',
        );
      }

      return {
        scopeLevel,
        organizationId: null,
        operationalRegionId: null,
        branchId: null,
        mainheadId: null,
      };
    }

    if (scopeLevel === InspectionTemplateScopeLevel.ORGANIZATION) {
      const organizationId =
        input.organizationId !== undefined
          ? input.organizationId
          : fallback?.organizationId ?? null;

      if (!organizationId) {
        throw new BadRequestException('ORGANIZATION scoped templates require organizationId.');
      }

      if (input.operationalRegionId || input.branchId || input.mainheadId) {
        throw new BadRequestException(
          'ORGANIZATION scoped templates cannot include operationalRegionId, branchId, or mainheadId.',
        );
      }

      return {
        scopeLevel,
        organizationId,
        operationalRegionId: null,
        branchId: null,
        mainheadId: null,
      };
    }

    if (scopeLevel === InspectionTemplateScopeLevel.OPERATIONAL_REGION) {
      const operationalRegionId =
        input.operationalRegionId !== undefined
          ? input.operationalRegionId
          : fallback?.operationalRegionId ?? null;

      if (!operationalRegionId) {
        throw new BadRequestException(
          'OPERATIONAL_REGION scoped templates require operationalRegionId.',
        );
      }

      if (input.organizationId || input.branchId || input.mainheadId) {
        throw new BadRequestException(
          'OPERATIONAL_REGION scoped templates cannot include organizationId, branchId, or mainheadId.',
        );
      }

      return {
        scopeLevel,
        organizationId: null,
        operationalRegionId,
        branchId: null,
        mainheadId: null,
      };
    }

    if (scopeLevel === InspectionTemplateScopeLevel.BRANCH) {
      const branchId =
        input.branchId !== undefined ? input.branchId : fallback?.branchId ?? null;

      if (!branchId) {
        throw new BadRequestException('BRANCH scoped templates require branchId.');
      }

      if (input.organizationId || input.operationalRegionId || input.mainheadId) {
        throw new BadRequestException(
          'BRANCH scoped templates cannot include organizationId, operationalRegionId, or mainheadId.',
        );
      }

      return {
        scopeLevel,
        organizationId: null,
        operationalRegionId: null,
        branchId,
        mainheadId: null,
      };
    }

    const mainheadId =
      input.mainheadId !== undefined ? input.mainheadId : fallback?.mainheadId ?? null;

    if (!mainheadId) {
      throw new BadRequestException('MAINHEAD scoped templates require mainheadId.');
    }

    if (input.organizationId || input.operationalRegionId || input.branchId) {
      throw new BadRequestException(
        'MAINHEAD scoped templates cannot include organizationId, operationalRegionId, or branchId.',
      );
    }

    return {
      scopeLevel,
      organizationId: null,
      operationalRegionId: null,
      branchId: null,
      mainheadId,
    };
  }

  private async assertTemplateScopeExists(
    client: PrismaClientLike,
    scope: TemplateScopeFields,
  ) {
    if (scope.scopeLevel === InspectionTemplateScopeLevel.ORGANIZATION) {
      const organization = await client.organization.findUnique({
        where: {
          id: scope.organizationId ?? '',
        },
        select: {
          id: true,
        },
      });

      if (!organization) {
        throw new NotFoundException('Organization not found.');
      }

      return;
    }

    if (scope.scopeLevel === InspectionTemplateScopeLevel.OPERATIONAL_REGION) {
      const operationalRegion = await client.operationalRegion.findUnique({
        where: {
          id: scope.operationalRegionId ?? '',
        },
        select: {
          id: true,
        },
      });

      if (!operationalRegion) {
        throw new NotFoundException('Operational region not found.');
      }

      return;
    }

    if (scope.scopeLevel === InspectionTemplateScopeLevel.BRANCH) {
      const branch = await client.branch.findUnique({
        where: {
          id: scope.branchId ?? '',
        },
        select: {
          id: true,
        },
      });

      if (!branch) {
        throw new NotFoundException('Branch not found.');
      }

      return;
    }

    if (scope.scopeLevel === InspectionTemplateScopeLevel.MAINHEAD) {
      const mainhead = await client.mainhead.findUnique({
        where: {
          id: scope.mainheadId ?? '',
        },
        select: {
          id: true,
        },
      });

      if (!mainhead) {
        throw new NotFoundException('MAINHEAD not found.');
      }
    }
  }

  private async findSectionOrThrow(
    client: PrismaClientLike,
    templateId: string,
    sectionId: string,
  ) {
    const section = await client.inspectionTemplateSection.findFirst({
      where: {
        id: sectionId,
        templateId,
      },
      select: {
        id: true,
        templateId: true,
        title: true,
        description: true,
        sortOrder: true,
      },
    });

    if (!section) {
      throw new NotFoundException('Template section not found.');
    }

    return section;
  }

  private async findItemOrThrow(client: PrismaClientLike, templateId: string, itemId: string) {
    const item = await client.inspectionTemplateItem.findFirst({
      where: {
        id: itemId,
        templateId,
      },
      select: {
        id: true,
        templateId: true,
        sectionId: true,
        key: true,
        label: true,
        helperText: true,
        inputType: true,
        isRequired: true,
        isActive: true,
        isDefectTrigger: true,
        severity: true,
        sortOrder: true,
        optionsJson: true,
      },
    });

    if (!item) {
      throw new NotFoundException('Template item not found.');
    }

    return item;
  }

  private async ensureVersionAvailable(
    client: PrismaClientLike,
    tenantId: string,
    scope: TemplateScopeFields & { assetTypeId: string; capabilityId: string | null },
    version: number,
  ) {
    const existingTemplate = await client.inspectionTemplate.findFirst({
      where: {
        tenantId,
        assetTypeId: scope.assetTypeId,
        capabilityId: scope.capabilityId,
        scopeLevel: scope.scopeLevel,
        organizationId: scope.organizationId,
        operationalRegionId: scope.operationalRegionId,
        branchId: scope.branchId,
        mainheadId: scope.mainheadId,
        version,
      },
      select: {
        id: true,
      },
    });

    if (existingTemplate) {
      throw new ConflictException(
        'A template with that version already exists for the selected asset type, capability, and scope.',
      );
    }
  }

  private async getNextVersion(
    client: PrismaClientLike,
    scope: TemplateScopeFields & { assetTypeId: string; capabilityId: string | null },
  ) {
    const latestTemplate = await client.inspectionTemplate.findFirst({
      where: {
        assetTypeId: scope.assetTypeId,
        capabilityId: scope.capabilityId,
        scopeLevel: scope.scopeLevel,
        organizationId: scope.organizationId,
        operationalRegionId: scope.operationalRegionId,
        branchId: scope.branchId,
        mainheadId: scope.mainheadId,
      },
      orderBy: {
        version: 'desc',
      },
      select: {
        version: true,
      },
    });

    return (latestTemplate?.version ?? 0) + 1;
  }

  private async ensureUniqueSectionTitle(
    client: PrismaClientLike,
    templateId: string,
    title: string,
    excludeSectionId?: string,
  ) {
    const sections = await client.inspectionTemplateSection.findMany({
      where: {
        templateId,
        ...(excludeSectionId ? { id: { not: excludeSectionId } } : {}),
      },
      select: {
        id: true,
        title: true,
      },
    });

    const normalizedTitle = title.trim().toLowerCase();
    const duplicateSection = sections.find(
      (section) => section.title.trim().toLowerCase() === normalizedTitle,
    );

    if (duplicateSection) {
      throw new ConflictException('Section titles must be unique within a template.');
    }
  }

  private async ensureUniqueSectionSortOrder(
    client: PrismaClientLike,
    templateId: string,
    sortOrder: number,
    excludeSectionId?: string,
  ) {
    const existingSection = await client.inspectionTemplateSection.findFirst({
      where: {
        templateId,
        sortOrder,
        ...(excludeSectionId ? { id: { not: excludeSectionId } } : {}),
      },
      select: {
        id: true,
      },
    });

    if (existingSection) {
      throw new ConflictException('Section sort order must be unique within a template.');
    }
  }

  private async ensureUniqueItemKey(
    client: PrismaClientLike,
    templateId: string,
    key: string,
    excludeItemId?: string,
  ) {
    const items = await client.inspectionTemplateItem.findMany({
      where: {
        templateId,
        ...(excludeItemId ? { id: { not: excludeItemId } } : {}),
      },
      select: {
        id: true,
        key: true,
      },
    });

    const normalizedKey = key.trim().toLowerCase();
    const duplicateItem = items.find((item) => item.key.trim().toLowerCase() === normalizedKey);

    if (duplicateItem) {
      throw new ConflictException('Item keys must be unique within a template.');
    }
  }

  private async ensureUniqueItemSortOrder(
    client: PrismaClientLike,
    sectionId: string,
    sortOrder: number,
    excludeItemId?: string,
  ) {
    const existingItem = await client.inspectionTemplateItem.findFirst({
      where: {
        sectionId,
        sortOrder,
        ...(excludeItemId ? { id: { not: excludeItemId } } : {}),
      },
      select: {
        id: true,
      },
    });

    if (existingItem) {
      throw new ConflictException('Item sort order must be unique within the same section.');
    }
  }

  private validateTemplateStructureForPublish(template: TemplateDetailRecord) {
    if (template.sections.length === 0) {
      throw new BadRequestException('Draft templates must contain at least one section before publishing.');
    }

    const normalizedSectionTitles = new Set<string>();
    const sectionSortOrders = new Set<number>();
    const normalizedItemKeys = new Set<string>();

    for (const section of template.sections) {
      const normalizedSectionTitle = section.title.trim().toLowerCase();

      if (normalizedSectionTitles.has(normalizedSectionTitle)) {
        throw new BadRequestException('Draft templates cannot be published with duplicate section titles.');
      }

      if (sectionSortOrders.has(section.sortOrder)) {
        throw new BadRequestException('Draft templates cannot be published with duplicate section sort order values.');
      }

      normalizedSectionTitles.add(normalizedSectionTitle);
      sectionSortOrders.add(section.sortOrder);

      if (section.items.length === 0) {
        throw new BadRequestException('Each section must contain at least one item before publishing.');
      }

      const itemSortOrders = new Set<number>();

      for (const item of section.items) {
        const normalizedItemKey = item.key.trim().toLowerCase();

        if (normalizedItemKeys.has(normalizedItemKey)) {
          throw new BadRequestException('Draft templates cannot be published with duplicate item keys.');
        }

        if (itemSortOrders.has(item.sortOrder)) {
          throw new BadRequestException(
            `Section "${section.title}" contains duplicate item sort order values.`,
          );
        }

        if (!isTemplateBuilderInputType(item.inputType)) {
          throw new BadRequestException(
            `Template item "${item.label}" uses an unsupported input type for this phase.`,
          );
        }

        this.normalizeOptionsJson(item.inputType, item.optionsJson);

        normalizedItemKeys.add(normalizedItemKey);
        itemSortOrders.add(item.sortOrder);
      }
    }

    if (normalizedItemKeys.size === 0) {
      throw new BadRequestException('Draft templates must contain at least one item before publishing.');
    }
  }

  private normalizeOptionsJson(
    inputType: InspectionItemInputType,
    optionsJson: unknown,
  ): Array<{ label: string; value: string }> | null {
    if (
      inputType !== InspectionItemInputType.SELECT &&
      inputType !== InspectionItemInputType.MULTI_SELECT
    ) {
      return null;
    }

    const normalizedOptions = normalizeTemplateSelectOptions(optionsJson);

    if (!normalizedOptions) {
      throw new BadRequestException(
        'SELECT and MULTI_SELECT items require a non-empty optionsJson array of unique string values or { label, value } objects.',
      );
    }

    return normalizedOptions;
  }

  private normalizeRequiredText(value: string, fieldName: string) {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new BadRequestException(`${fieldName} cannot be empty.`);
    }

    return normalizedValue;
  }

  private normalizeOptionalText(value: string | null | undefined) {
    if (value === undefined || value === null) {
      return null;
    }

    const normalizedValue = value.trim();

    return normalizedValue === '' ? null : normalizedValue;
  }

  private normalizeItemKey(key: string) {
    return this.normalizeRequiredText(key, 'Item key');
  }

  private serializeTemplateDetail(template: TemplateDetailRecord) {
    return {
      template: {
        id: template.id,
        tenantId: template.tenantId,
        assetTypeId: template.assetTypeId,
        capabilityId: template.capabilityId,
        scopeLevel: template.scopeLevel,
        organizationId: template.organizationId,
        operationalRegionId: template.operationalRegionId,
        branchId: template.branchId,
        mainheadId: template.mainheadId,
        operationalDomain: template.operationalDomain,
        name: template.name,
        version: template.version,
        status: template.status,
        isActive: template.isActive,
        publishedAt: template.publishedAt,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      },
      assetType: template.assetType,
      capability: template.capability ?? template.assetType.capability,
      organization: template.organization,
      operationalRegion: template.operationalRegion,
      branch: template.branch,
      mainhead: template.mainhead,
      sections: template.sections.map((section) => ({
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
          isActive: item.isActive,
          isDefectTrigger: item.isDefectTrigger,
          severity: item.severity,
          sortOrder: item.sortOrder,
          optionsJson: item.optionsJson,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
        createdAt: section.createdAt,
        updatedAt: section.updatedAt,
      })),
    };
  }

  private rethrowKnownPrismaError(error: unknown, message: string): never | void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException(message);
    }
  }
}

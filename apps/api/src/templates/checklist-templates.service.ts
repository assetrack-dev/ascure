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
import {
  ChecklistTemplateGroupInputDto,
  ChecklistTemplateItemInputDto,
  CreateChecklistTemplateDto,
  ResolveInspectionTemplateQueryDto,
  UpdateChecklistTemplateDto,
} from './dto/checklist-template.dto';
import {
  TemplateSelectOption,
  normalizeTemplateSelectOptions,
} from './template-builder.constants';

const checklistTemplateInclude = {
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
  _count: {
    select: {
      inspections: true,
    },
  },
} satisfies Prisma.InspectionTemplateInclude;

type ChecklistTemplateRecord = Prisma.InspectionTemplateGetPayload<{
  include: typeof checklistTemplateInclude;
}>;

type ChecklistTemplateItemRecord = ChecklistTemplateRecord['sections'][number]['items'][number];
type PrismaClientLike = Prisma.TransactionClient | PrismaService;
type ChecklistTemplateResolutionSource =
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

type ChecklistTemplateMappingInput = {
  assetType?: string;
  assetTypeId?: string;
  capabilityId?: string | null;
  scopeLevel?: InspectionTemplateScopeLevel | null;
  organizationId?: string | null;
  operationalRegionId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  operationalDomain?: OperationalDomain | null;
};

type TemplateResolutionContextInput = {
  assetType?: string;
  assetTypeId?: string;
  assetId?: string;
  capabilityId?: string | null;
  siteVisitId?: string;
  operationalSessionId?: string;
  organizationId?: string | null;
  operationalRegionId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
};

type DesiredChecklistItem = {
  id?: string;
  key?: string;
  label: string;
  helperText?: string | null;
  inputType: InspectionItemInputType;
  optionsJson: Prisma.InputJsonValue | null;
  sortOrder: number;
  isRequired: boolean;
  isActive: boolean;
  isDefectTrigger: boolean;
  severity: DefectSeverity;
  sectionId?: string;
  /** The named group (section title) this item should live under, when grouped. */
  groupTitle?: string;
};

type ChecklistShowIfConfig = {
  dependsOn: string;
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'greater_than'
    | 'less_than'
    | 'is_empty'
    | 'is_not_empty';
  value?: string | null;
};

type ChecklistImageConfig = {
  requiredPhoto: boolean;
  allowMultiplePhotos: boolean;
  cameraOnly: boolean;
  galleryAllowed: boolean;
  timestampOverlayRequired: boolean;
};

type ChecklistMeasurementConfig = {
  unit: string | null;
  source: 'manual' | 'photo_ocr_future';
  requiresImage: boolean;
};

type ChecklistItemV2Config = {
  version: 2;
  fieldType: string;
  options?: TemplateSelectOption[];
  /** MULTI_SELECT only — when true, the inspector may add a free-text "Other"
   *  answer beyond the configured options (v1: recorded as text, never a defect). */
  allowOther?: boolean;
  showIf?: ChecklistShowIfConfig;
  image?: ChecklistImageConfig;
  measurement?: ChecklistMeasurementConfig;
};

const CHECKLIST_ITEM_CONFIG_VERSION = 2;

/** Section title used when a template has no named groups (the legacy single bucket). */
const DEFAULT_SECTION_TITLE = 'Checklist Items';

@Injectable()
export class ChecklistTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestUser) {
    const templates = await this.prisma.inspectionTemplate.findMany({
      where: {
        tenantId: user.tenantId,
      },
      include: checklistTemplateInclude,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return templates
      .sort((left, right) => {
        const assetTypeComparison = left.assetType.name.localeCompare(right.assetType.name);

        if (assetTypeComparison !== 0) {
          return assetTypeComparison;
        }

        return right.version - left.version;
      })
      .map((template) => this.serialize(template));
  }

  async getActiveByAssetType(user: RequestUser, assetType: string) {
    return this.resolve(user, { assetType });
  }

  async resolve(user: RequestUser, query: ResolveInspectionTemplateQueryDto) {
    const resolution = await this.resolveActiveTemplate(user, query);

    return this.serialize(resolution.template, {
      onlyActiveItems: true,
      resolutionSource: resolution.source,
    });
  }

  async getById(user: RequestUser, templateId: string) {
    const template = await this.findTemplateOrThrow(this.prisma, user.tenantId, templateId);

    return this.serialize(template);
  }

  async create(user: RequestUser, dto: CreateChecklistTemplateDto) {
    const mapping = await this.resolveTemplateMapping(this.prisma, user.tenantId, dto);
    const items = this.normalizeIncomingItems([], dto.items);
    const templateWillBeActive = dto.isActive ?? true;

    this.ensureActiveItems(items, templateWillBeActive);

    const createdTemplate = await this.prisma.$transaction(async (tx) => {
      if (templateWillBeActive) {
        await this.deactivateActiveTemplates(tx, user.tenantId, mapping);
      }

      const version = await this.getNextVersion(tx, mapping);
      const template = await tx.inspectionTemplate.create({
        data: {
          tenantId: user.tenantId,
          assetTypeId: mapping.assetTypeId,
          capabilityId: mapping.capabilityId,
          scopeLevel: mapping.scopeLevel,
          organizationId: mapping.organizationId,
          operationalRegionId: mapping.operationalRegionId,
          branchId: mapping.branchId,
          mainheadId: mapping.mainheadId,
          operationalDomain: mapping.operationalDomain,
          version,
          name: this.normalizeRequiredText(dto.name, 'Template name'),
          status: templateWillBeActive
            ? InspectionTemplateStatus.ACTIVE
            : InspectionTemplateStatus.DRAFT,
          isActive: templateWillBeActive,
          publishedAt: templateWillBeActive ? new Date() : null,
        },
      });
      const groupTitles = this.orderedGroupTitles(dto.groups, items);
      const sectionMap = await this.ensureSections(tx, template.id, groupTitles, []);

      await tx.inspectionTemplateItem.createMany({
        data: this.buildCreateManyItems(template.id, items, (item) =>
          this.sectionIdForItem(item, sectionMap, groupTitles),
        ),
      });

      return template;
    });

    return this.findAndSerialize(user.tenantId, createdTemplate.id);
  }

  async update(user: RequestUser, templateId: string, dto: UpdateChecklistTemplateDto) {
    const template = await this.findTemplateOrThrow(this.prisma, user.tenantId, templateId);
    const hasStructureChanges =
      dto.name !== undefined ||
      dto.items !== undefined ||
      dto.assetType !== undefined ||
      dto.assetTypeId !== undefined ||
      dto.capabilityId !== undefined ||
      dto.scopeLevel !== undefined ||
      dto.organizationId !== undefined ||
      dto.branchId !== undefined ||
      dto.mainheadId !== undefined ||
      dto.operationalDomain !== undefined;

    if (hasStructureChanges && template.status !== InspectionTemplateStatus.DRAFT) {
      return this.createPatchedVersion(user, template, dto);
    }

    await this.updateInPlace(user, template, dto);

    return this.findAndSerialize(user.tenantId, template.id);
  }

  async activate(user: RequestUser, templateId: string) {
    const template = await this.findTemplateOrThrow(this.prisma, user.tenantId, templateId);
    const items = this.flattenItems(template).map((item) => this.fromExistingItem(item));

    this.ensureActiveItems(items, true);

    await this.prisma.$transaction(async (tx) => {
      await this.deactivateActiveTemplates(tx, user.tenantId, template, template.id);
      await tx.inspectionTemplate.update({
        where: {
          id: template.id,
        },
        data: {
          status: InspectionTemplateStatus.ACTIVE,
          isActive: true,
          publishedAt: template.publishedAt ?? new Date(),
        },
      });
    });

    return this.findAndSerialize(user.tenantId, template.id);
  }

  async archive(user: RequestUser, templateId: string) {
    const template = await this.findTemplateOrThrow(this.prisma, user.tenantId, templateId);

    await this.prisma.inspectionTemplate.update({
      where: {
        id: template.id,
      },
      data: {
        status: InspectionTemplateStatus.ARCHIVED,
        isActive: false,
      },
    });

    return this.findAndSerialize(user.tenantId, template.id);
  }

  private async resolveActiveTemplate(
    user: RequestUser,
    query: ResolveInspectionTemplateQueryDto,
  ): Promise<{
    template: ChecklistTemplateRecord;
    source: ChecklistTemplateResolutionSource;
  }> {
    const context = await this.resolveTemplateResolutionContext(user, query);
    const assetType = context.assetTypeId || query.assetType
      ? await this.findAssetTypeOrThrow(
          this.prisma,
          user.tenantId,
          context.assetTypeId ?? query.assetType ?? '',
        )
      : null;
    const capabilityId = context.capabilityId ?? assetType?.capabilityId ?? null;
    const baseWhere = {
      tenantId: user.tenantId,
      assetTypeId: assetType?.id,
      capabilityId,
    };

    if (assetType && context.mainheadId) {
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

    if (assetType && context.operationalRegionId) {
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

    if (assetType && context.branchId) {
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

    if (assetType && context.organizationId) {
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
      throw new NotFoundException('Active checklist template not found.');
    }

    return {
      template: fallbackTemplate,
      source: 'GLOBAL',
    };
  }

  private async resolveTemplateResolutionContext(
    user: RequestUser,
    input: TemplateResolutionContextInput,
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

      // Resolution prefers the explicit visit governance fields. Project and work
      // package links are used only as fallback because older visits may not have
      // copied branch / MAINHEAD ids onto the visit row yet.
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
      assetTypeId: assetTypeId ?? undefined,
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
      include: checklistTemplateInclude,
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

  async duplicate(user: RequestUser, templateId: string) {
    const sourceTemplate = await this.findTemplateOrThrow(this.prisma, user.tenantId, templateId);

    try {
      const duplicatedTemplate = await this.prisma.$transaction(async (tx) => {
        const nextVersion = await this.getNextVersion(tx, sourceTemplate);
        const duplicate = await tx.inspectionTemplate.create({
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
            version: nextVersion,
            name: this.buildDuplicateTemplateName(sourceTemplate),
            status: InspectionTemplateStatus.DRAFT,
            isActive: false,
            publishedAt: null,
          },
        });

        for (const section of sourceTemplate.sections) {
          const duplicatedSection = await tx.inspectionTemplateSection.create({
            data: {
              templateId: duplicate.id,
              title: section.title,
              description: section.description,
              sortOrder: section.sortOrder,
            },
          });

          if (section.items.length === 0) {
            continue;
          }

          await tx.inspectionTemplateItem.createMany({
            data: section.items.map((item) => ({
              templateId: duplicate.id,
              sectionId: duplicatedSection.id,
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
                  ? Prisma.DbNull
                  : (item.optionsJson as Prisma.InputJsonValue),
            })),
          });
        }

        return duplicate;
      });

      return this.findAndSerialize(user.tenantId, duplicatedTemplate.id);
    } catch (error) {
      this.rethrowKnownPrismaError(
        error,
        'Unable to duplicate the template because the next version number is no longer available.',
      );
      throw error;
    }
  }

  private async createPatchedVersion(
    user: RequestUser,
    template: ChecklistTemplateRecord,
    dto: UpdateChecklistTemplateDto,
  ) {
    const sectionTitleById = this.buildSectionTitleMap(template);
    const existingItems = this.flattenItems(template);
    const desiredItems =
      dto.items === undefined
        ? existingItems.map((item) => this.fromExistingItem(item, sectionTitleById))
        : this.normalizeIncomingItems(existingItems, dto.items, sectionTitleById);
    const mapping = await this.resolveTemplateMapping(this.prisma, user.tenantId, dto, template);
    const nextIsActive =
      dto.isActive ??
      (template._count.inspections > 0 ? false : template.isActive);

    this.ensureActiveItems(desiredItems, nextIsActive);

    const createdTemplate = await this.prisma.$transaction(async (tx) => {
      if (nextIsActive) {
        await this.deactivateActiveTemplates(tx, user.tenantId, mapping);
      } else if (template.isActive && dto.isActive === false) {
        await tx.inspectionTemplate.update({
          where: {
            id: template.id,
          },
          data: {
            status: InspectionTemplateStatus.ARCHIVED,
            isActive: false,
          },
        });
      }

      const nextTemplate = await tx.inspectionTemplate.create({
        data: {
          tenantId: user.tenantId,
          assetTypeId: mapping.assetTypeId,
          capabilityId: mapping.capabilityId,
          scopeLevel: mapping.scopeLevel,
          organizationId: mapping.organizationId,
          operationalRegionId: mapping.operationalRegionId,
          branchId: mapping.branchId,
          mainheadId: mapping.mainheadId,
          operationalDomain: mapping.operationalDomain,
          version: await this.getNextVersion(tx, mapping),
          name:
            dto.name === undefined
              ? template.name
              : this.normalizeRequiredText(dto.name, 'Template name'),
          status: nextIsActive ? InspectionTemplateStatus.ACTIVE : InspectionTemplateStatus.DRAFT,
          isActive: nextIsActive,
          publishedAt: nextIsActive ? new Date() : null,
        },
      });
      const groupTitles = this.orderedGroupTitles(dto.groups, desiredItems);
      const sectionMap = await this.ensureSections(tx, nextTemplate.id, groupTitles, []);

      await tx.inspectionTemplateItem.createMany({
        data: this.buildCreateManyItems(nextTemplate.id, desiredItems, (item) =>
          this.sectionIdForItem(item, sectionMap, groupTitles),
        ),
      });

      return nextTemplate;
    });

    return this.findAndSerialize(user.tenantId, createdTemplate.id);
  }

  private async updateInPlace(
    user: RequestUser,
    template: ChecklistTemplateRecord,
    dto: UpdateChecklistTemplateDto,
  ) {
    const sectionTitleById = this.buildSectionTitleMap(template);
    const existingItems = this.flattenItems(template);
    const desiredItems =
      dto.items === undefined
        ? null
        : this.normalizeIncomingItems(existingItems, dto.items, sectionTitleById, false);
    const mapping = await this.resolveTemplateMapping(this.prisma, user.tenantId, dto, template);
    const nextIsActive = dto.isActive ?? template.isActive;

    if (desiredItems) {
      this.ensureActiveItems(desiredItems, nextIsActive);
    } else if (nextIsActive) {
      this.ensureActiveItems(existingItems.map((item) => this.fromExistingItem(item)), true);
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.isActive === true) {
        await this.deactivateActiveTemplates(tx, user.tenantId, mapping, template.id);
      }

      const versionScopeChanged = this.templateVersionScopeChanged(template, mapping);

      await tx.inspectionTemplate.update({
        where: {
          id: template.id,
        },
        data: {
          assetTypeId: mapping.assetTypeId,
          capabilityId: mapping.capabilityId,
          scopeLevel: mapping.scopeLevel,
          organizationId: mapping.organizationId,
          operationalRegionId: mapping.operationalRegionId,
          branchId: mapping.branchId,
          mainheadId: mapping.mainheadId,
          operationalDomain: mapping.operationalDomain,
          ...(versionScopeChanged
            ? { version: await this.getNextVersion(tx, mapping) }
            : {}),
          ...(dto.name === undefined
            ? {}
            : { name: this.normalizeRequiredText(dto.name, 'Template name') }),
          ...(dto.isActive === undefined
            ? {}
            : {
                isActive: dto.isActive,
                status: dto.isActive
                  ? InspectionTemplateStatus.ACTIVE
                  : template.status === InspectionTemplateStatus.ACTIVE
                    ? InspectionTemplateStatus.ARCHIVED
                    : template.status,
                publishedAt: dto.isActive ? (template.publishedAt ?? new Date()) : template.publishedAt,
              }),
        },
      });

      if (desiredItems) {
        await this.saveItemsInPlace(tx, template, desiredItems, dto.groups);
      }
    });
  }

  private async saveItemsInPlace(
    tx: Prisma.TransactionClient,
    template: ChecklistTemplateRecord,
    desiredItems: DesiredChecklistItem[],
    groups: ChecklistTemplateGroupInputDto[] | undefined,
  ) {
    const existingItems = this.flattenItems(template);
    const existingById = new Map(existingItems.map((item) => [item.id, item]));
    const usedKeys = new Set(existingItems.map((item) => item.key));

    // Hard-delete items the payload dropped. saveItemsInPlace only runs for DRAFT
    // templates (non-draft item edits go through createPatchedVersion), so a
    // dropped item has no inspection results and is a real delete — not a
    // deactivate. Empty keep-list ⇒ every existing item was removed.
    const keepItemIds = desiredItems
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));
    await tx.inspectionTemplateItem.deleteMany({
      where: {
        templateId: template.id,
        ...(keepItemIds.length > 0 ? { id: { notIn: keepItemIds } } : {}),
      },
    });

    const groupTitles = this.orderedGroupTitles(groups, desiredItems);
    const sectionMap = await this.ensureSections(
      tx,
      template.id,
      groupTitles,
      template.sections,
    );

    for (const item of desiredItems) {
      const sectionId = this.sectionIdForItem(item, sectionMap, groupTitles);

      if (item.id && existingById.has(item.id)) {
        await tx.inspectionTemplateItem.update({
          where: {
            id: item.id,
          },
          data: {
            key: item.key ?? existingById.get(item.id)?.key,
            label: item.label,
            helperText: item.helperText ?? null,
            inputType: item.inputType,
            sectionId,
            optionsJson:
              item.optionsJson === null
                ? Prisma.DbNull
                : (item.optionsJson as Prisma.InputJsonValue),
            sortOrder: item.sortOrder,
            isRequired: item.isRequired,
            isActive: item.isActive,
            isDefectTrigger: item.isDefectTrigger,
            severity: item.severity,
          },
        });
        continue;
      }

      await tx.inspectionTemplateItem.create({
        data: {
          templateId: template.id,
          sectionId,
          key: this.buildUniqueItemKey(item.label, usedKeys),
          label: item.label,
          helperText: item.helperText ?? null,
          inputType: item.inputType,
          isRequired: item.isRequired,
          isActive: item.isActive,
          isDefectTrigger: item.isDefectTrigger,
          severity: item.severity,
          sortOrder: item.sortOrder,
          optionsJson:
            item.optionsJson === null
              ? Prisma.DbNull
              : (item.optionsJson as Prisma.InputJsonValue),
        },
      });
    }

    // Drop any now-empty groups left behind after items were re-grouped. Only
    // sections with zero items are removed, so cascade-delete can't touch items.
    await tx.inspectionTemplateSection.deleteMany({
      where: {
        templateId: template.id,
        id: { notIn: Array.from(new Set(sectionMap.values())) },
        items: { none: {} },
      },
    });
  }

  /** Map of sectionId → section title for the template's current groups. */
  private buildSectionTitleMap(template: ChecklistTemplateRecord) {
    return new Map(template.sections.map((section) => [section.id, section.title]));
  }

  /**
   * The ordered, de-duplicated list of group titles for a save. Explicit `groups`
   * (sorted) come first, then any group referenced only by an item, in first
   * appearance order. Falls back to the single default section when nothing is
   * grouped, so legacy/ungrouped payloads behave exactly as before.
   */
  private orderedGroupTitles(
    groups: ChecklistTemplateGroupInputDto[] | undefined,
    items: DesiredChecklistItem[],
  ): string[] {
    const titles: string[] = [];
    const seen = new Set<string>();
    const add = (raw: string | undefined) => {
      const title = raw?.trim();
      if (!title || seen.has(title)) {
        return;
      }
      seen.add(title);
      titles.push(title);
    };

    [...(groups ?? [])]
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
      .forEach((group) => add(group.title));
    items.forEach((item) => add(item.groupTitle));

    if (titles.length === 0) {
      titles.push(DEFAULT_SECTION_TITLE);
    }

    return titles;
  }

  /**
   * Ensure a section exists for each group title (reusing an existing section of
   * the same title, else creating one) and that their order matches `orderedTitles`.
   * Returns a title → sectionId map.
   */
  private async ensureSections(
    tx: Prisma.TransactionClient,
    templateId: string,
    orderedTitles: string[],
    existingSections: ChecklistTemplateRecord['sections'],
  ): Promise<Map<string, string>> {
    const existingByTitle = new Map(
      existingSections.map((section) => [section.title, section]),
    );
    const map = new Map<string, string>();

    for (let index = 0; index < orderedTitles.length; index += 1) {
      const title = orderedTitles[index];
      const sortOrder = index + 1;
      const existing = existingByTitle.get(title);

      if (existing) {
        if (existing.sortOrder !== sortOrder) {
          await tx.inspectionTemplateSection.update({
            where: { id: existing.id },
            data: { sortOrder },
          });
        }
        map.set(title, existing.id);
        continue;
      }

      const created = await tx.inspectionTemplateSection.create({
        data: { templateId, title, description: null, sortOrder },
        select: { id: true },
      });
      map.set(title, created.id);
    }

    return map;
  }

  /** Resolve which section an item belongs to (its group, or the first/default group). */
  private sectionIdForItem(
    item: DesiredChecklistItem,
    sectionMap: Map<string, string>,
    orderedTitles: string[],
  ): string {
    const title = item.groupTitle?.trim();
    const resolved = title ? sectionMap.get(title) : undefined;

    return resolved ?? sectionMap.get(orderedTitles[0])!;
  }

  /** Trim a per-item hint to null (blank → none). When the field is omitted
   *  entirely from the payload, keep whatever the item already had. */
  private normalizeHelperText(
    incoming: string | null | undefined,
    existing?: string | null,
  ): string | null {
    if (incoming === undefined) {
      return existing ?? null;
    }

    const trimmed = incoming?.trim();

    return trimmed ? trimmed : null;
  }

  private normalizeIncomingItems(
    existingItems: ChecklistTemplateItemRecord[],
    incomingItems: ChecklistTemplateItemInputDto[],
    sectionTitleById?: Map<string, string>,
    carryRemovedAsInactive = true,
  ): DesiredChecklistItem[] {
    const existingById = new Map(existingItems.map((item) => [item.id, item]));
    const referencedExistingIds = new Set<string>();
    const usedKeys = new Set<string>();
    const desiredItems: DesiredChecklistItem[] = incomingItems.map((item, index) => {
      const existingItem = item.id ? existingById.get(item.id) : undefined;
      const inputType = this.normalizeInputType(item.inputType ?? item.fieldType, existingItem?.inputType);
      const label = this.normalizeRequiredText(item.label, 'Item label');
      const key = this.normalizeIncomingItemKey(item.key, existingItem?.key, label, usedKeys);
      const groupTitle =
        item.groupTitle?.trim() ||
        (existingItem ? sectionTitleById?.get(existingItem.sectionId) : undefined);

      if (existingItem) {
        referencedExistingIds.add(existingItem.id);
      }

      return {
        id: existingItem?.id,
        key,
        sectionId: existingItem?.sectionId,
        groupTitle,
        label,
        helperText: this.normalizeHelperText(item.helperText, existingItem?.helperText),
        inputType,
        optionsJson: this.normalizeOptionsJson(inputType, item, existingItem),
        sortOrder: item.sortOrder ?? index + 1,
        isRequired: item.isRequired ?? existingItem?.isRequired ?? true,
        isActive: item.isActive ?? existingItem?.isActive ?? true,
        isDefectTrigger: item.isDefectTrigger ?? existingItem?.isDefectTrigger ?? true,
        severity: item.severity ?? existingItem?.severity ?? DefectSeverity.MEDIUM,
      };
    });

    // New-version saves (createPatchedVersion) carry items the payload no longer
    // references as INACTIVE so historical inspection results still resolve. The
    // in-place DRAFT path passes carryRemovedAsInactive=false — removed items are
    // hard-deleted by saveItemsInPlace (a draft has no results to preserve).
    if (carryRemovedAsInactive) {
      for (const item of existingItems) {
        if (referencedExistingIds.has(item.id)) {
          continue;
        }

        desiredItems.push({
          ...this.fromExistingItem(item, sectionTitleById),
          key: this.normalizeIncomingItemKey(undefined, item.key, item.label, usedKeys),
          isActive: false,
        });
      }
    }

    return desiredItems;
  }

  private fromExistingItem(
    item: ChecklistTemplateItemRecord,
    sectionTitleById?: Map<string, string>,
  ): DesiredChecklistItem {
    return {
      id: item.id,
      key: item.key,
      sectionId: item.sectionId,
      groupTitle: sectionTitleById?.get(item.sectionId),
      label: item.label,
      helperText: item.helperText,
      inputType: item.inputType,
      optionsJson: this.normalizeExistingOptionsJson(item.inputType, item.optionsJson),
      sortOrder: item.sortOrder,
      isRequired: item.isRequired,
      isActive: item.isActive,
      isDefectTrigger: item.isDefectTrigger,
      severity: item.severity,
    };
  }

  private buildCreateManyItems(
    templateId: string,
    items: DesiredChecklistItem[],
    resolveSectionId: (item: DesiredChecklistItem) => string,
  ) {
    const usedKeys = new Set<string>();

    return items.map((item) => ({
      templateId,
      sectionId: resolveSectionId(item),
      key: item.key && !usedKeys.has(item.key) ? this.reserveKey(item.key, usedKeys) : this.buildUniqueItemKey(item.label, usedKeys),
      label: item.label,
      helperText: item.helperText ?? null,
      inputType: item.inputType,
      isRequired: item.isRequired,
      isActive: item.isActive,
      isDefectTrigger: item.isDefectTrigger,
      severity: item.severity,
      sortOrder: item.sortOrder,
      optionsJson:
        item.optionsJson === null
          ? Prisma.DbNull
          : (item.optionsJson as Prisma.InputJsonValue),
    }));
  }

  private reserveKey(key: string, usedKeys: Set<string>) {
    usedKeys.add(key);

    return key;
  }

  private ensureActiveItems(items: DesiredChecklistItem[], templateWillBeActive: boolean) {
    if (!templateWillBeActive) {
      return;
    }

    const activeItemCount = items.filter((item) => item.isActive).length;

    if (activeItemCount === 0) {
      throw new BadRequestException('Active checklist templates must contain at least one active item.');
    }
  }

  private normalizeInputType(
    requestedInputType: string | undefined,
    fallbackInputType?: InspectionItemInputType,
  ): InspectionItemInputType {
    const normalizedInputType = (requestedInputType ?? fallbackInputType ?? InspectionItemInputType.BOOLEAN)
      .trim()
      .toUpperCase();

    if (normalizedInputType === 'YES_NO' || normalizedInputType === 'BOOLEAN') {
      return InspectionItemInputType.BOOLEAN;
    }

    if (normalizedInputType === 'DROPDOWN' || normalizedInputType === 'SELECT') {
      return InspectionItemInputType.SELECT;
    }

    if (normalizedInputType === 'MULTISELECT' || normalizedInputType === 'MULTI_SELECT') {
      return InspectionItemInputType.MULTI_SELECT;
    }

    if (normalizedInputType === 'DATE_TIME') {
      return InspectionItemInputType.DATETIME;
    }

    if (
      normalizedInputType === 'READING_MEASUREMENT' ||
      normalizedInputType === 'MEASUREMENT' ||
      normalizedInputType === 'READING'
    ) {
      return InspectionItemInputType.READING;
    }

    if (
      normalizedInputType === InspectionItemInputType.TEXT ||
      normalizedInputType === InspectionItemInputType.NUMBER ||
      normalizedInputType === InspectionItemInputType.DATE ||
      normalizedInputType === InspectionItemInputType.DATETIME ||
      normalizedInputType === InspectionItemInputType.IMAGE ||
      normalizedInputType === InspectionItemInputType.GPS ||
      normalizedInputType === InspectionItemInputType.READING ||
      normalizedInputType === InspectionItemInputType.OCR
    ) {
      return normalizedInputType as InspectionItemInputType;
    }

    throw new BadRequestException(`Unsupported checklist item field type: ${requestedInputType}.`);
  }

  private normalizeOptionsJson(
    inputType: InspectionItemInputType,
    item: ChecklistTemplateItemInputDto,
    existingItem?: ChecklistTemplateItemRecord,
  ): Prisma.InputJsonValue | null {
    const existingOptionsJson =
      existingItem?.inputType === inputType ? existingItem.optionsJson : null;
    const rawOptionsJson = item.optionsJson === undefined ? existingOptionsJson : item.optionsJson;
    const optionsSource = item.options ?? rawOptionsJson;
    const showIf = this.normalizeShowIfConfig(item.showIf, rawOptionsJson);
    const image = this.normalizeImageConfig(item.imageConfig, rawOptionsJson);
    const measurement = this.normalizeMeasurementConfig(item.measurementConfig, rawOptionsJson);
    const config: ChecklistItemV2Config = {
      version: CHECKLIST_ITEM_CONFIG_VERSION,
      fieldType: this.serializeFieldType(inputType),
    };

    if (
      inputType === InspectionItemInputType.SELECT ||
      inputType === InspectionItemInputType.MULTI_SELECT
    ) {
      const normalizedOptions = normalizeTemplateSelectOptions(optionsSource);

      if (!normalizedOptions) {
        throw new BadRequestException(
          'Dropdown and multi select items require a non-empty options array of unique { label, value } entries.',
        );
      }

      config.options = normalizedOptions;
    }

    // v1 "Other (free text)" — MULTI_SELECT only. Preserve an existing flag when
    // the payload omits it (e.g. a non-item edit / new version).
    if (inputType === InspectionItemInputType.MULTI_SELECT) {
      const allowOther =
        item.allowOther === undefined
          ? this.readChecklistConfig(rawOptionsJson)?.allowOther === true
          : item.allowOther === true;

      if (allowOther) {
        config.allowOther = true;
      }
    }

    if (inputType === InspectionItemInputType.IMAGE) {
      config.image = image;
    }

    if (inputType === InspectionItemInputType.READING) {
      // TODO(Mobile AI/OCR sprint): wire photo_ocr_future readings to the mobile OCR capture flow.
      config.measurement = measurement;
    }

    if (showIf) {
      config.showIf = showIf;
    }

    if (!config.options && !config.image && !config.measurement && !config.showIf) {
      return null;
    }

    return config as unknown as Prisma.InputJsonObject;
  }

  private normalizeExistingOptionsJson(
    inputType: InspectionItemInputType,
    optionsJson: Prisma.JsonValue | null,
  ): Prisma.InputJsonValue | null {
    if (optionsJson === null) {
      return null;
    }

    if (
      inputType !== InspectionItemInputType.SELECT &&
      inputType !== InspectionItemInputType.MULTI_SELECT &&
      !this.readChecklistConfig(optionsJson)
    ) {
      return null;
    }

    if (
      inputType === InspectionItemInputType.SELECT ||
      inputType === InspectionItemInputType.MULTI_SELECT
    ) {
      const normalizedOptions = normalizeTemplateSelectOptions(optionsJson);

      if (!normalizedOptions) {
        throw new BadRequestException(
          'Dropdown and multi select items require a non-empty options array of unique { label, value } entries.',
        );
      }

      const existingConfig = this.readChecklistConfig(optionsJson);

      if (existingConfig) {
        return {
          ...existingConfig,
          options: normalizedOptions,
        } as unknown as Prisma.InputJsonObject;
      }

      return normalizedOptions as unknown as Prisma.InputJsonArray;
    }

    return optionsJson as Prisma.InputJsonValue;
  }

  private normalizeIncomingItemKey(
    requestedKey: string | undefined,
    fallbackKey: string | undefined,
    label: string,
    usedKeys: Set<string>,
  ) {
    const keySource = requestedKey ?? fallbackKey;
    const baseKey = keySource
      ? this.normalizeItemKey(keySource)
      : this.buildItemKeyBase(label);

    if (usedKeys.has(baseKey)) {
      throw new BadRequestException(`Checklist item key "${baseKey}" is duplicated.`);
    }

    usedKeys.add(baseKey);

    return baseKey;
  }

  private normalizeItemKey(key: string) {
    const normalizedKey = key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^[_-]+|[_-]+$/g, '')
      .slice(0, 100);

    if (!normalizedKey) {
      throw new BadRequestException('Checklist item key cannot be empty.');
    }

    if (!/^[a-z0-9_][a-z0-9_-]*$/.test(normalizedKey)) {
      throw new BadRequestException(
        'Checklist item key must start with a letter, number, or underscore and use only letters, numbers, underscores, or hyphens.',
      );
    }

    return normalizedKey;
  }

  private buildItemKeyBase(label: string) {
    return (
      label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'checklist_item'
    );
  }

  private normalizeShowIfConfig(
    requestedShowIf: ChecklistTemplateItemInputDto['showIf'] | undefined,
    optionsJson: unknown,
  ): ChecklistShowIfConfig | undefined {
    const rawShowIf =
      requestedShowIf === undefined
        ? this.readChecklistConfig(optionsJson)?.showIf
        : requestedShowIf;

    if (!rawShowIf || typeof rawShowIf !== 'object' || Array.isArray(rawShowIf)) {
      return undefined;
    }

    const dependsOn =
      'dependsOn' in rawShowIf && typeof rawShowIf.dependsOn === 'string'
        ? rawShowIf.dependsOn.trim()
        : '';
    const operator =
      'operator' in rawShowIf && typeof rawShowIf.operator === 'string'
        ? rawShowIf.operator
        : '';

    if (!dependsOn || !this.isShowIfOperator(operator)) {
      return undefined;
    }

    const rawValue = 'value' in rawShowIf ? rawShowIf.value : undefined;
    const value = typeof rawValue === 'string' ? rawValue.trim() : null;

    if (operator === 'is_empty' || operator === 'is_not_empty') {
      return {
        dependsOn,
        operator,
        value: null,
      };
    }

    return {
      dependsOn,
      operator,
      value,
    };
  }

  private normalizeImageConfig(
    requestedConfig: ChecklistTemplateItemInputDto['imageConfig'] | undefined,
    optionsJson: unknown,
  ): ChecklistImageConfig {
    const rawConfig =
      requestedConfig === undefined
        ? this.readChecklistConfig(optionsJson)?.image
        : requestedConfig;

    return {
      requiredPhoto: this.readBoolean(rawConfig, 'requiredPhoto'),
      allowMultiplePhotos: this.readBoolean(rawConfig, 'allowMultiplePhotos'),
      cameraOnly: this.readBoolean(rawConfig, 'cameraOnly'),
      galleryAllowed: this.readBoolean(rawConfig, 'galleryAllowed'),
      timestampOverlayRequired: this.readBoolean(rawConfig, 'timestampOverlayRequired'),
    };
  }

  private normalizeMeasurementConfig(
    requestedConfig: ChecklistTemplateItemInputDto['measurementConfig'] | undefined,
    optionsJson: unknown,
  ): ChecklistMeasurementConfig {
    const rawConfig =
      requestedConfig === undefined
        ? this.readChecklistConfig(optionsJson)?.measurement
        : requestedConfig;
    const unit =
      rawConfig &&
      typeof rawConfig === 'object' &&
      !Array.isArray(rawConfig) &&
      'unit' in rawConfig &&
      typeof rawConfig.unit === 'string'
        ? rawConfig.unit.trim()
        : '';
    const source =
      rawConfig &&
      typeof rawConfig === 'object' &&
      !Array.isArray(rawConfig) &&
      'source' in rawConfig &&
      rawConfig.source === 'photo_ocr_future'
        ? 'photo_ocr_future'
        : 'manual';

    return {
      unit: unit || null,
      source,
      requiresImage: this.readBoolean(rawConfig, 'requiresImage'),
    };
  }

  private readChecklistConfig(optionsJson: unknown): Partial<ChecklistItemV2Config> | null {
    if (!optionsJson || typeof optionsJson !== 'object' || Array.isArray(optionsJson)) {
      return null;
    }

    const version = 'version' in optionsJson ? optionsJson.version : undefined;

    if (version !== CHECKLIST_ITEM_CONFIG_VERSION) {
      return null;
    }

    return optionsJson as Partial<ChecklistItemV2Config>;
  }

  private isShowIfOperator(value: string): value is ChecklistShowIfConfig['operator'] {
    return [
      'equals',
      'not_equals',
      'contains',
      'greater_than',
      'less_than',
      'is_empty',
      'is_not_empty',
    ].includes(value);
  }

  private readBoolean(source: unknown, key: string) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return false;
    }

    return (source as Record<string, unknown>)[key] === true;
  }

  private buildUniqueItemKey(label: string, usedKeys: Set<string>) {
    const baseKey = this.buildItemKeyBase(label);
    let key = baseKey;
    let suffix = 2;

    while (usedKeys.has(key)) {
      key = `${baseKey}_${suffix}`;
      suffix += 1;
    }

    usedKeys.add(key);

    return key;
  }

  private async deactivateActiveTemplates(
    tx: Prisma.TransactionClient,
    tenantId: string,
    scope: TemplateScopeFields & { assetTypeId: string; capabilityId: string | null },
    excludeTemplateId?: string,
  ) {
    await tx.inspectionTemplate.updateMany({
      where: {
        tenantId,
        assetTypeId: scope.assetTypeId,
        capabilityId: scope.capabilityId,
        scopeLevel: scope.scopeLevel,
        organizationId: scope.organizationId,
        operationalRegionId: scope.operationalRegionId,
        branchId: scope.branchId,
        mainheadId: scope.mainheadId,
        isActive: true,
        status: InspectionTemplateStatus.ACTIVE,
        ...(excludeTemplateId ? { id: { not: excludeTemplateId } } : {}),
      },
      data: {
        status: InspectionTemplateStatus.ARCHIVED,
        isActive: false,
      },
    });
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

  private templateVersionScopeChanged(
    template: TemplateScopeFields & { assetTypeId: string; capabilityId: string | null },
    nextScope: TemplateScopeFields & { assetTypeId: string; capabilityId: string | null },
  ) {
    return (
      template.assetTypeId !== nextScope.assetTypeId ||
      template.capabilityId !== nextScope.capabilityId ||
      template.scopeLevel !== nextScope.scopeLevel ||
      template.organizationId !== nextScope.organizationId ||
      template.operationalRegionId !== nextScope.operationalRegionId ||
      template.branchId !== nextScope.branchId ||
      template.mainheadId !== nextScope.mainheadId
    );
  }

  private buildDuplicateTemplateName(template: ChecklistTemplateRecord) {
    const baseName = template.name.trim();
    const versionPattern = new RegExp(`\\bv\\s*${template.version}\\b`, 'i');
    const suffix = versionPattern.test(baseName) ? ' Copy' : ` V${template.version} Copy`;

    return `${baseName.slice(0, 255 - suffix.length)}${suffix}`;
  }

  private async findTemplateOrThrow(
    client: PrismaClientLike,
    tenantId: string,
    templateId: string,
  ) {
    const template = await client.inspectionTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
      },
      include: checklistTemplateInclude,
    });

    if (!template) {
      throw new NotFoundException('Checklist template not found.');
    }

    return template;
  }

  private async findAndSerialize(tenantId: string, templateId: string) {
    const template = await this.findTemplateOrThrow(this.prisma, tenantId, templateId);

    return this.serialize(template);
  }

  private async findAssetTypeOrThrow(
    client: PrismaClientLike,
    tenantId: string,
    assetType: string,
  ) {
    const normalizedAssetType = this.normalizeRequiredText(assetType, 'Asset type');
    const assetTypeRecord = await client.assetType.findFirst({
      where: {
        tenantId,
        OR: [
          ...(this.isUuid(normalizedAssetType) ? [{ id: normalizedAssetType }] : []),
          {
            code: {
              equals: normalizedAssetType,
              mode: 'insensitive',
            },
          },
          {
            name: {
              equals: normalizedAssetType,
              mode: 'insensitive',
            },
          },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        capabilityId: true,
      },
    });

    if (!assetTypeRecord) {
      throw new NotFoundException('Asset type not found.');
    }

    return assetTypeRecord;
  }

  private async resolveTemplateMapping(
    client: PrismaClientLike,
    tenantId: string,
    input: ChecklistTemplateMappingInput,
    fallback?: ChecklistTemplateRecord,
  ) {
    const requestedAssetType = input.assetTypeId ?? input.assetType;
    const assetType =
      requestedAssetType !== undefined
        ? await this.findAssetTypeOrThrow(client, tenantId, requestedAssetType)
        : fallback
          ? {
              id: fallback.assetTypeId,
              code: fallback.assetType.code,
              name: fallback.assetType.name,
              capabilityId: fallback.assetType.capabilityId,
            }
          : null;

    if (!assetType) {
      throw new BadRequestException('Asset type is required for checklist templates.');
    }

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
      assetTypeId: assetType.id,
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
    input: ChecklistTemplateMappingInput,
    fallback?: ChecklistTemplateRecord,
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

  private flattenItems(template: ChecklistTemplateRecord) {
    return template.sections
      .flatMap((section) => section.items)
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  private serialize(
    template: ChecklistTemplateRecord,
    options: {
      onlyActiveItems?: boolean;
      resolutionSource?: ChecklistTemplateResolutionSource;
    } = {},
  ) {
    const items = this.flattenItems(template).filter((item) => !options.onlyActiveItems || item.isActive);
    const capability = template.capability ?? template.assetType.capability ?? null;
    const sectionTitleById = this.buildSectionTitleMap(template);

    return {
      id: template.id,
      assetType: template.assetType.code,
      assetTypeId: template.assetTypeId,
      assetTypeCode: template.assetType.code,
      assetTypeName: template.assetType.name,
      capabilityId: capability?.id ?? template.capabilityId ?? template.assetType.capabilityId,
      capability,
      scopeLevel: template.scopeLevel,
      organizationId: template.organizationId,
      organization: template.organization,
      operationalRegionId: template.operationalRegionId,
      operationalRegion: template.operationalRegion,
      branchId: template.branchId,
      branch: template.branch,
      mainheadId: template.mainheadId,
      mainhead: template.mainhead,
      operationalDomain: template.operationalDomain,
      name: template.name,
      version: template.version,
      status: template.status,
      isActive: template.isActive,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      itemCount: items.filter((item) => item.isActive).length,
      inspectionCount: template._count.inspections,
      resolutionSource: options.resolutionSource,
      groups: [...template.sections]
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((section) => ({
          id: section.id,
          title: section.title,
          description: section.description,
          sortOrder: section.sortOrder,
        })),
      items: items.map((item) => {
        const config = this.readChecklistConfig(item.optionsJson);

        return {
          id: item.id,
          templateId: item.templateId,
          sectionId: item.sectionId,
          groupTitle: sectionTitleById.get(item.sectionId) ?? null,
          key: item.key,
          label: item.label,
          helperText: item.helperText,
          fieldType: this.serializeFieldType(item.inputType),
          inputType: item.inputType,
          options: this.serializeOptions(item.inputType, item.optionsJson),
          optionsJson: item.optionsJson,
          config,
          showIf: config?.showIf ?? null,
          imageConfig: config?.image ?? null,
          measurementConfig: config?.measurement ?? null,
          sortOrder: item.sortOrder,
          isRequired: item.isRequired,
          isActive: item.isActive,
          isDefectTrigger: item.isDefectTrigger,
          severity: item.severity,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
    };
  }

  private serializeFieldType(inputType: InspectionItemInputType) {
    if (inputType === InspectionItemInputType.BOOLEAN) {
      return 'YES_NO';
    }

    if (inputType === InspectionItemInputType.SELECT) {
      return 'DROPDOWN';
    }

    return inputType;
  }

  private serializeOptions(inputType: InspectionItemInputType, optionsJson: Prisma.JsonValue | null) {
    if (
      inputType !== InspectionItemInputType.SELECT &&
      inputType !== InspectionItemInputType.MULTI_SELECT
    ) {
      return [];
    }

    return normalizeTemplateSelectOptions(optionsJson) ?? [];
  }

  private normalizeRequiredText(value: string, fieldName: string) {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new BadRequestException(`${fieldName} cannot be empty.`);
    }

    return normalizedValue;
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private rethrowKnownPrismaError(error: unknown, message: string): never | void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException(message);
    }
  }
}

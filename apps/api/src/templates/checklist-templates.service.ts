import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InspectionItemInputType,
  InspectionTemplateStatus,
  Prisma,
} from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChecklistTemplateItemInputDto,
  CreateChecklistTemplateDto,
  UpdateChecklistTemplateDto,
} from './dto/checklist-template.dto';
import { normalizeTemplateSelectOptions } from './template-builder.constants';

const checklistTemplateInclude = {
  assetType: {
    select: {
      id: true,
      code: true,
      name: true,
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

type DesiredChecklistItem = {
  id?: string;
  key?: string;
  label: string;
  inputType: InspectionItemInputType;
  optionsJson: Array<{ label: string; value: string }> | null;
  sortOrder: number;
  isRequired: boolean;
  isActive: boolean;
  isDefectTrigger: boolean;
  sectionId?: string;
};

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
    const assetTypeRecord = await this.findAssetTypeOrThrow(this.prisma, user.tenantId, assetType);
    const template = await this.prisma.inspectionTemplate.findFirst({
      where: {
        tenantId: user.tenantId,
        assetTypeId: assetTypeRecord.id,
        isActive: true,
        status: InspectionTemplateStatus.ACTIVE,
      },
      include: checklistTemplateInclude,
      orderBy: {
        version: 'desc',
      },
    });

    if (!template) {
      throw new NotFoundException('Active checklist template not found for the selected asset type.');
    }

    return this.serialize(template, { onlyActiveItems: true });
  }

  async getById(user: RequestUser, templateId: string) {
    const template = await this.findTemplateOrThrow(this.prisma, user.tenantId, templateId);

    return this.serialize(template);
  }

  async create(user: RequestUser, dto: CreateChecklistTemplateDto) {
    const assetType = await this.findAssetTypeOrThrow(this.prisma, user.tenantId, dto.assetType);
    const items = this.normalizeIncomingItems([], dto.items);
    const templateWillBeActive = dto.isActive ?? true;

    this.ensureActiveItems(items, templateWillBeActive);

    const createdTemplate = await this.prisma.$transaction(async (tx) => {
      if (templateWillBeActive) {
        await this.deactivateActiveTemplates(tx, user.tenantId, assetType.id);
      }

      const version = await this.getNextVersion(tx, assetType.id);
      const template = await tx.inspectionTemplate.create({
        data: {
          tenantId: user.tenantId,
          assetTypeId: assetType.id,
          version,
          name: this.normalizeRequiredText(dto.name, 'Template name'),
          status: templateWillBeActive
            ? InspectionTemplateStatus.ACTIVE
            : InspectionTemplateStatus.DRAFT,
          isActive: templateWillBeActive,
          publishedAt: templateWillBeActive ? new Date() : null,
        },
      });
      const section = await tx.inspectionTemplateSection.create({
        data: {
          templateId: template.id,
          title: 'Checklist Items',
          description: null,
          sortOrder: 1,
        },
      });

      await tx.inspectionTemplateItem.createMany({
        data: this.buildCreateManyItems(template.id, section.id, items),
      });

      return template;
    });

    return this.findAndSerialize(user.tenantId, createdTemplate.id);
  }

  async update(user: RequestUser, templateId: string, dto: UpdateChecklistTemplateDto) {
    const template = await this.findTemplateOrThrow(this.prisma, user.tenantId, templateId);
    const hasStructureChanges = dto.name !== undefined || dto.items !== undefined;

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
      await this.deactivateActiveTemplates(tx, user.tenantId, template.assetTypeId, template.id);
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

  private async createPatchedVersion(
    user: RequestUser,
    template: ChecklistTemplateRecord,
    dto: UpdateChecklistTemplateDto,
  ) {
    const existingItems = this.flattenItems(template);
    const desiredItems =
      dto.items === undefined
        ? existingItems.map((item) => this.fromExistingItem(item))
        : this.normalizeIncomingItems(existingItems, dto.items);
    const nextIsActive =
      dto.isActive ??
      (template._count.inspections > 0 ? false : template.isActive);

    this.ensureActiveItems(desiredItems, nextIsActive);

    const createdTemplate = await this.prisma.$transaction(async (tx) => {
      if (nextIsActive) {
        await this.deactivateActiveTemplates(tx, user.tenantId, template.assetTypeId);
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
          assetTypeId: template.assetTypeId,
          version: await this.getNextVersion(tx, template.assetTypeId),
          name:
            dto.name === undefined
              ? template.name
              : this.normalizeRequiredText(dto.name, 'Template name'),
          status: nextIsActive ? InspectionTemplateStatus.ACTIVE : InspectionTemplateStatus.DRAFT,
          isActive: nextIsActive,
          publishedAt: nextIsActive ? new Date() : null,
        },
      });
      const section = await tx.inspectionTemplateSection.create({
        data: {
          templateId: nextTemplate.id,
          title: 'Checklist Items',
          description: null,
          sortOrder: 1,
        },
      });

      await tx.inspectionTemplateItem.createMany({
        data: this.buildCreateManyItems(nextTemplate.id, section.id, desiredItems),
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
    const existingItems = this.flattenItems(template);
    const desiredItems =
      dto.items === undefined ? null : this.normalizeIncomingItems(existingItems, dto.items);
    const nextIsActive = dto.isActive ?? template.isActive;

    if (desiredItems) {
      this.ensureActiveItems(desiredItems, nextIsActive);
    } else if (nextIsActive) {
      this.ensureActiveItems(existingItems.map((item) => this.fromExistingItem(item)), true);
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.isActive === true) {
        await this.deactivateActiveTemplates(tx, user.tenantId, template.assetTypeId, template.id);
      }

      await tx.inspectionTemplate.update({
        where: {
          id: template.id,
        },
        data: {
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
        await this.saveItemsInPlace(tx, template, desiredItems);
      }
    });
  }

  private async saveItemsInPlace(
    tx: Prisma.TransactionClient,
    template: ChecklistTemplateRecord,
    desiredItems: DesiredChecklistItem[],
  ) {
    const existingItems = this.flattenItems(template);
    const existingById = new Map(existingItems.map((item) => [item.id, item]));
    const defaultSection = await this.findOrCreateChecklistSection(tx, template);
    const usedKeys = new Set(existingItems.map((item) => item.key));

    for (const item of desiredItems) {
      if (item.id && existingById.has(item.id)) {
        await tx.inspectionTemplateItem.update({
          where: {
            id: item.id,
          },
          data: {
            label: item.label,
            inputType: item.inputType,
            optionsJson:
              item.optionsJson === null
                ? Prisma.DbNull
                : (item.optionsJson as Prisma.InputJsonValue),
            sortOrder: item.sortOrder,
            isRequired: item.isRequired,
            isActive: item.isActive,
            isDefectTrigger: item.isDefectTrigger,
          },
        });
        continue;
      }

      await tx.inspectionTemplateItem.create({
        data: {
          templateId: template.id,
          sectionId: defaultSection.id,
          key: this.buildUniqueItemKey(item.label, usedKeys),
          label: item.label,
          helperText: null,
          inputType: item.inputType,
          isRequired: item.isRequired,
          isActive: item.isActive,
          isDefectTrigger: item.isDefectTrigger,
          sortOrder: item.sortOrder,
          optionsJson:
            item.optionsJson === null
              ? Prisma.DbNull
              : (item.optionsJson as Prisma.InputJsonValue),
        },
      });
    }
  }

  private async findOrCreateChecklistSection(
    tx: Prisma.TransactionClient,
    template: ChecklistTemplateRecord,
  ) {
    const existingSection = template.sections[0];

    if (existingSection) {
      return existingSection;
    }

    return tx.inspectionTemplateSection.create({
      data: {
        templateId: template.id,
        title: 'Checklist Items',
        description: null,
        sortOrder: 1,
      },
      select: {
        id: true,
      },
    });
  }

  private normalizeIncomingItems(
    existingItems: ChecklistTemplateItemRecord[],
    incomingItems: ChecklistTemplateItemInputDto[],
  ): DesiredChecklistItem[] {
    const existingById = new Map(existingItems.map((item) => [item.id, item]));
    const referencedExistingIds = new Set<string>();
    const desiredItems: DesiredChecklistItem[] = incomingItems.map((item, index) => {
      const existingItem = item.id ? existingById.get(item.id) : undefined;

      if (existingItem) {
        referencedExistingIds.add(existingItem.id);
      }

      return {
        id: existingItem?.id,
        key: existingItem?.key,
        sectionId: existingItem?.sectionId,
        label: this.normalizeRequiredText(item.label, 'Item label'),
        inputType: this.normalizeInputType(item.inputType ?? item.fieldType, existingItem?.inputType),
        optionsJson: this.normalizeOptionsJson(
          this.normalizeInputType(item.inputType ?? item.fieldType, existingItem?.inputType),
          item.options ?? item.optionsJson ?? existingItem?.optionsJson ?? null,
        ),
        sortOrder: item.sortOrder ?? index + 1,
        isRequired: item.isRequired ?? existingItem?.isRequired ?? true,
        isActive: item.isActive ?? existingItem?.isActive ?? true,
        isDefectTrigger: item.isDefectTrigger ?? existingItem?.isDefectTrigger ?? true,
      };
    });

    for (const item of existingItems) {
      if (referencedExistingIds.has(item.id)) {
        continue;
      }

      desiredItems.push({
        ...this.fromExistingItem(item),
        isActive: false,
      });
    }

    return desiredItems;
  }

  private fromExistingItem(item: ChecklistTemplateItemRecord): DesiredChecklistItem {
    return {
      id: item.id,
      key: item.key,
      sectionId: item.sectionId,
      label: item.label,
      inputType: item.inputType,
      optionsJson: this.normalizeOptionsJson(item.inputType, item.optionsJson),
      sortOrder: item.sortOrder,
      isRequired: item.isRequired,
      isActive: item.isActive,
      isDefectTrigger: item.isDefectTrigger,
    };
  }

  private buildCreateManyItems(
    templateId: string,
    sectionId: string,
    items: DesiredChecklistItem[],
  ) {
    const usedKeys = new Set<string>();

    return items.map((item) => ({
      templateId,
      sectionId,
      key: item.key && !usedKeys.has(item.key) ? this.reserveKey(item.key, usedKeys) : this.buildUniqueItemKey(item.label, usedKeys),
      label: item.label,
      helperText: null,
      inputType: item.inputType,
      isRequired: item.isRequired,
      isActive: item.isActive,
      isDefectTrigger: item.isDefectTrigger,
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

    if (
      normalizedInputType === InspectionItemInputType.TEXT ||
      normalizedInputType === InspectionItemInputType.NUMBER ||
      normalizedInputType === InspectionItemInputType.DATE ||
      normalizedInputType === InspectionItemInputType.DATETIME
    ) {
      return normalizedInputType as InspectionItemInputType;
    }

    throw new BadRequestException(`Unsupported checklist item field type: ${requestedInputType}.`);
  }

  private normalizeOptionsJson(inputType: InspectionItemInputType, optionsJson: unknown) {
    if (inputType !== InspectionItemInputType.SELECT) {
      return null;
    }

    const normalizedOptions = normalizeTemplateSelectOptions(optionsJson);

    if (!normalizedOptions) {
      throw new BadRequestException(
        'Dropdown items require a non-empty options array of unique { label, value } entries.',
      );
    }

    return normalizedOptions;
  }

  private buildUniqueItemKey(label: string, usedKeys: Set<string>) {
    const baseKey =
      label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'checklist_item';
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
    assetTypeId: string,
    excludeTemplateId?: string,
  ) {
    await tx.inspectionTemplate.updateMany({
      where: {
        tenantId,
        assetTypeId,
        isActive: true,
        ...(excludeTemplateId ? { id: { not: excludeTemplateId } } : {}),
      },
      data: {
        status: InspectionTemplateStatus.ARCHIVED,
        isActive: false,
      },
    });
  }

  private async getNextVersion(client: PrismaClientLike, assetTypeId: string) {
    const latestTemplate = await client.inspectionTemplate.findFirst({
      where: {
        assetTypeId,
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
      },
    });

    if (!assetTypeRecord) {
      throw new NotFoundException('Asset type not found.');
    }

    return assetTypeRecord;
  }

  private flattenItems(template: ChecklistTemplateRecord) {
    return template.sections
      .flatMap((section) => section.items)
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  private serialize(
    template: ChecklistTemplateRecord,
    options: { onlyActiveItems?: boolean } = {},
  ) {
    const items = this.flattenItems(template).filter((item) => !options.onlyActiveItems || item.isActive);

    return {
      id: template.id,
      assetType: template.assetType.code,
      assetTypeId: template.assetTypeId,
      assetTypeCode: template.assetType.code,
      assetTypeName: template.assetType.name,
      name: template.name,
      version: template.version,
      status: template.status,
      isActive: template.isActive,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      itemCount: items.filter((item) => item.isActive).length,
      inspectionCount: template._count.inspections,
      items: items.map((item) => ({
        id: item.id,
        templateId: item.templateId,
        key: item.key,
        label: item.label,
        fieldType: this.serializeFieldType(item.inputType),
        inputType: item.inputType,
        options: this.serializeOptions(item.inputType, item.optionsJson),
        optionsJson: item.optionsJson,
        sortOrder: item.sortOrder,
        isRequired: item.isRequired,
        isActive: item.isActive,
        isDefectTrigger: item.isDefectTrigger,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
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
    if (inputType !== InspectionItemInputType.SELECT) {
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
}

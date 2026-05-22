import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DefectSeverity, OperationalDomain } from '@prisma/client';

export const CHECKLIST_TEMPLATE_FIELD_TYPES = [
  'TEXT',
  'NUMBER',
  'BOOLEAN',
  'YES_NO',
  'SELECT',
  'DROPDOWN',
  'DATE',
  'DATETIME',
] as const;

export type ChecklistTemplateFieldType = (typeof CHECKLIST_TEMPLATE_FIELD_TYPES)[number];

export const CHECKLIST_TEMPLATE_DEFECT_SEVERITIES = [
  DefectSeverity.LOW,
  DefectSeverity.MEDIUM,
  DefectSeverity.HIGH,
  DefectSeverity.CRITICAL,
] as const;

export class ChecklistTemplateOptionInputDto {
  @IsString()
  @MaxLength(255)
  label!: string;

  @IsString()
  @MaxLength(255)
  value!: string;
}

export class ChecklistTemplateItemInputDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(255)
  label!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sortOrder?: number;

  @IsOptional()
  @IsIn(CHECKLIST_TEMPLATE_FIELD_TYPES)
  fieldType?: ChecklistTemplateFieldType;

  @IsOptional()
  @IsIn(CHECKLIST_TEMPLATE_FIELD_TYPES)
  inputType?: ChecklistTemplateFieldType;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefectTrigger?: boolean;

  @IsOptional()
  @IsIn(CHECKLIST_TEMPLATE_DEFECT_SEVERITIES)
  severity?: DefectSeverity;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistTemplateOptionInputDto)
  options?: ChecklistTemplateOptionInputDto[];

  @IsOptional()
  optionsJson?: unknown;
}

export class CreateChecklistTemplateDto {
  @IsOptional()
  @IsUUID()
  assetTypeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  assetType?: string;

  @IsOptional()
  @IsUUID()
  capabilityId?: string | null;

  @IsOptional()
  @IsUUID()
  mainheadId?: string | null;

  @IsOptional()
  @IsIn(Object.values(OperationalDomain))
  operationalDomain?: OperationalDomain | null;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChecklistTemplateItemInputDto)
  items!: ChecklistTemplateItemInputDto[];
}

export class UpdateChecklistTemplateDto {
  @IsOptional()
  @IsUUID()
  assetTypeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  assetType?: string;

  @IsOptional()
  @IsUUID()
  capabilityId?: string | null;

  @IsOptional()
  @IsUUID()
  mainheadId?: string | null;

  @IsOptional()
  @IsIn(Object.values(OperationalDomain))
  operationalDomain?: OperationalDomain | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistTemplateItemInputDto)
  items?: ChecklistTemplateItemInputDto[];
}

export class ChecklistTemplateIdParamDto {
  @IsUUID()
  id!: string;
}

export class ChecklistTemplateAssetTypeParamDto {
  @IsString()
  @MaxLength(255)
  assetType!: string;
}

export class ResolveInspectionTemplateQueryDto {
  @IsOptional()
  @IsUUID()
  assetTypeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  assetType?: string;

  @IsOptional()
  @IsUUID()
  capabilityId?: string;

  @IsOptional()
  @IsUUID()
  mainheadId?: string;
}

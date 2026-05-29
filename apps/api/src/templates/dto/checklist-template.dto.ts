import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DefectSeverity, InspectionTemplateScopeLevel, OperationalDomain } from '@prisma/client';

export const CHECKLIST_TEMPLATE_FIELD_TYPES = [
  'TEXT',
  'NUMBER',
  'BOOLEAN',
  'YES_NO',
  'SELECT',
  'DROPDOWN',
  'MULTI_SELECT',
  'IMAGE',
  'DATE',
  'DATETIME',
  'DATE_TIME',
  'GPS',
  'READING',
  'READING_MEASUREMENT',
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

  @IsOptional()
  @IsString()
  @MaxLength(50)
  prefix?: string;
}

export const CHECKLIST_TEMPLATE_SHOW_IF_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'greater_than',
  'less_than',
  'is_empty',
  'is_not_empty',
] as const;

export const CHECKLIST_TEMPLATE_READING_SOURCES = [
  'manual',
  'photo_ocr_future',
] as const;

export class ChecklistTemplateShowIfInputDto {
  @IsString()
  @MaxLength(255)
  dependsOn!: string;

  @IsIn(CHECKLIST_TEMPLATE_SHOW_IF_OPERATORS)
  operator!: (typeof CHECKLIST_TEMPLATE_SHOW_IF_OPERATORS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  value?: string | null;
}

export class ChecklistTemplateImageConfigInputDto {
  @IsOptional()
  @IsBoolean()
  requiredPhoto?: boolean;

  @IsOptional()
  @IsBoolean()
  allowMultiplePhotos?: boolean;

  @IsOptional()
  @IsBoolean()
  cameraOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  galleryAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  timestampOverlayRequired?: boolean;
}

export class ChecklistTemplateMeasurementConfigInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string | null;

  @IsOptional()
  @IsIn(CHECKLIST_TEMPLATE_READING_SOURCES)
  source?: (typeof CHECKLIST_TEMPLATE_READING_SOURCES)[number];

  @IsOptional()
  @IsBoolean()
  requiresImage?: boolean;
}

export class ChecklistTemplateItemInputDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  key?: string;

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
  @ValidateNested()
  @Type(() => ChecklistTemplateShowIfInputDto)
  showIf?: ChecklistTemplateShowIfInputDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChecklistTemplateImageConfigInputDto)
  imageConfig?: ChecklistTemplateImageConfigInputDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChecklistTemplateMeasurementConfigInputDto)
  measurementConfig?: ChecklistTemplateMeasurementConfigInputDto | null;

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
  @IsEnum(InspectionTemplateScopeLevel)
  scopeLevel?: InspectionTemplateScopeLevel | null;

  @IsOptional()
  @IsUUID()
  organizationId?: string | null;

  @IsOptional()
  @IsUUID()
  branchId?: string | null;

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
  @IsEnum(InspectionTemplateScopeLevel)
  scopeLevel?: InspectionTemplateScopeLevel | null;

  @IsOptional()
  @IsUUID()
  organizationId?: string | null;

  @IsOptional()
  @IsUUID()
  branchId?: string | null;

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
  assetId?: string;

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
  siteVisitId?: string;

  @IsOptional()
  @IsUUID()
  operationalSessionId?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  mainheadId?: string;
}

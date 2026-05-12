import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { DefectSeverity } from '@prisma/client';
import { TemplateBuilderInputType, TEMPLATE_BUILDER_INPUT_TYPES } from '../template-builder.constants';

const DEFECT_SEVERITIES = [
  DefectSeverity.LOW,
  DefectSeverity.MEDIUM,
  DefectSeverity.HIGH,
  DefectSeverity.CRITICAL,
] as const;

export class CreateTemplateItemDto {
  @IsUUID()
  sectionId!: string;

  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9_][A-Za-z0-9_-]*$/)
  key!: string;

  @IsString()
  @MaxLength(255)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  helperText?: string | null;

  @IsIn(TEMPLATE_BUILDER_INPUT_TYPES)
  inputType!: TemplateBuilderInputType;

  @IsBoolean()
  isRequired!: boolean;

  @IsOptional()
  @IsBoolean()
  isDefectTrigger?: boolean;

  @IsOptional()
  @IsIn(DEFECT_SEVERITIES)
  severity?: DefectSeverity;

  @IsInt()
  @Min(1)
  sortOrder!: number;

  @IsOptional()
  optionsJson?: unknown;
}

export class UpdateTemplateItemDto {
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9_][A-Za-z0-9_-]*$/)
  key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  helperText?: string | null;

  @IsOptional()
  @IsIn(TEMPLATE_BUILDER_INPUT_TYPES)
  inputType?: TemplateBuilderInputType;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefectTrigger?: boolean;

  @IsOptional()
  @IsIn(DEFECT_SEVERITIES)
  severity?: DefectSeverity;

  @IsOptional()
  @IsInt()
  @Min(1)
  sortOrder?: number;

  @IsOptional()
  optionsJson?: unknown;
}

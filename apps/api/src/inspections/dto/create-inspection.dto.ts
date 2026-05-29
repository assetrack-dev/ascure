import { OperationMode, OperationalScope } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateInspectionDto {
  @IsUUID()
  siteVisitId!: string;

  @IsUUID()
  assetId!: string;

  @IsOptional()
  @IsUUID()
  operationalSessionId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  inspectionCycle?: number;

  @IsOptional()
  @IsEnum(OperationMode)
  operationMode?: OperationMode;

  @IsOptional()
  @IsEnum(OperationalScope)
  operationalScope?: OperationalScope;

  @IsOptional()
  @IsBoolean()
  requiresQAQC?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reportingGroup?: string;
}

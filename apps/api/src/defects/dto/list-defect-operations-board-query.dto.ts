import {
  DefectLifecycleStatus,
  DefectSeverity,
  ResolutionOutcome as DefectResolutionOutcome,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const optionalBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === 'true') {
      return true;
    }

    if (normalizedValue === 'false') {
      return false;
    }
  }

  return value;
};

export class ListDefectOperationsBoardQueryDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mainhead?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  workPackageId?: string;

  @IsOptional()
  @IsUUID()
  siteVisitId?: string;

  @IsOptional()
  @IsEnum(DefectSeverity)
  severity?: DefectSeverity;

  @IsOptional()
  @IsEnum(DefectLifecycleStatus)
  status?: DefectLifecycleStatus;

  @IsOptional()
  @IsEnum(DefectResolutionOutcome)
  resolutionOutcome?: DefectResolutionOutcome;

  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  @Transform(optionalBoolean)
  @IsOptional()
  @IsBoolean()
  overdueOnly?: boolean;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  q?: string;
}

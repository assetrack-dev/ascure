import { OperationalDomain, SiteVisitType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSiteVisitDto {
  @IsUUID()
  teamId!: string;

  @IsOptional()
  @IsUUID()
  substationId?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  mainheadId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  workPackageId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'OPEN', 'IN_PROGRESS'])
  status?: 'ACTIVE' | 'OPEN' | 'IN_PROGRESS';

  @IsOptional()
  @IsInt()
  @Min(1)
  cycleNumber?: number;

  @IsOptional()
  @IsIn(Object.values(SiteVisitType))
  visitType?: SiteVisitType;

  @IsOptional()
  @IsEnum(OperationalDomain)
  operationalDomain?: OperationalDomain;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mainhead?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  pencawangCode?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  pencawangName?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  functionalLocation?: string;

  @IsOptional()
  @IsLatitude()
  checkInLatitude?: number;

  @IsOptional()
  @IsLongitude()
  checkInLongitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  checkInAccuracyMeters?: number;

  @IsOptional()
  @IsDateString()
  checkInCapturedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

import {
  OperationMode,
  OperationalDomain,
  OperationalScope,
  SessionKind,
  SiteVisitType,
  SiteVisitValidationStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListSiteVisitsQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  status?: 'ACTIVE' | 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mainhead?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  pencawang?: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn(Object.values(SiteVisitType))
  visitType?: SiteVisitType;

  @IsOptional()
  @IsIn(Object.values(OperationalDomain))
  operationalDomain?: OperationalDomain;

  @IsOptional()
  @IsIn(Object.values(OperationMode))
  operationMode?: OperationMode;

  @IsOptional()
  @IsIn(Object.values(OperationalScope))
  operationalScope?: OperationalScope;

  @IsOptional()
  @IsIn(Object.values(SessionKind))
  sessionKind?: SessionKind;

  @IsOptional()
  @IsIn(Object.values(SiteVisitValidationStatus))
  validationStatus?: SiteVisitValidationStatus;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

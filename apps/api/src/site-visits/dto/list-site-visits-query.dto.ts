import {
  OperationMode,
  OperationalDomain,
  OperationalScope,
  SessionKind,
  SiteVisitType,
  SiteVisitValidationStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListSiteVisitsQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  status?: 'ACTIVE' | 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

  /**
   * Cap the newest-first result set. Added for mobile: an ADMIN/MANAGER
   * account is tenant-scoped, so its unbounded COMPLETED list is the whole
   * survey history — enough to crash a phone parsing and caching it.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

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

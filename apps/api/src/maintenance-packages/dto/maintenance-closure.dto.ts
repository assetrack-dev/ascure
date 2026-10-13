import { MaintenanceCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  Min,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const VERIFICATION_TABS = ['PENDING', 'CANNOT_REPAIR', 'CLOSED'] as const;
export type VerificationTab = (typeof VERIFICATION_TABS)[number];

export class VerificationQueueQueryDto {
  @IsOptional()
  @IsIn(VERIFICATION_TABS)
  tab?: VerificationTab;

  // Plan §19 (N54): narrow the queue — one Pencawang group, a company, a work
  // type, a submitted (closed, on the Closed tab) date range.
  @IsOptional()
  @IsUUID()
  siteVisitId?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory;

  /** yyyy-mm-dd, inclusive (Malaysia day). */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

/** The grouped view: one row per Pencawang + company, 20 per page. */
export class VerificationGroupsQueryDto extends VerificationQueueQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;
}

export class VerifyRepairDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** Reject / re-open / reassign always need a reason the crew can act on. */
export class RepairReasonDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class ReassignCannotRepairDto extends RepairReasonDto {
  @IsUUID()
  maintenanceOrganizationId!: string;
}


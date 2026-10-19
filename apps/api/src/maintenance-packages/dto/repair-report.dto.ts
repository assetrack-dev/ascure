import { MaintenanceCategory } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Plan §21 (R7) — "Reports by date": which Kejanggalan of the period go in.
 *  - VERIFIED  (default) signed off in the period — the ones valid for a claim;
 *  - COMPLETED marked done on site in the period, not yet verified;
 *  - BOTH      either.
 */
export const REPAIR_PERIOD_STATUSES = ['VERIFIED', 'COMPLETED', 'BOTH'] as const;
export type RepairPeriodStatus = (typeof REPAIR_PERIOD_STATUSES)[number];

/** Which company / work type a repair report covers (docs/PLAN-maintenance-flow.md §16). */
export class RepairReportQueryDto {
  /** Needed only when several companies in the caller's reach work on the PE. */
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  /** One work type only (e.g. a Rentis claim); omitted = every work type. */
  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory;

  /** Plan §21 (R7): a period (yyyy-mm-dd, Malaysia days, inclusive) — only its Kejanggalan are listed. */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** With a period: which status's date counts (default VERIFIED). */
  @IsOptional()
  @IsIn(REPAIR_PERIOD_STATUSES)
  status?: RepairPeriodStatus;

  /** With a period: one team's work only. */
  @IsOptional()
  @IsUUID()
  teamId?: string;
}

/**
 * The ZIP: the Pencawang picked on the board, OR — with from + to and no
 * siteVisitIds — every Pencawang that has Kejanggalan of the period (R7).
 */
export class RepairReportZipDto extends RepairReportQueryDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  siteVisitIds?: string[];
}

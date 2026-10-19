import { MaintenanceCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Plan §21.2 #4 — where each routed Kejanggalan stands for the company doing it.
 * Derived from stored data only (no new column):
 *  - TODO          routed, nobody has started (no repair photo yet)
 *  - IN_PROGRESS   repair photos being taken
 *  - SENT_BACK     TNB / the main contractor rejected or re-opened it: back to
 *                  work, but it was marked done before (maintainedAt kept)
 *  - COMPLETED     marked done on site, waiting for verification
 *  - CANNOT_REPAIR submitted as cannot-repair (waiting for TNB, or closed as such)
 *  - VERIFIED      verified and closed
 */
export const TASK_STATUSES = [
  'TODO',
  'IN_PROGRESS',
  'SENT_BACK',
  'COMPLETED',
  'CANNOT_REPAIR',
  'VERIFIED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** A team id, or NONE for work no team holds yet. */
const TEAM_PATTERN = /^(NONE|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export class MaintenanceTasksQueryDto {
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @Matches(TEAM_PATTERN, { message: 'teamId must be a team id or NONE' })
  teamId?: string;

  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory;

  /** yyyy-mm-dd, inclusive (Malaysia day): marked done or verified in the range. */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class MaintenanceTaskGroupsQueryDto extends MaintenanceTasksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;
}

/** Plan §21.2 #3 — the company Overview: one day (default today) + the 30 before it. */
export class MaintenanceOverviewQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  /** yyyy-mm-dd (Malaysia day); default today. */
  @IsOptional()
  @IsDateString()
  date?: string;
}

/** Plan §21.2 #2 — TNB Performance for a period. */
export class TnbPerformanceQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory;
}

/** One group's Kejanggalan: a Pencawang + company + team (or NONE). */
export class MaintenanceTaskItemsQueryDto extends MaintenanceTasksQueryDto {
  @IsUUID()
  siteVisitId!: string;
}

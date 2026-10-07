import { MaintenanceCategory } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';

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
}

export class RepairReportZipDto extends RepairReportQueryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  siteVisitIds!: string[];
}

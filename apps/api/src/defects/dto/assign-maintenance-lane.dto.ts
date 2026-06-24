import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { MaintenanceCategory } from '@prisma/client';

export class AssignMaintenanceLaneDto {
  @IsUUID()
  substationId!: string;

  /** Omit to act on the whole Pencawang; set to target one work-type lane. */
  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory;

  /** A team id to assign, or null to clear the assignment. */
  @IsOptional()
  @IsUUID()
  assignedToTeamId?: string | null;
}

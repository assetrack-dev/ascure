import { MaintenanceCategory } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const emptyToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/**
 * TNB (Foreman / Technician) or ADMIN hands a surveyed PE to a maintenance
 * company. `category` omitted / null = the whole PE; a work type splits the PE
 * so that lane can go to a different company. Re-posting an existing package
 * reassigns it.
 */
export class AssignMaintenancePackageDto {
  @IsUUID()
  siteVisitId!: string;

  @Transform(emptyToNull)
  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory | null;

  @IsUUID()
  maintenanceOrganizationId!: string;

  /** Target completion date set by TNB (ISO date). */
  @Transform(emptyToNull)
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

/** Manual routing of an emergency whose PE has no package yet. */
export class AssignEmergencyDto {
  @IsUUID()
  maintenanceOrganizationId!: string;
}

import { MaintenanceCategory } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

/** Where the work goes: a company, a team (company implied), or both. */
class PackageDestinationDto {
  @Transform(emptyToNull)
  @IsOptional()
  @IsUUID()
  maintenanceOrganizationId?: string | null;

  /** Plan §12: TNB / Main Contractor may hand the work straight to a crew. */
  @Transform(emptyToNull)
  @IsOptional()
  @IsUUID()
  assignedTeamId?: string | null;
}

/**
 * TNB (Foreman / Technician), a Main Contractor manager or ADMIN hands a
 * surveyed PE to a maintenance company or one of its teams. `category` omitted /
 * null = the whole PE; a work type splits the PE so that lane can go elsewhere.
 * Re-posting an existing package reassigns it.
 */
export class AssignMaintenancePackageDto extends PackageDestinationDto {
  @IsUUID()
  siteVisitId!: string;

  @Transform(emptyToNull)
  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory | null;

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

/** One destination for many PEs at once (the Map selection / list multi-select). */
export class BulkAssignMaintenancePackagesDto extends PackageDestinationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  siteVisitIds!: string[];

  @Transform(emptyToNull)
  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory | null;

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
export class AssignEmergencyDto extends PackageDestinationDto {}

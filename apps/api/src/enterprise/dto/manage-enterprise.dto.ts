import {
  OperationalDomain,
  OrganizationType,
  ProjectStatus,
  WorkPackageStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeNullableString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();

  return trimmedValue ? trimmedValue : null;
};

export class CreateOrganizationDto {
  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  name!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string | null;

  @IsEnum(OrganizationType)
  type!: OrganizationType;

  @IsOptional()
  @IsUUID()
  parentOrganizationId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  capabilityIds?: string[];
}

export class UpdateOrganizationDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string | null;

  @IsOptional()
  @IsEnum(OrganizationType)
  type?: OrganizationType;

  @IsOptional()
  @IsUUID()
  parentOrganizationId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  capabilityIds?: string[];
}

export class CreateBranchDto {
  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  name!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  region?: string | null;

  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  capabilityIds?: string[];
}

export class UpdateBranchDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  region?: string | null;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  capabilityIds?: string[];
}

export class CreateOperationalRegionDto {
  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  name!: string;

  @Transform(trimString)
  @IsString()
  @MaxLength(64)
  code!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  state?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOperationalRegionDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  state?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateCapabilityDto {
  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  name!: string;

  @Transform(trimString)
  @IsString()
  @MaxLength(64)
  code!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCapabilityDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateMainheadDto {
  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  name!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @IsUUID()
  operationalRegionId?: string | null;

  // Maintenance handoff Phase 2 — the maintenance company registered for this
  // MAINHEAD. Empty string clears the registration (normalized to null).
  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  maintenanceOrganizationId?: string | null;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  branchName?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  branchCode?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  region?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  capabilityIds?: string[];
}

export class UpdateMainheadDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @IsUUID()
  operationalRegionId?: string | null;

  // Maintenance handoff Phase 2 — the maintenance company registered for this
  // MAINHEAD. Empty string clears the registration (normalized to null).
  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  maintenanceOrganizationId?: string | null;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  branchName?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  branchCode?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  region?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  capabilityIds?: string[];
}

export class CreateProjectDto {
  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  name!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsUUID()
  mainheadId?: string | null;

  @IsOptional()
  @IsUUID()
  organizationId?: string | null;

  @IsOptional()
  @IsUUID()
  clientOrganizationId?: string | null;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsEnum(OperationalDomain)
  operationalDomain?: OperationalDomain | null;

  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;
}

export class UpdateProjectDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsUUID()
  mainheadId?: string | null;

  @IsOptional()
  @IsUUID()
  organizationId?: string | null;

  @IsOptional()
  @IsUUID()
  clientOrganizationId?: string | null;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsEnum(OperationalDomain)
  operationalDomain?: OperationalDomain | null;

  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;
}

export class CreateWorkPackageDto {
  @IsUUID()
  projectId!: string;

  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  name!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string | null;

  @IsOptional()
  @IsUUID()
  mainheadId?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mainhead?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  area?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsEnum(WorkPackageStatus)
  status?: WorkPackageStatus;

  @IsOptional()
  @IsEnum(OperationalDomain)
  operationalDomain?: OperationalDomain | null;
}

export class UpdateWorkPackageDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string | null;

  @IsOptional()
  @IsUUID()
  mainheadId?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mainhead?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  area?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsEnum(WorkPackageStatus)
  status?: WorkPackageStatus;

  @IsOptional()
  @IsEnum(OperationalDomain)
  operationalDomain?: OperationalDomain | null;
}

export class UpdateEnterpriseActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

export class UpdateProjectLifecycleStatusDto {
  @IsIn([ProjectStatus.ACTIVE, ProjectStatus.ARCHIVED])
  status!: 'ACTIVE' | 'ARCHIVED';
}

export class UpdateWorkPackageLifecycleStatusDto {
  @IsIn([WorkPackageStatus.ACTIVE, WorkPackageStatus.ARCHIVED])
  status!: 'ACTIVE' | 'ARCHIVED';
}

import {
  OperationalDomain,
  OrganizationType,
  ProjectStatus,
  WorkPackageStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
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

  @IsOptional()
  @IsEnum(OrganizationType)
  type?: OrganizationType;

  @IsOptional()
  @IsUUID()
  parentOrganizationId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
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

  @IsOptional()
  @IsUUID()
  branchId?: string;

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

  @IsOptional()
  @IsUUID()
  branchId?: string;

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
  branchId?: string;

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
  branchId?: string;

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

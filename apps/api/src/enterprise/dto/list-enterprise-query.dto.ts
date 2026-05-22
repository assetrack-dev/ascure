import {
  OperationalDomain,
  OrganizationCapabilityType,
  OrganizationType,
  ProjectStatus,
  WorkPackageStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const optionalBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === 'true') {
      return true;
    }

    if (normalizedValue === 'false') {
      return false;
    }
  }

  return value;
};

export class ListOrganizationsQueryDto {
  @IsOptional()
  @IsEnum(OrganizationType)
  type?: OrganizationType;

  @IsOptional()
  @IsEnum(OrganizationCapabilityType)
  capability?: OrganizationCapabilityType;

  @Transform(optionalBoolean)
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListBranchesQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @Transform(optionalBoolean)
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListCapabilitiesQueryDto {
  @Transform(optionalBoolean)
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListMainheadsQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @Transform(optionalBoolean)
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListProjectsQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsEnum(OperationalDomain)
  operationalDomain?: OperationalDomain;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}

export class ListWorkPackagesQueryDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsEnum(WorkPackageStatus)
  status?: WorkPackageStatus;

  @IsOptional()
  @IsEnum(OperationalDomain)
  operationalDomain?: OperationalDomain;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mainhead?: string;
}

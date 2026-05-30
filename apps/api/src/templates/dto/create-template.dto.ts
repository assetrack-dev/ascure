import { InspectionTemplateScopeLevel, OperationalDomain } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateTemplateDto {
  @IsUUID()
  assetTypeId!: string;

  @IsOptional()
  @IsUUID()
  capabilityId?: string | null;

  @IsOptional()
  @IsEnum(InspectionTemplateScopeLevel)
  scopeLevel?: InspectionTemplateScopeLevel | null;

  @IsOptional()
  @IsUUID()
  organizationId?: string | null;

  @IsOptional()
  @IsUUID()
  operationalRegionId?: string | null;

  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @IsUUID()
  mainheadId?: string | null;

  @IsOptional()
  @IsIn(Object.values(OperationalDomain))
  operationalDomain?: OperationalDomain | null;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

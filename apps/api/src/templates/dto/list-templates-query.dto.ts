import { InspectionTemplateStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class ListTemplatesQueryDto {
  @IsOptional()
  @IsUUID()
  assetTypeId?: string;

  @IsOptional()
  @IsUUID()
  capabilityId?: string;

  @IsOptional()
  @IsUUID()
  mainheadId?: string;

  @IsOptional()
  @IsEnum(InspectionTemplateStatus)
  status?: InspectionTemplateStatus;
}

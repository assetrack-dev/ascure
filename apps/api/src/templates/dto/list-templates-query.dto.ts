import { InspectionTemplateStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class ListTemplatesQueryDto {
  @IsOptional()
  @IsUUID()
  assetTypeId?: string;

  @IsOptional()
  @IsEnum(InspectionTemplateStatus)
  status?: InspectionTemplateStatus;
}

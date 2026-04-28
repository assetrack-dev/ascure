import { DefectStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateDefectStatusDto {
  @IsEnum(DefectStatus)
  status!: DefectStatus;

  @IsOptional()
  @IsString()
  actionRemark?: string | null;
}

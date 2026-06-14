import { OperationalScope } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadReportTemplateDto {
  /** Display name; falls back to the uploaded file name when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  /** The asset operational scope this template renders. */
  @IsEnum(OperationalScope)
  operationalScope!: OperationalScope;
}

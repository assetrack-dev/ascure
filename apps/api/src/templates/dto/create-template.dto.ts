import { OperationalDomain } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateTemplateDto {
  @IsUUID()
  assetTypeId!: string;

  @IsOptional()
  @IsUUID()
  capabilityId?: string | null;

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

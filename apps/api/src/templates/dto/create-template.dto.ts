import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateTemplateDto {
  @IsUUID()
  assetTypeId!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

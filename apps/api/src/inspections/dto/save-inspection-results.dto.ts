import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

export class SaveInspectionResultItemDto {
  @IsUUID()
  templateItemId!: string;

  @IsOptional()
  @IsString()
  valueText?: string | null;

  @IsOptional()
  @IsNumber()
  valueNumber?: number | null;

  @IsOptional()
  @IsBoolean()
  valueBoolean?: boolean | null;

  @IsOptional()
  @IsDateString()
  valueDate?: string | null;

  @IsOptional()
  @IsDateString()
  valueDateTime?: string | null;

  @IsOptional()
  valueJson?: unknown;
}

export class SaveInspectionResultsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaveInspectionResultItemDto)
  results!: SaveInspectionResultItemDto[];
}


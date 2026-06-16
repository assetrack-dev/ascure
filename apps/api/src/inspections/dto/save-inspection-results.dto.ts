import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export const INSPECTION_ITEM_RESULT_VALUES = ['PASS', 'FAIL', 'NA'] as const;

export type InspectionItemResultInputValue =
  (typeof INSPECTION_ITEM_RESULT_VALUES)[number];

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

export class SaveInspectionItemResultDto {
  @IsOptional()
  @IsUUID()
  checklistItemId?: string | null;

  @IsString()
  label!: string;

  @IsIn(INSPECTION_ITEM_RESULT_VALUES)
  result!: InspectionItemResultInputValue;

  @IsOptional()
  @IsString()
  remark?: string | null;

  @IsOptional()
  @IsBoolean()
  isEmergency?: boolean;
}

export class SaveInspectionResultsDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaveInspectionResultItemDto)
  results?: SaveInspectionResultItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaveInspectionItemResultDto)
  items?: SaveInspectionItemResultDto[];
}

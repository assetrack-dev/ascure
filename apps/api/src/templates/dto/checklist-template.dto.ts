import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ChecklistTemplateItemInputDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(255)
  label!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateChecklistTemplateDto {
  @IsString()
  @MaxLength(255)
  assetType!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistTemplateItemInputDto)
  items!: ChecklistTemplateItemInputDto[];
}

export class UpdateChecklistTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistTemplateItemInputDto)
  items?: ChecklistTemplateItemInputDto[];
}

export class ChecklistTemplateIdParamDto {
  @IsUUID()
  id!: string;
}

export class ChecklistTemplateAssetTypeParamDto {
  @IsString()
  @MaxLength(255)
  assetType!: string;
}

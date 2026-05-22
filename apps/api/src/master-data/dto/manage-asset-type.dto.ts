import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsBooleanString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeNullableString = ({ value }: { value: unknown }) => {
  if (value === '') {
    return null;
  }

  return typeof value === 'string' ? value.trim() : value;
};

export class ListAssetTypesQueryDto {
  @IsOptional()
  @IsBooleanString()
  includeInactive?: string;
}

export class AssetTypeIdParamDto {
  @IsUUID()
  id!: string;
}

export class CreateAssetTypeDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  capabilityId?: string | null;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number | null;
}

export class UpdateAssetTypeDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code?: string;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  capabilityId?: string | null;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number | null;
}

export class UpdateAssetTypeStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

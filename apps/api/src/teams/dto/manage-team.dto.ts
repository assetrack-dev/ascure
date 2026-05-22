import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeNullableString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();

  return trimmedValue ? trimmedValue : null;
};

export class CreateTeamDto {
  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  name!: string;

  @Transform(trimString)
  @IsString()
  @MaxLength(64)
  code!: string;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  organizationId?: string | null;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  mainheadId?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  capabilityIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTeamDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  organizationId?: string | null;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  mainheadId?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  capabilityIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTeamStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

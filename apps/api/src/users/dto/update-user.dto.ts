import { MainheadAccessRole, UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const normalizeNullableString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();

  return trimmedValue ? trimmedValue : null;
};

export class UpdateUserDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @Transform(normalizeEmail)
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

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

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  teamId?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  capabilityIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  mainheadAccessIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  operationalRegionAccessIds?: string[];

  @IsOptional()
  @IsEnum(MainheadAccessRole)
  accessRole?: MainheadAccessRole;
}

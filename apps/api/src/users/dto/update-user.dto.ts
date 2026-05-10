import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
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
}

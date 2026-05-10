import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
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

export class CreateUserDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

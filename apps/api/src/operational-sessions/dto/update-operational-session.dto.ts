import { OperationalSessionStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateOperationalSessionDto {
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @IsUUID()
  mainheadId?: string | null;

  @IsOptional()
  @IsUUID()
  assignedCompanyId?: string;

  @IsOptional()
  @IsUUID()
  assignedQaUserId?: string | null;

  @IsOptional()
  @IsEnum(OperationalSessionStatus)
  status?: OperationalSessionStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;

  @IsOptional()
  @IsDateString()
  targetDate?: string | null;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string | null;
}

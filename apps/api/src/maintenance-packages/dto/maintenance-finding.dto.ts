import { Transform, Type } from 'class-transformer';
import { MaintenanceCategory } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A Kejanggalan added during maintenance (docs/PLAN-maintenance-flow.md §13).
 * The office form posts multipart (with the condition photo), so numbers may
 * arrive as strings.
 *
 * Either a checklist item (`templateItemId`) or, for work the checklist does
 * not list (TNB feedback #2, 2026-10-10), free text (`customLabel`) with its
 * work type (`category`).
 */
export class AddMaintenanceFindingDto {
  @IsUUID()
  assetId!: string;

  @IsOptional()
  @IsUUID()
  templateItemId?: string;

  /** Free-text Kejanggalan not in the checklist ("Lain-lain"). */
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  customLabel?: string;

  /** Work type of a free-text Kejanggalan (Rentis / Cat tiang / Selenggaraan). */
  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory;

  /** The defect option picked, for a select item (none for a yes/no item). */
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  optionValue?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** Idempotency key — the offline queue may send the same add twice. */
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientRef?: string;

  // Office photo metadata (optional).
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}

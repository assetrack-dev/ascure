import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Correct a started Site Visit's identity / location fields (wrong Pencawang,
 * wrong mainhead, wrong GPS) instead of recreating it. Every field is optional —
 * only what's sent is changed. Lifecycle + role gating lives in the service
 * (crew may edit before RONDAAN SELESAI; only a manager after; finalised surveys
 * are locked).
 */
export class UpdateSiteVisitDto {
  // Re-point the visit to a different existing Pencawang (tenant-validated). The
  // denormalised pencawang label/location refresh from it unless also sent here.
  @IsOptional()
  @IsUUID()
  substationId?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mainhead?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  pencawangCode?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  pencawangName?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  functionalLocation?: string;

  @IsOptional()
  @IsLatitude()
  checkInLatitude?: number;

  @IsOptional()
  @IsLongitude()
  checkInLongitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  checkInAccuracyMeters?: number;

  @IsOptional()
  @IsDateString()
  checkInCapturedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DEFECT_EVIDENCE_TYPES } from '../evidence-types';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upperTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || undefined : value;
const emptyStringToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class UploadDefectEvidenceImageDto {
  /** BEFORE / DURING / AFTER (repair stages), or legacy MAINTENANCE_PROOF / EMERGENCY. */
  @Transform(upperTrim)
  @IsOptional()
  @IsIn(DEFECT_EVIDENCE_TYPES)
  evidenceType?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsDateString()
  timestamp?: string;
}

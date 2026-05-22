import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const emptyStringToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class UploadDefectEvidenceImageDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(80)
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

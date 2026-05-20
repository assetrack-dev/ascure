import { Transform } from 'class-transformer';
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
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsDateString()
  timestamp?: string;
}

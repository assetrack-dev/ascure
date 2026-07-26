import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const emptyStringToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class UploadInspectionImageDto {
  // The checklist item this photo belongs to (e.g. an OCR Smart Sensor reading),
  // so the API can link the photo to that item for the visual report.
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  templateItemId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsDateString()
  timestamp?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(64)
  type?: string;

  // Fix-quality provenance for the photo's coordinate (see the mobile
  // InspectionImageUploadInput): the GPS ± radius, the fix's own acquisition
  // time, and Android's mock-location flag. Optional so older APKs still upload.
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Type(() => Number)
  @IsNumber()
  accuracyMeters?: number;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsDateString()
  capturedFixAt?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  mocked?: boolean;
}

import { Transform, Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

const emptyStringToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class UploadInspectionImageDto {
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
}

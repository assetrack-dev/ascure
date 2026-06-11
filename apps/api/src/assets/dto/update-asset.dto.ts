import { Transform } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeNullableValue = ({ value }: { value: unknown }) =>
  value === '' ? null : value;

export class UpdateAssetDto {
  @IsOptional()
  @IsUUID()
  assetTypeId?: string;

  // Move the pole to a different Pencawang (e.g. it was marked to the wrong
  // nearby substation). The pole's feeder/fed-from graph is re-synced into the
  // new substation server-side.
  @IsOptional()
  @IsUUID()
  substationId?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  assetCode?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  name?: string;

  @Transform(normalizeNullableValue)
  @IsOptional()
  @IsLatitude()
  latitude?: number | null;

  @Transform(normalizeNullableValue)
  @IsOptional()
  @IsLongitude()
  longitude?: number | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}

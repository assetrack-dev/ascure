import { AssetStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
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

export class CreateAssetDto {
  @IsUUID()
  substationId!: string;

  @IsUUID()
  assetTypeId!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  assetCode!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;

  @IsOptional()
  @IsUUID()
  createdDuringVisitId?: string;
}

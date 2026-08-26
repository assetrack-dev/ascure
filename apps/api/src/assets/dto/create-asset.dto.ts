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
  /** Omitted for STANDALONE-scope equipment (Pencawang / Feeder Pillar /
   *  Link Box / Cable Bridge) — those belong to no Pencawang. */
  @IsOptional()
  @IsUUID()
  substationId?: string;

  @IsUUID()
  assetTypeId!: string;

  /** Optional for standalone equipment — the server assigns the tenant-wide
   *  refCode (PC-0001, FP-0001, …) and uses it as the code when none is sent. */
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  assetCode?: string;

  /** TNB's printed equipment ID (functional-location style), when it has one.
   *  Standalone scopes only; free-format, searchable, never identity. */
  @Transform(trimString)
  @IsOptional()
  @IsString()
  externalRef?: string;

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

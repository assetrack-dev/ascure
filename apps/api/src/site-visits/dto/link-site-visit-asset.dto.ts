import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class LinkSiteVisitAssetDto {
  @IsUUID()
  assetId!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * SAVT shared-pole link (docs/PLAN-savt-shared-poles.md): THIS route's
   * No. Tiang for an existing pole that physically carries several feeders.
   * Providing it makes the link also create the pole's membership on the
   * visit's route; requires a SAVT visit with a KOD TIANG.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  savtNoTiang?: number;

  /** Branch tail on this route (e.g. "/1"); trunk poles omit it. */
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  savtBranchSuffix?: string;
}

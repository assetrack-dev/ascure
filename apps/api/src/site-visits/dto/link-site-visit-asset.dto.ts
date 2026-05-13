import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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
}

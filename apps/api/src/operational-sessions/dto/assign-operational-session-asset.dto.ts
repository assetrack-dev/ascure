import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class AssignOperationalSessionAssetDto {
  @IsUUID()
  assetId!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

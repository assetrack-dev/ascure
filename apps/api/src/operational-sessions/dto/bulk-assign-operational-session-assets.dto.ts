import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class BulkAssignOperationalSessionAssetsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  assetIds!: string[];
}

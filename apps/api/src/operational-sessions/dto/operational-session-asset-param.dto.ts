import { IsUUID } from 'class-validator';

export class OperationalSessionAssetParamDto {
  @IsUUID()
  id!: string;

  @IsUUID()
  assetId!: string;
}

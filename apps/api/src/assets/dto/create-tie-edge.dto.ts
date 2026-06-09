import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { SwitchState, TieEdgeKind } from '@prisma/client';

export class CreateTieEdgeDto {
  @IsUUID()
  fromAssetId!: string;

  @IsUUID()
  toAssetId!: string;

  @IsOptional()
  @IsUUID()
  deviceAssetId?: string;

  @IsOptional()
  @IsEnum(TieEdgeKind)
  kind?: TieEdgeKind;

  @IsOptional()
  @IsEnum(SwitchState)
  switchState?: SwitchState;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

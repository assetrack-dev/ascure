import { IsEnum } from 'class-validator';
import { SwitchState } from '@prisma/client';

export class UpdateTieEdgeStateDto {
  @IsEnum(SwitchState)
  switchState!: SwitchState;
}

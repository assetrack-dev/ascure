import { IsUUID } from 'class-validator';

export class OperationalSessionIdParamDto {
  @IsUUID()
  id!: string;
}

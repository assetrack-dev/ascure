import { IsUUID } from 'class-validator';

export class TeamIdParamDto {
  @IsUUID()
  id!: string;
}

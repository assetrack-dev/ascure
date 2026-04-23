import { IsUUID } from 'class-validator';

export class ListAssetsQueryDto {
  @IsUUID()
  substation_id!: string;
}


import { IsOptional, IsUUID } from 'class-validator';

export class ListAssetsQueryDto {
  @IsOptional()
  @IsUUID()
  substation_id?: string;
}

import { IsIn, IsOptional } from 'class-validator';

export class ListSiteVisitsQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'COMPLETED', 'CANCELLED'])
  status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}


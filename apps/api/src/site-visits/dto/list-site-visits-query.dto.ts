import { IsIn, IsOptional } from 'class-validator';

export class ListSiteVisitsQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  status?: 'ACTIVE' | 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

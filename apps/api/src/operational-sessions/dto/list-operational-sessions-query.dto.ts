import {
  OperationalSessionScope,
  OperationalSessionStatus,
} from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class ListOperationalSessionsQueryDto {
  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsEnum(OperationalSessionScope)
  scope?: OperationalSessionScope;

  @IsOptional()
  @IsEnum(OperationalSessionStatus)
  status?: OperationalSessionStatus;

  @IsOptional()
  @IsUUID()
  assignedCompanyId?: string;

  @IsOptional()
  @IsUUID()
  assignedQaUserId?: string;

  @IsOptional()
  @IsUUID()
  mainheadId?: string;
}

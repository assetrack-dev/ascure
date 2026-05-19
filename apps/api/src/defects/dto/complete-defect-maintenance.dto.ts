import { DefectResolutionOutcome } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CompleteDefectMaintenanceDto {
  @IsOptional()
  @IsEnum(DefectResolutionOutcome)
  resolutionOutcome?: DefectResolutionOutcome;

  @IsOptional()
  @IsString()
  completionRemarks?: string | null;
}

import { ResolutionOutcome as DefectResolutionOutcome } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CompleteDefectMaintenanceDto {
  @IsOptional()
  @IsEnum(DefectResolutionOutcome)
  resolutionOutcome?: DefectResolutionOutcome;

  @IsOptional()
  @IsEnum(DefectResolutionOutcome)
  outcome?: DefectResolutionOutcome;

  @IsOptional()
  @IsString()
  completionRemarks?: string | null;

  @IsOptional()
  @IsString()
  maintenanceNotes?: string | null;

  @IsOptional()
  @IsString()
  remarks?: string | null;
}

import { ResolutionOutcome as DefectResolutionOutcome } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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

  /** Plan §20 (P2): the kind of repair done (e.g. Rentis: KAEDAH LAZIM). Optional
   *  for older apps; v2.0.20 requires it for Rentis. */
  @IsOptional()
  @IsUUID()
  repairMethodId?: string;

  /** Required when the chosen kind is "Lain-lain". */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  repairMethodNote?: string | null;
}

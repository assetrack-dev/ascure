import { IsOptional, IsString } from 'class-validator';

export class VerifyDefectClosureDto {
  @IsOptional()
  @IsString()
  closureRemarks?: string | null;

  @IsOptional()
  @IsString()
  closureVerificationNotes?: string | null;
}

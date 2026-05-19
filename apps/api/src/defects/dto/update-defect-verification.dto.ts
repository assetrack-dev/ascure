import { IsOptional, IsString } from 'class-validator';

export class UpdateDefectVerificationDto {
  @IsOptional()
  @IsString()
  verificationRemarks?: string | null;
}

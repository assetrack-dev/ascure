import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DC sends a survey back for amendments (RONDAAN SELESAI → PERLU PINDAAN).
 * A remark is mandatory — it is the data-quality reason the inspector must act
 * on, and it is recorded on the lifecycle event for the audit trail.
 */
export class RequestSurveyAmendmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  remark!: string;
}

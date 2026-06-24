import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeclareEmergencyDto {
  /** The inspector's brief "what happened" note (chips + free text from the app). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

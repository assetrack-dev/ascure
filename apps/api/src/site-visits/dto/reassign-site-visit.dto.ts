import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ReassignSiteVisitDto {
  @IsUUID()
  toTeamId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

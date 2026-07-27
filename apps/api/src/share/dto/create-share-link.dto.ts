import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateShareLinkDto {
  /** How long the link stays live. Defaults to 30 days at the controller. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

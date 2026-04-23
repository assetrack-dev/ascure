import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateSiteVisitDto {
  @IsUUID()
  teamId!: string;

  @IsUUID()
  substationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}


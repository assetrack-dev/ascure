import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateInspectionDto {
  @IsUUID()
  siteVisitId!: string;

  @IsUUID()
  assetId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  inspectionCycle?: number;
}


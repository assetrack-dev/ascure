import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateTemplateSectionDto {
  @IsString()
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsInt()
  @Min(1)
  sortOrder!: number;
}

export class UpdateTemplateSectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  sortOrder?: number;
}

import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CommitSavrKlbDto {
  @IsString()
  @MaxLength(120)
  batchId!: string;

  // Multipart form fields arrive as strings; coerce "true"/"false".
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  strict?: boolean;

  // Optional JSON array string: [{ "email": "...", "userId": "uuid" }]
  @IsOptional()
  @IsString()
  userResolutionsJson?: string;
}

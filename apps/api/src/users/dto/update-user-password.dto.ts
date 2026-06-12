import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateUserPasswordDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}

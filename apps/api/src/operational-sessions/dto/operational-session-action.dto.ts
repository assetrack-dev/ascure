import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class OperationalSessionActionDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string | null;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;
}

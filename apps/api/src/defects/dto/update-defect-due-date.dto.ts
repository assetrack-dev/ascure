import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

const normalizeNullableString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();

  return trimmedValue ? trimmedValue : null;
};

export class UpdateDefectDueDateDto {
  @Transform(normalizeNullableString)
  @IsOptional()
  @IsString()
  dueDate?: string | null;
}

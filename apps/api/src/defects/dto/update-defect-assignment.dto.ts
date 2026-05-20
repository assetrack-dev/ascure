import { Transform } from 'class-transformer';
import { IsOptional, IsUUID } from 'class-validator';

const normalizeNullableString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();

  return trimmedValue ? trimmedValue : null;
};

export class UpdateDefectAssignmentDto {
  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  assignedUserId?: string | null;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  assignedTeamId?: string | null;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  assignedToUserId?: string | null;

  @Transform(normalizeNullableString)
  @IsOptional()
  @IsUUID()
  assignedToTeamId?: string | null;
}

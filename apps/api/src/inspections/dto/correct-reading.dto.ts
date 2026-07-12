import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID } from 'class-validator';

const trimOrEmpty = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value);

/**
 * In-place DC correction of a recorded checklist reading (currently the
 * BACAAN KELEGAAN 1 / Smart-Sensor value). `value` is free text: a numeric
 * string routes to valueNumber, a non-numeric one (e.g. the "LO" below-range
 * sentinel) to valueText, and an empty string clears the recorded value.
 */
export class CorrectReadingDto {
  @Transform(trimOrEmpty)
  @IsOptional()
  @IsString()
  value?: string;

  // The visit being viewed. The server rejects a correction whose inspection
  // belongs to a different survey cycle (a re-surveyed pole's latest reading).
  @IsOptional()
  @IsUUID()
  siteVisitId?: string;
}

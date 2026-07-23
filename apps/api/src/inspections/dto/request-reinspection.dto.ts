import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Send one pole back for re-inspection. The reason is REQUIRED — it is what the
 * crew sees when they reopen the pole, and the record of why the office
 * challenged the data. A flag with no explanation is just a mystery on the map.
 */
export class RequestReinspectionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'A reason is required so the crew knows what to re-do.' })
  @MaxLength(500)
  reason!: string;
}

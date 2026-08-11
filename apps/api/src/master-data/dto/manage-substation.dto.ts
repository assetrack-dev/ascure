import {
  IsBoolean,
  IsBooleanString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class ListSubstationsQueryDto {
  @IsOptional()
  @IsBooleanString()
  includeInactive?: string;
}

export class SubstationIdParamDto {
  @IsUUID()
  id!: string;
}

export class UpdateSubstationStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

export class UpdateSubstationDetailsDto {
  // Display name (operational text — the service uppercases it the same way the
  // check-in create flow does). Omit to leave unchanged.
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  // Functional location / alamat operasi. `null` or blank clears it.
  @ValidateIf((dto: UpdateSubstationDetailsDto) => dto.location !== null)
  @IsOptional()
  @IsString()
  @MaxLength(240)
  location?: string | null;

  // Manual coordinate pair. Both numbers = pin the Pencawang there (wins over
  // check-in-derived); both null = clear the manual pin (revert to derived);
  // both omitted = untouched. The service rejects a half-set pair.
  @ValidateIf((dto: UpdateSubstationDetailsDto) => dto.latitude !== null)
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ValidateIf((dto: UpdateSubstationDetailsDto) => dto.longitude !== null)
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;
}

export class AssignSubstationMainheadDto {
  // `null` clears the link (Pencawang becomes Unassigned on the map); a UUID
  // assigns it to that MAINHEAD. The `null` case skips UUID validation.
  @ValidateIf((dto: AssignSubstationMainheadDto) => dto.mainheadId !== null)
  @IsUUID()
  mainheadId!: string | null;
}

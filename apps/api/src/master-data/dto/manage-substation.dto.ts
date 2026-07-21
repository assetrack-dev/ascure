import {
  IsBoolean,
  IsBooleanString,
  IsOptional,
  IsUUID,
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

export class AssignSubstationMainheadDto {
  // `null` clears the link (Pencawang becomes Unassigned on the map); a UUID
  // assigns it to that MAINHEAD. The `null` case skips UUID validation.
  @ValidateIf((dto: AssignSubstationMainheadDto) => dto.mainheadId !== null)
  @IsUUID()
  mainheadId!: string | null;
}

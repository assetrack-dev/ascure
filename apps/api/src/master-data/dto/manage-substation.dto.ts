import {
  IsBoolean,
  IsBooleanString,
  IsOptional,
  IsUUID,
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

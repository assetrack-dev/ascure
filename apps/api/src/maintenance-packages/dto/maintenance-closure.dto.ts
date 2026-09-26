import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const VERIFICATION_TABS = ['PENDING', 'CANNOT_REPAIR', 'CLOSED'] as const;
export type VerificationTab = (typeof VERIFICATION_TABS)[number];

export class VerificationQueueQueryDto {
  @IsOptional()
  @IsIn(VERIFICATION_TABS)
  tab?: VerificationTab;
}

export class VerifyRepairDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** Reject / re-open / reassign always need a reason the crew can act on. */
export class RepairReasonDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class ReassignCannotRepairDto extends RepairReasonDto {
  @IsUUID()
  maintenanceOrganizationId!: string;
}


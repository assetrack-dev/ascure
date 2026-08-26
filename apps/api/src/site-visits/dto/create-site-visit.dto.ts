import {
  OperationMode,
  OperationalDomain,
  OperationalScope,
  SessionKind,
  SiteVisitType,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { isStandaloneScope } from '../../common/operational-scope';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSiteVisitDto {
  @IsUUID()
  teamId!: string;

  @IsOptional()
  @IsUUID()
  substationId?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Required for the network surveys (SAVR/SAVT) — the Mainhead drives the
   *  hierarchical map, client scoping and billing. A STANDALONE equipment
   *  survey (Pencawang / FP / LB / CB scope) may omit it: there is no check-in
   *  ceremony to pick one in. */
  @ValidateIf(
    (dto: CreateSiteVisitDto) =>
      !isStandaloneScope(dto.operationalScope ?? null) ||
      dto.mainheadId !== undefined,
  )
  @IsUUID()
  mainheadId!: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  workPackageId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'OPEN', 'IN_PROGRESS'])
  status?: 'ACTIVE' | 'OPEN' | 'IN_PROGRESS';

  @IsOptional()
  @IsInt()
  @Min(1)
  cycleNumber?: number;

  @IsOptional()
  @IsIn(Object.values(SiteVisitType))
  visitType?: SiteVisitType;

  @IsOptional()
  @IsEnum(OperationalDomain)
  operationalDomain?: OperationalDomain;

  @IsOptional()
  @IsEnum(OperationMode)
  operationMode?: OperationMode;

  @IsOptional()
  @IsEnum(OperationalScope)
  operationalScope?: OperationalScope;

  @IsOptional()
  @IsEnum(SessionKind)
  sessionKind?: SessionKind;

  @IsOptional()
  @IsUUID()
  fromPencawangId?: string;

  @IsOptional()
  @IsUUID()
  toPencawangId?: string;

  // SAVT "New To" — when the route's destination Pencawang isn't in the system
  // yet, the mobile sends a name + code instead of toPencawangId; the server
  // creates (or reuses) the destination Substation and links it.
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  toPencawangName?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  toPencawangCode?: string;

  // SAVT route line code ("KOD TIANG", e.g. "MI - KUK") — set once at check-in
  // for a SAVT/ROUTE visit and inherited by every pole on the route.
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  routeCode?: string;

  @IsOptional()
  @IsBoolean()
  requiresQAQC?: boolean;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reportingGroup?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mainhead?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  pencawangCode?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  pencawangName?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  functionalLocation?: string;

  @IsOptional()
  @IsLatitude()
  checkInLatitude?: number;

  @IsOptional()
  @IsLongitude()
  checkInLongitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  checkInAccuracyMeters?: number;

  @IsOptional()
  @IsDateString()
  checkInCapturedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MaintenanceCategory } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { AddMaintenanceFindingDto } from './dto/maintenance-finding.dto';
import { MaintenanceWorkService } from './maintenance-work.service';

class RelabelEvidenceDto {
  @IsIn(['BEFORE', 'DURING', 'AFTER', 'before', 'during', 'after'])
  evidenceType!: string;
}

class SetRepairMethodDto {
  /** null clears it. */
  @ValidateIf((dto: SetRepairMethodDto) => dto.repairMethodId !== null)
  @IsUUID()
  repairMethodId!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

class SetNoTiangLamaDto {
  @ValidateIf((dto: SetNoTiangLamaDto) => dto.noTiangLama !== null)
  @IsString()
  @MaxLength(60)
  noTiangLama!: string | null;
}

class RepairMethodsQueryDto {
  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory;
}

/**
 * The contractor crew's work list for the mobile maintenance mode
 * (docs/PLAN-maintenance-flow.md §7.1). Repair photos and completion go
 * through the existing /defects endpoints; the one write here is adding a
 * Kejanggalan that was not in the survey (§13).
 */
@UseGuards(JwtAuthGuard)
@Controller('maintenance-work')
export class MaintenanceWorkController {
  constructor(private readonly work: MaintenanceWorkService) {}

  @Get()
  listPackages(@CurrentUser() user: RequestUser) {
    return this.work.listPackages(user);
  }

  // ── Plan §20 — declared before ':siteVisitId' so they are not shadowed ──

  /** The active kinds of repair (Rentis: KAEDAH LAZIM …) — any signed-in user. */
  @Get('repair-methods')
  repairMethods(@Query() query: RepairMethodsQueryDto) {
    return this.work.listRepairMethods(query.category);
  }

  /** Delete a repair photo until TNB verifies (it is archived, never lost). */
  @Delete('evidence/:imageId')
  deleteEvidence(
    @CurrentUser() user: RequestUser,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.work.deleteEvidenceImage(user, imageId);
  }

  /** Fix a repair photo's stage (Before / During / After). */
  @Patch('evidence/:imageId')
  relabelEvidence(
    @CurrentUser() user: RequestUser,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: RelabelEvidenceDto,
  ) {
    return this.work.relabelEvidenceImage(user, imageId, dto.evidenceType);
  }

  /** Set / correct the kind of repair done. */
  @Patch('defects/:defectId/repair-method')
  setRepairMethod(
    @CurrentUser() user: RequestUser,
    @Param('defectId', ParseUUIDPipe) defectId: string,
    @Body() dto: SetRepairMethodDto,
  ) {
    return this.work.setRepairMethod(user, defectId, dto.repairMethodId, dto.note);
  }

  /** Correct a pole's No Tiang Lama on site (logged). */
  @Patch('poles/:assetId/no-tiang-lama')
  setNoTiangLama(
    @CurrentUser() user: RequestUser,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() dto: SetNoTiangLamaDto,
  ) {
    return this.work.setNoTiangLama(user, assetId, dto.noTiangLama);
  }

  @Get(':siteVisitId')
  getPackage(
    @CurrentUser() user: RequestUser,
    @Param('siteVisitId', ParseUUIDPipe) siteVisitId: string,
  ) {
    return this.work.getPackage(user, siteVisitId);
  }

  @Post(':siteVisitId/findings')
  addFinding(
    @CurrentUser() user: RequestUser,
    @Param('siteVisitId', ParseUUIDPipe) siteVisitId: string,
    @Body() dto: AddMaintenanceFindingDto,
  ) {
    return this.work.addFinding(user, siteVisitId, dto);
  }
}

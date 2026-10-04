import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IMAGE_UPLOAD_OPTIONS } from '../common/upload-options';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import {
  AssignEmergencyDto,
  AssignMaintenancePackageDto,
  AssignPolesDto,
  BulkAssignMaintenancePackagesDto,
  ClearPolesDto,
} from './dto/assign-maintenance-package.dto';
import { AddMaintenanceFindingDto } from './dto/maintenance-finding.dto';
import { MaintenancePackagesService } from './maintenance-packages.service';

/**
 * TNB → maintenance company hand-off of surveyed Pencawang
 * (docs/PLAN-maintenance-flow.md §5, §12). ADMIN, TNB and Main Contractor
 * managers; the service enforces rank (FOREMAN / TECHNICIAN assign, ENGINEER
 * views), Mainhead scope and the MC's own group.
 */
@UseGuards(JwtAuthGuard)
@Controller('maintenance-packages')
export class MaintenancePackagesController {
  constructor(private readonly packages: MaintenancePackagesService) {}

  @Get('board')
  getBoard(@CurrentUser() user: RequestUser) {
    return this.packages.getBoard(user);
  }

  @Post()
  assign(@CurrentUser() user: RequestUser, @Body() dto: AssignMaintenancePackageDto) {
    return this.packages.assign(user, dto);
  }

  @Post('bulk')
  assignBulk(@CurrentUser() user: RequestUser, @Body() dto: BulkAssignMaintenancePackagesDto) {
    return this.packages.assignBulk(user, dto);
  }

  // Plan §12.6 — split a Pencawang between crews pole by pole.
  @Get(':siteVisitId/poles')
  getPoles(
    @CurrentUser() user: RequestUser,
    @Param('siteVisitId', ParseUUIDPipe) siteVisitId: string,
  ) {
    return this.packages.getPoles(user, siteVisitId);
  }

  @Post(':siteVisitId/poles')
  assignPoles(
    @CurrentUser() user: RequestUser,
    @Param('siteVisitId', ParseUUIDPipe) siteVisitId: string,
    @Body() dto: AssignPolesDto,
  ) {
    return this.packages.assignPoles(user, siteVisitId, dto);
  }

  @Post(':siteVisitId/poles/clear')
  clearPoles(
    @CurrentUser() user: RequestUser,
    @Param('siteVisitId', ParseUUIDPipe) siteVisitId: string,
    @Body() dto: ClearPolesDto,
  ) {
    return this.packages.clearPoles(user, siteVisitId, dto);
  }

  @Delete(':id')
  unassign(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.packages.unassign(user, id);
  }

  @Post('emergencies/:defectId')
  assignEmergency(
    @CurrentUser() user: RequestUser,
    @Param('defectId', ParseUUIDPipe) defectId: string,
    @Body() dto: AssignEmergencyDto,
  ) {
    return this.packages.assignEmergency(user, defectId, dto);
  }

  /** §13: the PE's surveyed poles + the checklist items a new finding can use. */
  @Get(':siteVisitId/finding-options')
  getFindingOptions(
    @CurrentUser() user: RequestUser,
    @Param('siteVisitId', ParseUUIDPipe) siteVisitId: string,
  ) {
    return this.packages.getFindingOptions(user, siteVisitId);
  }

  /** §13: the office adds a Kejanggalan that was not in the survey, with its condition photo. */
  @Post(':siteVisitId/findings')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  addFinding(
    @CurrentUser() user: RequestUser,
    @Param('siteVisitId', ParseUUIDPipe) siteVisitId: string,
    @Body() dto: AddMaintenanceFindingDto,
    @UploadedFile()
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
  ) {
    return this.packages.addFinding(user, siteVisitId, dto, file);
  }
}

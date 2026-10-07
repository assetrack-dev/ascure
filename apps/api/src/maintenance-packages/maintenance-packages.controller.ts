import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createReadStream } from 'fs';
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
import { RepairReportQueryDto, RepairReportZipDto } from './dto/repair-report.dto';
import { MaintenancePackagesService } from './maintenance-packages.service';
import { RepairReportService } from './repair-report.service';

/**
 * TNB → maintenance company hand-off of surveyed Pencawang
 * (docs/PLAN-maintenance-flow.md §5, §12). ADMIN, TNB and Main Contractor
 * managers; the service enforces rank (FOREMAN / TECHNICIAN assign, ENGINEER
 * views), Mainhead scope and the MC's own group.
 */
@UseGuards(JwtAuthGuard)
@Controller('maintenance-packages')
export class MaintenancePackagesController {
  constructor(
    private readonly packages: MaintenancePackagesService,
    private readonly repairReports: RepairReportService,
  ) {}

  // ── Repair report (plan §16): one PDF per Pencawang per company ──────────

  @Get(':siteVisitId/repair-report.pdf')
  async repairReport(
    @CurrentUser() user: RequestUser,
    @Param('siteVisitId', new ParseUUIDPipe()) siteVisitId: string,
    @Query() query: RepairReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.repairReports.generate(user, siteVisitId, query);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return new StreamableFile(buffer);
  }

  /** Many Pencawang → one ZIP, built in the background; poll then download. */
  @Post('repair-reports/jobs')
  startRepairReportZip(@CurrentUser() user: RequestUser, @Body() dto: RepairReportZipDto) {
    return this.repairReports.startZipJob(user, dto.siteVisitIds, dto);
  }

  @Get('repair-reports/jobs/:jobId')
  repairReportZipStatus(
    @CurrentUser() user: RequestUser,
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
  ) {
    return this.repairReports.getZipJobStatus(user, jobId);
  }

  @Get('repair-reports/jobs/:jobId/download.zip')
  downloadRepairReportZip(
    @CurrentUser() user: RequestUser,
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const { filePath, fileName } = this.repairReports.getZipFile(user, jobId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return new StreamableFile(createReadStream(filePath));
  }

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

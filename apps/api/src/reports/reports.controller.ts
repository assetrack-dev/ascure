import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { OperationalScope, SurveyLifecycleStatus } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PencawangReportParamsDto } from './dto/pencawang-report-params.dto';
import { ReportsService } from './reports.service';
import { SchematicPdfService } from './schematic-pdf.service';

/** Map a `status` query value to a lifecycle status; unknown/empty = no filter. */
function parseLifecycleStatus(
  value: string | undefined,
): SurveyLifecycleStatus | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toUpperCase();
  return (Object.values(SurveyLifecycleStatus) as string[]).includes(normalized)
    ? (normalized as SurveyLifecycleStatus)
    : undefined;
}

/** Map a `scope` query value to an operational scope; default SAVR. The report
 *  UI only offers the two network survey scopes (SAVR / SAVT). */
function parseScope(value: string | undefined): OperationalScope {
  return value?.toUpperCase() === OperationalScope.SAVT
    ? OperationalScope.SAVT
    : OperationalScope.SAVR;
}

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly schematicPdfService: SchematicPdfService,
  ) {}

  @Get('substations')
  listSubstations(@CurrentUser() user: RequestUser) {
    return this.reportsService.listSubstations(user);
  }

  // DC master reference: every accessible Pencawang (id, code, name, Functional
  // Location, lat/long) as a downloadable .xlsx. Blank lat/long = never visited.
  @Get('pencawang-list.xlsx')
  async exportPencawangList(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.reportsService.buildPencawangList(user);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    return new StreamableFile(buffer);
  }

  // Per-user output for a period (default: this month) — the manager's monitor
  // + pay view. JSON for the table; .xlsx for the downloadable pay sheet.
  @Get('crew-performance')
  getCrewPerformance(
    @CurrentUser() user: RequestUser,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ) {
    return this.reportsService.aggregateCrewPerformance(user, from, to);
  }

  @Get('crew-performance.xlsx')
  async exportCrewPerformance(
    @CurrentUser() user: RequestUser,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.reportsService.buildCrewPerformance(
      user,
      from,
      to,
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    return new StreamableFile(buffer);
  }

  @Get('pencawang/:substationId/masterlist.xlsx')
  async exportPencawangMasterlist(
    @CurrentUser() user: RequestUser,
    @Param() params: PencawangReportParamsDto,
    @Query('status') status: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } =
      await this.reportsService.buildPencawangMasterlist(
        user,
        params.substationId,
        parseLifecycleStatus(status),
      );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    return new StreamableFile(buffer);
  }

  @Get('pencawang/:substationId/template-masterlist.xlsx')
  async exportPencawangTemplateMasterlist(
    @CurrentUser() user: RequestUser,
    @Param() params: PencawangReportParamsDto,
    @Query('status') status: string | undefined,
    @Query('scope') scope: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } =
      await this.reportsService.buildPencawangTemplateMasterlist(
        user,
        params.substationId,
        parseLifecycleStatus(status),
        parseScope(scope),
      );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    return new StreamableFile(buffer);
  }

  @Get('savt-routes')
  listSavtRoutes(@CurrentUser() user: RequestUser) {
    return this.reportsService.listSavtRoutes(user);
  }

  @Get('savt-route/checklist.xlsx')
  async exportSavtRouteChecklist(
    @CurrentUser() user: RequestUser,
    @Query('routeCode') routeCode: string | undefined,
    @Query('status') status: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } =
      await this.reportsService.buildSavtRouteChecklist(
        user,
        routeCode ?? '',
        parseLifecycleStatus(status),
      );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    return new StreamableFile(buffer);
  }

  /**
   * Bulk "Download Checklist" — every pole across the current filter merged into
   * one sheet. `scope=SAVT` exports all routes; otherwise all SAVR Pencawang in
   * the given `mainhead` (omitted/ALL = every mainhead). `status` filters by
   * lifecycle.
   */
  @Get('bulk-checklist.xlsx')
  async exportBulkChecklist(
    @CurrentUser() user: RequestUser,
    @Query('scope') scope: string | undefined,
    @Query('mainhead') mainhead: string | undefined,
    @Query('status') status: string | undefined,
    @Query('ids') ids: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const lifecycleStatus = parseLifecycleStatus(status);
    // Comma-separated selected keys — substation ids (SAVR) or route codes (SAVT).
    const selected = (ids ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const { buffer, filename } =
      parseScope(scope) === OperationalScope.SAVT
        ? await this.reportsService.buildBulkSavtChecklist(
            user,
            lifecycleStatus,
            selected,
          )
        : await this.reportsService.buildBulkPencawangChecklist(
            user,
            mainhead,
            lifecycleStatus,
            selected,
          );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    return new StreamableFile(buffer);
  }

  @Get('pencawang/:substationId/inspections.xlsx')
  async exportPencawangInspections(
    @CurrentUser() user: RequestUser,
    @Param() params: PencawangReportParamsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } =
      await this.reportsService.buildPencawangWorkbook(
        user,
        params.substationId,
      );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    // Allow the browser fetch() in admin-web to read the suggested filename.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    return new StreamableFile(buffer);
  }

  @Get('pencawang/:substationId/schematic.pdf')
  async exportPencawangSchematic(
    @CurrentUser() user: RequestUser,
    @Param() params: PencawangReportParamsDto,
    @Query('feederId') feederId: string | undefined,
    @Query('layout') layout: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.schematicPdfService.buildSchematicPdf(
      user,
      params.substationId,
      feederId,
      layout === 'gps' ? 'gps' : 'tree',
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    return new StreamableFile(buffer);
  }
}

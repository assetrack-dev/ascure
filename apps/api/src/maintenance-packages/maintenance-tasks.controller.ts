import { Controller, Get, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import {
  MaintenanceOverviewQueryDto,
  MaintenanceTaskGroupsQueryDto,
  MaintenanceTaskItemsQueryDto,
  TnbPerformanceQueryDto,
} from './dto/maintenance-tasks.dto';
import { RepairReportQueryDto } from './dto/repair-report.dto';
import { MaintenanceTasksService } from './maintenance-tasks.service';

/**
 * Plan §21.2 #4 — "My tasks": where each of the company's routed Kejanggalan
 * stands, grouped by Pencawang + team. Read-only; the service decides scope.
 */
@UseGuards(JwtAuthGuard)
@Controller('maintenance-tasks')
export class MaintenanceTasksController {
  constructor(private readonly tasks: MaintenanceTasksService) {}

  /** Plan §21.2 #3: today's three counts, 30 days of them, work types, teams. */
  @Get('overview')
  getOverview(@CurrentUser() user: RequestUser, @Query() query: MaintenanceOverviewQueryDto) {
    return this.tasks.getOverview(user, query);
  }

  /** Plan §21.2 #5: what a by-date repair ZIP would hold (Pencawang + counts). */
  @Get('report-period')
  getReportPeriod(@CurrentUser() user: RequestUser, @Query() query: RepairReportQueryDto) {
    return this.tasks.periodTargets(user, query);
  }

  /** Plan §21.2 #1: TNB Today — each company's day by work type + 30 days. */
  @Get('tnb/today')
  getTnbToday(@CurrentUser() user: RequestUser, @Query() query: MaintenanceOverviewQueryDto) {
    return this.tasks.getTnbToday(user, query);
  }

  /** Plan §21.2 #2: TNB Performance — company × work type over a period. */
  @Get('tnb/performance')
  getTnbPerformance(@CurrentUser() user: RequestUser, @Query() query: TnbPerformanceQueryDto) {
    return this.tasks.getTnbPerformance(user, query);
  }

  @Get('tnb/performance.xlsx')
  async tnbPerformanceXlsx(
    @CurrentUser() user: RequestUser,
    @Query() query: TnbPerformanceQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.tasks.tnbPerformanceWorkbook(user, query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="prestasi-syarikat-${query.from.slice(0, 10)}_${query.to.slice(0, 10)}.xlsx"`,
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return new StreamableFile(buffer);
  }

  @Get('groups')
  getGroups(@CurrentUser() user: RequestUser, @Query() query: MaintenanceTaskGroupsQueryDto) {
    return this.tasks.getGroups(user, query);
  }

  @Get('items')
  getItems(@CurrentUser() user: RequestUser, @Query() query: MaintenanceTaskItemsQueryDto) {
    return this.tasks.getItems(user, query);
  }
}

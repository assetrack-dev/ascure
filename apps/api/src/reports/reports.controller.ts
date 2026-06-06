import {
  Controller,
  Get,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PencawangReportParamsDto } from './dto/pencawang-report-params.dto';
import { ReportsService } from './reports.service';

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('substations')
  listSubstations(@CurrentUser() user: RequestUser) {
    return this.reportsService.listSubstations(user);
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
}

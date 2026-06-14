import {
  Controller,
  Get,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { ReportGenerationService } from './report-generation.service';

class AssetIdParamDto {
  @IsUUID()
  assetId!: string;
}

class SiteVisitIdParamDto {
  @IsUUID()
  siteVisitId!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class VisualReportsController {
  constructor(
    private readonly reportGenerationService: ReportGenerationService,
  ) {}

  /** On-demand per-asset visual report (reflects amendments until frozen). */
  @Get('asset/:assetId/preview.pdf')
  async assetPreview(
    @CurrentUser() user: RequestUser,
    @Param() params: AssetIdParamDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } =
      await this.reportGenerationService.generateAssetReport(
        user,
        params.assetId,
      );
    this.setPdfHeaders(res, filename);
    return new StreamableFile(buffer);
  }

  /** The frozen, compiled survey report (latest version). */
  @Get('site-visit/:siteVisitId/report.pdf')
  async compiledReport(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } =
      await this.reportGenerationService.getCompiledReport(
        user,
        params.siteVisitId,
      );
    this.setPdfHeaders(res, filename);
    return new StreamableFile(buffer);
  }

  private setPdfHeaders(res: Response, filename: string): void {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Let the admin-web fetch() read the suggested filename.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  }
}

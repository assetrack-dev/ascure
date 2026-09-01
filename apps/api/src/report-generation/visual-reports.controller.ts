import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
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

class BatchSiteVisitsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  siteVisitIds!: string[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse a comma-separated `ids` query into validated UUIDs (capped). */
function parseIdsQuery(raw: string | undefined, cap: number): string[] {
  const ids = (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    throw new BadRequestException('ids query parameter is required.');
  }
  if (ids.length > cap) {
    throw new BadRequestException(`At most ${cap} ids per request.`);
  }
  for (const id of ids) {
    if (!UUID_PATTERN.test(id)) {
      throw new BadRequestException(`"${id}" is not a valid id.`);
    }
  }
  return ids;
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

  /** On-demand compact defect report (Laporan Kejanggalan): only the poles
   *  with live defects, colour-coded A/B/C categories + photos, ~3 poles per
   *  page — the handover format the maintenance team receives. Never frozen:
   *  always reflects current data. */
  @Get('site-visit/:siteVisitId/defect-report.pdf')
  async defectReport(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } =
      await this.reportGenerationService.generateDefectReport(
        user,
        params.siteVisitId,
      );
    this.setPdfHeaders(res, filename);
    return new StreamableFile(buffer);
  }

  /** The frozen, compiled survey report (latest version). `?part=n` selects a
   *  volume (Jilid) when the survey compiled into several. */
  @Get('site-visit/:siteVisitId/report.pdf')
  async compiledReport(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
    @Res({ passthrough: true }) res: Response,
    @Query('part') partRaw?: string,
  ): Promise<StreamableFile> {
    let part: number | undefined;
    if (partRaw !== undefined && partRaw !== '') {
      part = Number(partRaw);
      if (!Number.isInteger(part) || part < 1 || part > 100) {
        throw new BadRequestException('part must be an integer between 1 and 100.');
      }
    }
    const { buffer, filename } =
      await this.reportGenerationService.getCompiledReport(
        user,
        params.siteVisitId,
        part,
      );
    this.setPdfHeaders(res, filename);
    return new StreamableFile(buffer);
  }

  /** Queue compiles for several surveys; they run one at a time in the
   *  background. Returns which were accepted and which skipped (with reason). */
  @Post('batch-generate')
  batchGenerate(@CurrentUser() user: RequestUser, @Body() dto: BatchSiteVisitsDto) {
    return this.reportGenerationService.startBatchCompile(
      user,
      dto.siteVisitIds,
    );
  }

  /** One poll for a whole selection: latest run + latest compiled version per
   *  visit. `ids` is comma-separated. */
  @Get('batch-status')
  batchStatus(@CurrentUser() user: RequestUser, @Query('ids') ids?: string) {
    return this.reportGenerationService.getBatchStatus(
      user,
      parseIdsQuery(ids, 50),
    );
  }

  /** Stream the latest compiled report of each selected visit as ONE ZIP
   *  (SENARAI.txt inside lists what was included/missing). */
  @Get('batch-download.zip')
  async batchDownload(
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
    @Query('ids') ids?: string,
  ): Promise<void> {
    const { archive, fileName } =
      await this.reportGenerationService.createBatchZip(
        user,
        parseIdsQuery(ids, 20),
      );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    archive.on('error', (error) => {
      // Headers are already gone — all we can do is cut the stream so the
      // client sees a failed download instead of a silently truncated ZIP.
      res.destroy(error);
    });
    archive.pipe(res);
    await archive.finalize();
  }

  /** Progress of the (background) report compile + the latest version's volume
   *  list — the admin visit page polls this after pressing Generate. */
  @Get('site-visit/:siteVisitId/report-status')
  reportStatus(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
  ) {
    return this.reportGenerationService.getCompileStatus(
      user,
      params.siteVisitId,
    );
  }

  private setPdfHeaders(res: Response, filename: string): void {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Let the admin-web fetch() read the suggested filename.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  }
}

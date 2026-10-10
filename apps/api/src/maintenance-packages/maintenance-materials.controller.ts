import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { SetDefectMaterialsDto } from './dto/defect-materials.dto';
import { MaintenanceMaterialsService } from './maintenance-materials.service';

/** TNB material list + materials used per repaired Kejanggalan (TNB feedback #1). */
@UseGuards(JwtAuthGuard)
@Controller('maintenance-materials')
export class MaintenanceMaterialsController {
  constructor(private readonly materials: MaintenanceMaterialsService) {}

  /** The active TNB material list (catalogue no., description, unit). */
  @Get('catalog')
  catalog() {
    return this.materials.catalog();
  }

  /**
   * The claim summary (Excel): per Pencawang, per-period total and per
   * Kejanggalan, for Kejanggalan repaired between `from` and `to` (MYT dates).
   */
  @Get('summary.xlsx')
  async summary(
    @CurrentUser() user: RequestUser,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('organizationId') organizationId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.materials.buildSummary(user, { from, to, organizationId });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return new StreamableFile(buffer);
  }

  /** Replace the materials of one Kejanggalan (an empty list clears them). */
  @Put('defects/:defectId')
  setDefectMaterials(
    @CurrentUser() user: RequestUser,
    @Param('defectId', ParseUUIDPipe) defectId: string,
    @Body() dto: SetDefectMaterialsDto,
  ) {
    return this.materials.setDefectMaterials(user, defectId, dto.items);
  }
}

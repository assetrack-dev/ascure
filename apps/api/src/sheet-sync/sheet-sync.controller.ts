import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { SheetSyncService } from './sheet-sync.service';

class CreateSheetSyncTargetDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  /** The sheet link or its id. */
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  spreadsheet!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sheetTitle?: string;
}

class UpdateSheetSyncTargetDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sheetTitle?: string;

  @IsOptional()
  @IsBoolean()
  writeEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class StartSheetSyncRunDto {
  @IsBoolean()
  dryRun!: boolean;
}

/**
 * ADMIN: the Google Sheets ASCURE fills nightly with verified repair dates
 * (docs/PLAN-google-sheet-repair-sync.md), their runs and check lists.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('sheet-sync')
export class SheetSyncController {
  constructor(private readonly sheetSync: SheetSyncService) {}

  @Get('targets')
  targets(@CurrentUser() user: RequestUser) {
    return this.sheetSync.listTargets(user.tenantId);
  }

  @Post('targets')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateSheetSyncTargetDto) {
    return this.sheetSync.createTarget(user.tenantId, dto);
  }

  @Patch('targets/:id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSheetSyncTargetDto,
  ) {
    return this.sheetSync.updateTarget(user.tenantId, id, dto);
  }

  @Get('targets/:id/runs')
  runs(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sheetSync.listRuns(user.tenantId, id);
  }

  @Post('targets/:id/run')
  run(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartSheetSyncRunDto,
  ) {
    return this.sheetSync.startRun(user.tenantId, id, dto.dryRun, user.email);
  }

  @Get('runs/:id')
  runDetail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sheetSync.getRun(user.tenantId, id);
  }

  @Get('runs/:id/check-list.xlsx')
  async checkList(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.sheetSync.issuesWorkbook(user.tenantId, id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return new StreamableFile(buffer);
  }
}

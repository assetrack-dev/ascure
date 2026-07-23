import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { ClientProgressService } from './client-progress.service';

class ProgressQueryDto {
  /** Drill into one Mainhead's Pencawang. Omit for the Mainhead roll-up. */
  @IsOptional()
  @IsUUID()
  mainheadId?: string;
}

class SubstationParamDto {
  @IsUUID()
  substationId!: string;
}

class AssetParamDto {
  @IsUUID()
  assetId!: string;
}

/**
 * The network owner's (TNB / CLIENT) read-only progress view. Every route is
 * scoped by the caller's organization → assigned MAINHEADs and rejects a
 * non-client caller; ADMIN passes through unscoped so the team can preview
 * exactly what the client sees.
 */
@UseGuards(JwtAuthGuard)
@Controller('client')
export class ClientController {
  constructor(private readonly clientProgress: ClientProgressService) {}

  @Get('progress')
  getProgress(@CurrentUser() user: RequestUser, @Query() query: ProgressQueryDto) {
    return this.clientProgress.getProgress(user, query.mainheadId);
  }

  @Get('mainheads')
  listMainheads(@CurrentUser() user: RequestUser) {
    return this.clientProgress.listMainheads(user);
  }

  @Get('surveys')
  listRecentSurveys(@CurrentUser() user: RequestUser) {
    return this.clientProgress.listRecentSurveys(user);
  }

  @Get('pencawang/:substationId/poles')
  listPoles(@CurrentUser() user: RequestUser, @Param() params: SubstationParamDto) {
    return this.clientProgress.listPoles(user, params.substationId);
  }

  /** Evidence gate — 403s unless the pole is in scope AND its survey has left
   *  the field. The client UI calls this before opening the asset detail. */
  @Get('poles/:assetId/access')
  async checkPoleAccess(
    @CurrentUser() user: RequestUser,
    @Param() params: AssetParamDto,
  ) {
    await this.clientProgress.assertPoleVisible(user, params.assetId);
    return { ok: true };
  }
}

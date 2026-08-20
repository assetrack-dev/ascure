import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateTieEdgeDto } from './dto/create-tie-edge.dto';
import { UpdateTieEdgeStateDto } from './dto/update-tie-edge-state.dto';
import { NetworkService } from './network.service';

class SubstationIdParamDto {
  @IsUUID()
  substationId!: string;
}

class AssetIdParamDto {
  @IsUUID()
  assetId!: string;
}

class FeederIdParamDto {
  @IsUUID()
  feederId!: string;
}

class TieEdgeIdParamDto {
  @IsUUID()
  id!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('network')
export class NetworkController {
  constructor(private readonly networkService: NetworkService) {}

  /** GET /api/v1/network/substations/:substationId — the Pencawang's graph. */
  @Get('substations/:substationId')
  getSubstationNetwork(
    @CurrentUser() user: RequestUser,
    @Param() params: SubstationIdParamDto,
  ) {
    return this.networkService.getSubstationNetwork(user, params.substationId);
  }

  /** GET /api/v1/network/substations/:substationId/route-drawing — the graph
   *  plus per-pole drawing attributes (cables, stays, services, defects) for
   *  the TNB-style Lukisan Laluan. */
  @Get('substations/:substationId/route-drawing')
  getRouteDrawing(
    @CurrentUser() user: RequestUser,
    @Param() params: SubstationIdParamDto,
  ) {
    return this.networkService.getRouteDrawing(user, params.substationId);
  }

  /** GET /api/v1/network/assets/:assetId/downstream — radial isolation set. */
  @Get('assets/:assetId/downstream')
  getDownstream(@CurrentUser() user: RequestUser, @Param() params: AssetIdParamDto) {
    return this.networkService.getDownstream(user, params.assetId);
  }

  /** GET /api/v1/network/feeders/:feederId/isolation — feeder isolation + back-feed. */
  @Get('feeders/:feederId/isolation')
  getFeederIsolation(@CurrentUser() user: RequestUser, @Param() params: FeederIdParamDto) {
    return this.networkService.getFeederIsolation(user, params.feederId);
  }

  /** POST /api/v1/network/tie-edges — capture a NOP (or other) tie-edge. */
  @Post('tie-edges')
  createTieEdge(@CurrentUser() user: RequestUser, @Body() dto: CreateTieEdgeDto) {
    return this.networkService.createTieEdge(user, dto);
  }

  /** PATCH /api/v1/network/tie-edges/:id/state — open / close a tie-edge. */
  @Patch('tie-edges/:id/state')
  setTieEdgeState(
    @CurrentUser() user: RequestUser,
    @Param() params: TieEdgeIdParamDto,
    @Body() dto: UpdateTieEdgeStateDto,
  ) {
    return this.networkService.setTieEdgeState(user, params.id, dto.switchState);
  }
}

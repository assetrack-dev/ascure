import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { NetworkService } from './network.service';

class SubstationIdParamDto {
  @IsUUID()
  substationId!: string;
}

class AssetIdParamDto {
  @IsUUID()
  assetId!: string;
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

  /** GET /api/v1/network/assets/:assetId/downstream — radial isolation set. */
  @Get('assets/:assetId/downstream')
  getDownstream(@CurrentUser() user: RequestUser, @Param() params: AssetIdParamDto) {
    return this.networkService.getDownstream(user, params.assetId);
  }
}

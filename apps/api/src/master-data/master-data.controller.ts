import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { ListAssetsQueryDto } from './dto/list-assets-query.dto';
import { MasterDataService } from './master-data.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  @Get('substations')
  listSubstations(@CurrentUser() user: RequestUser) {
    return this.masterDataService.listSubstations(user);
  }

  @Get('asset-types')
  listAssetTypes(@CurrentUser() user: RequestUser) {
    return this.masterDataService.listAssetTypes(user);
  }

  @Get('assets')
  listAssets(@CurrentUser() user: RequestUser, @Query() query: ListAssetsQueryDto) {
    return this.masterDataService.listAssets(user, query.substation_id);
  }
}


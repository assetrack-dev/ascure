import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { ListAssetsQueryDto } from './dto/list-assets-query.dto';
import {
  AssetTypeIdParamDto,
  CreateAssetTypeDto,
  ListAssetTypesQueryDto,
  UpdateAssetTypeDto,
  UpdateAssetTypeStatusDto,
} from './dto/manage-asset-type.dto';
import { MasterDataService } from './master-data.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  @Get('substations')
  listSubstations(@CurrentUser() user: RequestUser) {
    return this.masterDataService.listSubstations(user);
  }

  @Get('asset-types')
  listAssetTypes(
    @CurrentUser() user: RequestUser,
    @Query() query: ListAssetTypesQueryDto,
  ) {
    return this.masterDataService.listAssetTypes(user, query);
  }

  @Post('asset-types')
  @Roles(UserRole.ADMIN)
  createAssetType(@CurrentUser() user: RequestUser, @Body() dto: CreateAssetTypeDto) {
    return this.masterDataService.createAssetType(user, dto);
  }

  @Get('asset-types/:id')
  getAssetType(@CurrentUser() user: RequestUser, @Param() params: AssetTypeIdParamDto) {
    return this.masterDataService.getAssetType(user, params.id);
  }

  @Patch('asset-types/:id')
  @Roles(UserRole.ADMIN)
  updateAssetType(
    @CurrentUser() user: RequestUser,
    @Param() params: AssetTypeIdParamDto,
    @Body() dto: UpdateAssetTypeDto,
  ) {
    return this.masterDataService.updateAssetType(user, params.id, dto);
  }

  @Patch('asset-types/:id/status')
  @Roles(UserRole.ADMIN)
  updateAssetTypeStatus(
    @CurrentUser() user: RequestUser,
    @Param() params: AssetTypeIdParamDto,
    @Body() dto: UpdateAssetTypeStatusDto,
  ) {
    return this.masterDataService.updateAssetTypeStatus(user, params.id, dto);
  }

  @Get('assets')
  listAssets(@CurrentUser() user: RequestUser, @Query() query: ListAssetsQueryDto) {
    return this.masterDataService.listAssets(user, query.substation_id);
  }
}

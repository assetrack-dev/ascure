import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import {
  AssignSubstationMainheadDto,
  ListSubstationsQueryDto,
  SubstationIdParamDto,
  UpdateSubstationDetailsDto,
  UpdateSubstationStatusDto,
} from './dto/manage-substation.dto';
import { MasterDataService } from './master-data.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  @Get('substations')
  listSubstations(
    @CurrentUser() user: RequestUser,
    @Query() query: ListSubstationsQueryDto,
  ) {
    return this.masterDataService.listSubstations(user, {
      includeInactive: query.includeInactive === 'true',
    });
  }

  // Edit a Pencawang's details: name, functional location, and its OWN map
  // coordinate (the manual fix for a mis-pointed check-in). ADMIN anywhere; a
  // MANAGER only for a Pencawang wholly covered by their own company's surveys
  // (same own-company rule as the cascade delete).
  @Patch('substations/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  updateSubstationDetails(
    @CurrentUser() user: RequestUser,
    @Param() params: SubstationIdParamDto,
    @Body() dto: UpdateSubstationDetailsDto,
  ) {
    return this.masterDataService.updateSubstationDetails(user, params.id, dto);
  }

  @Patch('substations/:id/status')
  @Roles(UserRole.ADMIN)
  updateSubstationStatus(
    @CurrentUser() user: RequestUser,
    @Param() params: SubstationIdParamDto,
    @Body() dto: UpdateSubstationStatusDto,
  ) {
    return this.masterDataService.updateSubstationStatus(
      user,
      params.id,
      dto.isActive,
    );
  }

  @Patch('substations/:id/mainhead')
  @Roles(UserRole.ADMIN)
  assignSubstationMainhead(
    @CurrentUser() user: RequestUser,
    @Param() params: SubstationIdParamDto,
    @Body() dto: AssignSubstationMainheadDto,
  ) {
    return this.masterDataService.assignSubstationMainhead(
      user,
      params.id,
      dto.mainheadId,
    );
  }

  @Delete('substations/:id')
  @Roles(UserRole.ADMIN)
  deleteSubstation(
    @CurrentUser() user: RequestUser,
    @Param() params: SubstationIdParamDto,
  ) {
    return this.masterDataService.deleteSubstation(user, params.id);
  }

  // --- ADMIN-only: cascade-delete a whole Pencawang. Owner decision
  // 2026-08-11: managers EDIT (own company, PATCH above) but never delete —
  // this used to also allow an own-company MANAGER. ---

  @Get('substations/:id/delete-preview')
  @Roles(UserRole.ADMIN)
  previewDeletePencawang(
    @CurrentUser() user: RequestUser,
    @Param() params: SubstationIdParamDto,
  ) {
    return this.masterDataService.previewDeletePencawang(user, params.id);
  }

  @Delete('substations/:id/cascade')
  @Roles(UserRole.ADMIN)
  deletePencawangCascade(
    @CurrentUser() user: RequestUser,
    @Param() params: SubstationIdParamDto,
  ) {
    return this.masterDataService.deletePencawangCascade(user, params.id);
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

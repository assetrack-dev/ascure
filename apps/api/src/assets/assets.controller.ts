import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { UpdateAssetStatusDto } from './dto/update-asset-status.dto';
import { DeleteAssetsDto } from './dto/delete-assets.dto';
import { MapQueryDto } from './dto/map-query.dto';
import { AssetsService } from './assets.service';

class AssetIdParamDto {
  @IsUUID()
  id!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateAssetDto) {
    return this.assetsService.create(user, dto);
  }

  // Declared before `:id` so the literal `map` segment is not matched as an id.
  @Get('map')
  listMap(@CurrentUser() user: RequestUser, @Query() query: MapQueryDto) {
    return this.assetsService.listMap(user, query);
  }

  // Scoped Mainhead + Pencawang options for the map filter dock.
  @Get('map/filter-options')
  mapFilterOptions(@CurrentUser() user: RequestUser) {
    return this.assetsService.mapFilterOptions(user);
  }

  @Get(':id')
  getById(@CurrentUser() user: RequestUser, @Param() params: AssetIdParamDto) {
    return this.assetsService.getById(user, params.id);
  }

  @Get(':id/inspections')
  getInspections(@CurrentUser() user: RequestUser, @Param() params: AssetIdParamDto) {
    return this.assetsService.getInspections(user, params.id);
  }

  @Put(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param() params: AssetIdParamDto,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.assetsService.update(user, params.id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param() params: AssetIdParamDto,
    @Body() dto: UpdateAssetStatusDto,
  ) {
    return this.assetsService.updateStatus(user, params.id, dto);
  }

  @Post('bulk-delete')
  deleteBulk(@CurrentUser() user: RequestUser, @Body() dto: DeleteAssetsDto) {
    return this.assetsService.deleteBulk(user, dto.ids);
  }

  // ADMIN-only bulk wipes — resolve IDs server-side. Declared before `:id` so
  // the literal `by-substation` / `by-session` segments aren't matched as an id.
  @Delete('by-substation/:substationId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  deleteBySubstation(
    @CurrentUser() user: RequestUser,
    @Param('substationId', ParseUUIDPipe) substationId: string,
  ) {
    return this.assetsService.deleteBySubstation(user, substationId);
  }

  @Delete('by-session/:sessionId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  deleteBySession(
    @CurrentUser() user: RequestUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.assetsService.deleteBySession(user, sessionId);
  }

  @Delete(':id')
  delete(@CurrentUser() user: RequestUser, @Param() params: AssetIdParamDto) {
    return this.assetsService.delete(user, params.id);
  }
}

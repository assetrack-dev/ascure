import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { UpdateAssetStatusDto } from './dto/update-asset-status.dto';
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
}

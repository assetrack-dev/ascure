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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { AssignOperationalSessionAssetDto } from './dto/assign-operational-session-asset.dto';
import { BulkAssignOperationalSessionAssetsDto } from './dto/bulk-assign-operational-session-assets.dto';
import { CreateOperationalSessionDto } from './dto/create-operational-session.dto';
import { ListOperationalSessionsQueryDto } from './dto/list-operational-sessions-query.dto';
import { OperationalSessionActionDto } from './dto/operational-session-action.dto';
import { OperationalSessionAssetParamDto } from './dto/operational-session-asset-param.dto';
import { OperationalSessionIdParamDto } from './dto/operational-session-id-param.dto';
import { UpdateOperationalSessionDto } from './dto/update-operational-session.dto';
import { OperationalSessionsService } from './operational-sessions.service';

@UseGuards(JwtAuthGuard)
@Controller('operational-sessions')
export class OperationalSessionsController {
  constructor(
    private readonly operationalSessionsService: OperationalSessionsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListOperationalSessionsQueryDto,
  ) {
    return this.operationalSessionsService.list(user, query);
  }

  @Get(':id/assets')
  listAssets(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionIdParamDto,
  ) {
    return this.operationalSessionsService.listAssets(user, params.id);
  }

  @Get(':id')
  getDetail(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionIdParamDto,
  ) {
    return this.operationalSessionsService.getDetail(user, params.id);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateOperationalSessionDto,
  ) {
    return this.operationalSessionsService.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionIdParamDto,
    @Body() dto: UpdateOperationalSessionDto,
  ) {
    return this.operationalSessionsService.update(user, params.id, dto);
  }

  @Post(':id/assets/bulk')
  bulkAssignAssets(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionIdParamDto,
    @Body() dto: BulkAssignOperationalSessionAssetsDto,
  ) {
    return this.operationalSessionsService.bulkAssignAssets(
      user,
      params.id,
      dto,
    );
  }

  @Post(':id/assets')
  assignAsset(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionIdParamDto,
    @Body() dto: AssignOperationalSessionAssetDto,
  ) {
    return this.operationalSessionsService.assignAsset(user, params.id, dto);
  }

  @Delete(':id/assets/:assetId')
  removeAsset(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionAssetParamDto,
  ) {
    return this.operationalSessionsService.removeAsset(
      user,
      params.id,
      params.assetId,
    );
  }

  @Post(':id/start')
  start(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionIdParamDto,
  ) {
    return this.operationalSessionsService.start(user, params.id);
  }

  @Post(':id/submit')
  submit(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionIdParamDto,
  ) {
    return this.operationalSessionsService.submit(user, params.id);
  }

  @Post(':id/send-to-qa')
  sendToQa(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionIdParamDto,
  ) {
    return this.operationalSessionsService.sendToQa(user, params.id);
  }

  @Post(':id/approve')
  approve(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionIdParamDto,
  ) {
    return this.operationalSessionsService.approve(user, params.id);
  }

  @Post(':id/request-amendment')
  requestAmendment(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionIdParamDto,
    @Body() dto: OperationalSessionActionDto,
  ) {
    return this.operationalSessionsService.requestAmendment(
      user,
      params.id,
      dto,
    );
  }

  @Post(':id/reject')
  reject(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionIdParamDto,
    @Body() dto: OperationalSessionActionDto,
  ) {
    return this.operationalSessionsService.reject(user, params.id, dto);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: RequestUser,
    @Param() params: OperationalSessionIdParamDto,
    @Body() dto: OperationalSessionActionDto,
  ) {
    return this.operationalSessionsService.cancel(user, params.id, dto);
  }
}

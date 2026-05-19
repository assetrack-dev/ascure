import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CancelSiteVisitDto } from './dto/cancel-site-visit.dto';
import { CompleteSiteVisitDto } from './dto/complete-site-visit.dto';
import { CreateSiteVisitDto } from './dto/create-site-visit.dto';
import { LinkSiteVisitAssetDto } from './dto/link-site-visit-asset.dto';
import { ListSiteVisitsQueryDto } from './dto/list-site-visits-query.dto';
import { SiteVisitsService } from './site-visits.service';

class SiteVisitIdParamDto {
  @IsUUID()
  id!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('site-visits')
export class SiteVisitsController {
  constructor(private readonly siteVisitsService: SiteVisitsService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateSiteVisitDto) {
    return this.siteVisitsService.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: RequestUser, @Query() query: ListSiteVisitsQueryDto) {
    return this.siteVisitsService.list(user, query);
  }

  @Post(':id/join')
  join(@CurrentUser() user: RequestUser, @Param() params: SiteVisitIdParamDto) {
    return this.siteVisitsService.join(user, params.id);
  }

  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
    @UploadedFile()
    file:
      | {
          originalname: string;
          mimetype: string;
          size: number;
          buffer: Buffer;
        }
      | undefined,
  ) {
    return this.siteVisitsService.uploadImage(user, params.id, file);
  }

  @Get(':id/assets')
  getAssets(@CurrentUser() user: RequestUser, @Param() params: SiteVisitIdParamDto) {
    return this.siteVisitsService.getAssets(user, params.id);
  }

  @Post(':id/assets')
  linkAsset(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
    @Body() dto: LinkSiteVisitAssetDto,
  ) {
    return this.siteVisitsService.linkAsset(user, params.id, dto);
  }

  @Post(':id/complete')
  complete(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
    @Body() dto: CompleteSiteVisitDto,
  ) {
    return this.siteVisitsService.complete(user, params.id, dto);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
    @Body() dto: CancelSiteVisitDto,
  ) {
    return this.siteVisitsService.cancel(user, params.id, dto);
  }

  @Get(':id')
  getById(@CurrentUser() user: RequestUser, @Param() params: SiteVisitIdParamDto) {
    return this.siteVisitsService.getReadById(user, params.id);
  }
}

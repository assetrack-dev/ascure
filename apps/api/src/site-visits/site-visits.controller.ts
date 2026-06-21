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
import { ReassignSiteVisitDto } from './dto/reassign-site-visit.dto';
import { RequestSurveyAmendmentDto } from './dto/request-amendment.dto';
import { SiteVisitsService } from './site-visits.service';
import { SurveyLifecycleService } from './survey-lifecycle.service';

class SiteVisitIdParamDto {
  @IsUUID()
  id!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('site-visits')
export class SiteVisitsController {
  constructor(
    private readonly siteVisitsService: SiteVisitsService,
    private readonly surveyLifecycleService: SurveyLifecycleService,
  ) {}

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

  @Post(':id/reassign')
  reassign(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
    @Body() dto: ReassignSiteVisitDto,
  ) {
    return this.siteVisitsService.reassign(user, params.id, dto);
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

  // --- Survey lifecycle (north-star §4): DALAM RONDAAN → … → ARKIB ---

  @Post(':id/lifecycle/rondaan-selesai')
  markRondaanSelesai(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
  ) {
    return this.surveyLifecycleService.markRondaanSelesai(user, params.id);
  }

  @Post(':id/lifecycle/manager-approve')
  managerApprove(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
  ) {
    return this.surveyLifecycleService.managerApprove(user, params.id);
  }

  @Post(':id/lifecycle/manager-request-amendment')
  managerRequestAmendment(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
    @Body() dto: RequestSurveyAmendmentDto,
  ) {
    return this.surveyLifecycleService.managerRequestAmendment(
      user,
      params.id,
      dto.remark,
    );
  }

  @Post(':id/lifecycle/request-amendment')
  requestAmendment(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
    @Body() dto: RequestSurveyAmendmentDto,
  ) {
    return this.surveyLifecycleService.requestAmendment(user, params.id, dto.remark);
  }

  @Post(':id/lifecycle/generate-report')
  generateReport(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
  ) {
    return this.surveyLifecycleService.generateReport(user, params.id);
  }

  @Post(':id/lifecycle/archive')
  archive(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
  ) {
    return this.surveyLifecycleService.archive(user, params.id);
  }

  // --- Annual cycle (north-star §2): year-N re-survey + delta ---

  @Post(':id/open-next-cycle')
  openNextCycle(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
  ) {
    return this.siteVisitsService.openNextCycle(user, params.id);
  }

  @Get(':id/cycle-delta')
  getCycleDelta(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
  ) {
    return this.siteVisitsService.getCycleDelta(user, params.id);
  }

  @Get(':id/contributions')
  getContributions(
    @CurrentUser() user: RequestUser,
    @Param() params: SiteVisitIdParamDto,
  ) {
    return this.siteVisitsService.getContributions(user, params.id);
  }

  @Get(':id')
  getById(@CurrentUser() user: RequestUser, @Param() params: SiteVisitIdParamDto) {
    return this.siteVisitsService.getReadById(user, params.id);
  }
}

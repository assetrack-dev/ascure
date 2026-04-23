import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateSiteVisitDto } from './dto/create-site-visit.dto';
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

  @Get(':id')
  getById(@CurrentUser() user: RequestUser, @Param() params: SiteVisitIdParamDto) {
    return this.siteVisitsService.getById(user, params.id);
  }
}


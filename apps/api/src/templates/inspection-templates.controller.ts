import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { ChecklistTemplatesService } from './checklist-templates.service';
import {
  ChecklistTemplateIdParamDto,
  CreateChecklistTemplateDto,
  ResolveInspectionTemplateQueryDto,
  UpdateChecklistTemplateDto,
} from './dto/checklist-template.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inspection-templates')
export class InspectionTemplatesController {
  constructor(private readonly checklistTemplatesService: ChecklistTemplatesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.checklistTemplatesService.list(user);
  }

  @Get('resolve')
  resolve(
    @CurrentUser() user: RequestUser,
    @Query() query: ResolveInspectionTemplateQueryDto,
  ) {
    return this.checklistTemplatesService.resolve(user, query);
  }

  @Get(':id')
  getById(@CurrentUser() user: RequestUser, @Param() params: ChecklistTemplateIdParamDto) {
    return this.checklistTemplatesService.getById(user, params.id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateChecklistTemplateDto) {
    return this.checklistTemplatesService.create(user, dto);
  }

  @Post(':id/activate')
  @Roles(UserRole.ADMIN)
  activate(@CurrentUser() user: RequestUser, @Param() params: ChecklistTemplateIdParamDto) {
    return this.checklistTemplatesService.activate(user, params.id);
  }

  @Post(':id/duplicate')
  @Roles(UserRole.ADMIN)
  duplicate(@CurrentUser() user: RequestUser, @Param() params: ChecklistTemplateIdParamDto) {
    return this.checklistTemplatesService.duplicate(user, params.id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  replace(
    @CurrentUser() user: RequestUser,
    @Param() params: ChecklistTemplateIdParamDto,
    @Body() dto: UpdateChecklistTemplateDto,
  ) {
    return this.checklistTemplatesService.update(user, params.id, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @CurrentUser() user: RequestUser,
    @Param() params: ChecklistTemplateIdParamDto,
    @Body() dto: UpdateChecklistTemplateDto,
  ) {
    return this.checklistTemplatesService.update(user, params.id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  archive(@CurrentUser() user: RequestUser, @Param() params: ChecklistTemplateIdParamDto) {
    return this.checklistTemplatesService.archive(user, params.id);
  }
}

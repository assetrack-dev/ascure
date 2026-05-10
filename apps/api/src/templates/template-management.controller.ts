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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateTemplateDto } from './dto/create-template.dto';
import { CreateTemplateItemDto, UpdateTemplateItemDto } from './dto/create-template-item.dto';
import { CreateTemplateSectionDto, UpdateTemplateSectionDto } from './dto/create-template-section.dto';
import { ListTemplatesQueryDto } from './dto/list-templates-query.dto';
import {
  AssetTypeIdParamDto,
  TemplateIdParamDto,
  TemplateItemParamDto,
  TemplateSectionParamDto,
} from './dto/template-params.dto';
import { TemplatesService } from './templates.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller()
export class TemplateManagementController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get('templates')
  listTemplates(@CurrentUser() user: RequestUser, @Query() query: ListTemplatesQueryDto) {
    return this.templatesService.listTemplates(user, query);
  }

  @Get('templates/:id')
  getTemplateDetail(@CurrentUser() user: RequestUser, @Param() params: TemplateIdParamDto) {
    return this.templatesService.getTemplateDetail(user, params.id);
  }

  @Post('templates')
  createTemplate(@CurrentUser() user: RequestUser, @Body() dto: CreateTemplateDto) {
    return this.templatesService.createTemplate(user, dto);
  }

  @Post('templates/:id/sections')
  addSection(
    @CurrentUser() user: RequestUser,
    @Param() params: TemplateIdParamDto,
    @Body() dto: CreateTemplateSectionDto,
  ) {
    return this.templatesService.addSection(user, params.id, dto);
  }

  @Patch('templates/:id/sections/:sectionId')
  updateSection(
    @CurrentUser() user: RequestUser,
    @Param() params: TemplateSectionParamDto,
    @Body() dto: UpdateTemplateSectionDto,
  ) {
    return this.templatesService.updateSection(user, params.id, params.sectionId, dto);
  }

  @Delete('templates/:id/sections/:sectionId')
  deleteSection(@CurrentUser() user: RequestUser, @Param() params: TemplateSectionParamDto) {
    return this.templatesService.deleteSection(user, params.id, params.sectionId);
  }

  @Post('templates/:id/items')
  addItem(
    @CurrentUser() user: RequestUser,
    @Param() params: TemplateIdParamDto,
    @Body() dto: CreateTemplateItemDto,
  ) {
    return this.templatesService.addItem(user, params.id, dto);
  }

  @Patch('templates/:id/items/:itemId')
  updateItem(
    @CurrentUser() user: RequestUser,
    @Param() params: TemplateItemParamDto,
    @Body() dto: UpdateTemplateItemDto,
  ) {
    return this.templatesService.updateItem(user, params.id, params.itemId, dto);
  }

  @Delete('templates/:id/items/:itemId')
  deleteItem(@CurrentUser() user: RequestUser, @Param() params: TemplateItemParamDto) {
    return this.templatesService.deleteItem(user, params.id, params.itemId);
  }

  @Post('templates/:id/clone')
  cloneTemplate(@CurrentUser() user: RequestUser, @Param() params: TemplateIdParamDto) {
    return this.templatesService.cloneTemplate(user, params.id);
  }

  @Post('templates/:id/publish')
  publishTemplate(@CurrentUser() user: RequestUser, @Param() params: TemplateIdParamDto) {
    return this.templatesService.publishTemplate(user, params.id);
  }

  @Get('asset-types/:assetTypeId/templates')
  listTemplatesForAssetType(@CurrentUser() user: RequestUser, @Param() params: AssetTypeIdParamDto) {
    return this.templatesService.listTemplatesForAssetType(user, params.assetTypeId);
  }
}

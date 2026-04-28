import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { ChecklistTemplatesService } from './checklist-templates.service';
import {
  ChecklistTemplateAssetTypeParamDto,
  ChecklistTemplateIdParamDto,
  CreateChecklistTemplateDto,
  UpdateChecklistTemplateDto,
} from './dto/checklist-template.dto';

@UseGuards(JwtAuthGuard)
@Controller('checklist-templates')
export class ChecklistTemplatesController {
  constructor(private readonly checklistTemplatesService: ChecklistTemplatesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.checklistTemplatesService.list(user);
  }

  @Get('asset-type/:assetType')
  getActiveByAssetType(
    @CurrentUser() user: RequestUser,
    @Param() params: ChecklistTemplateAssetTypeParamDto,
  ) {
    return this.checklistTemplatesService.getActiveByAssetType(user, params.assetType);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateChecklistTemplateDto) {
    return this.checklistTemplatesService.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param() params: ChecklistTemplateIdParamDto,
    @Body() dto: UpdateChecklistTemplateDto,
  ) {
    return this.checklistTemplatesService.update(user, params.id, dto);
  }
}

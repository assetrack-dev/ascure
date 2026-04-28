import { Module } from '@nestjs/common';
import { RolesGuard } from '../common/guards/roles.guard';
import { ChecklistTemplatesController } from './checklist-templates.controller';
import { ChecklistTemplatesService } from './checklist-templates.service';
import { TemplateManagementController } from './template-management.controller';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  controllers: [TemplatesController, TemplateManagementController, ChecklistTemplatesController],
  providers: [TemplatesService, ChecklistTemplatesService, RolesGuard],
  exports: [TemplatesService],
})
export class TemplatesModule {}

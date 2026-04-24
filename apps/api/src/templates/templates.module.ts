import { Module } from '@nestjs/common';
import { RolesGuard } from '../common/guards/roles.guard';
import { TemplateManagementController } from './template-management.controller';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  controllers: [TemplatesController, TemplateManagementController],
  providers: [TemplatesService, RolesGuard],
  exports: [TemplatesService],
})
export class TemplatesModule {}

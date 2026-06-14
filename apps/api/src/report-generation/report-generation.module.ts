import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { GotenbergService } from './gotenberg.service';
import { ReportGenerationService } from './report-generation.service';
import { ReportTemplatesController } from './report-templates.controller';
import { VisualReportsController } from './visual-reports.controller';

/**
 * Visual Report feature: per-asset `.docx`-template → PDF (easy-template-x +
 * Gotenberg), compiled and frozen into one PDF when a survey reaches LAPORAN
 * SELESAI (pdf-lib). Exports ReportGenerationService so the survey lifecycle can
 * trigger compilation at the LAPORAN SELESAI chokepoint.
 */
@Module({
  imports: [UsersModule],
  controllers: [ReportTemplatesController, VisualReportsController],
  providers: [ReportGenerationService, GotenbergService],
  exports: [ReportGenerationService],
})
export class ReportGenerationModule {}

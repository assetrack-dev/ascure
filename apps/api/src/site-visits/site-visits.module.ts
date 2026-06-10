import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { SiteVisitsController } from './site-visits.controller';
import { SiteVisitsService } from './site-visits.service';
import { SurveyLifecycleService } from './survey-lifecycle.service';

@Module({
  imports: [UsersModule],
  controllers: [SiteVisitsController],
  providers: [SiteVisitsService, SurveyLifecycleService],
  exports: [SiteVisitsService],
})
export class SiteVisitsModule {}

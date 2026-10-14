import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DefectsController } from './defects.controller';
import { DefectsService } from './defects.service';

@Module({
  imports: [NotificationsModule],
  controllers: [DefectsController],
  providers: [DefectsService],
})
export class DefectsModule {}

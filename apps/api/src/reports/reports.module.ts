import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [UsersModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}

import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { UsersModule } from '../users/users.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SchematicPdfService } from './schematic-pdf.service';

@Module({
  imports: [UsersModule, AssetsModule],
  controllers: [ReportsController],
  providers: [ReportsService, SchematicPdfService],
})
export class ReportsModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MaintenancePackagesController } from './maintenance-packages.controller';
import { MaintenancePackagesService } from './maintenance-packages.service';
import { MaintenanceClosureService } from './maintenance-closure.service';
import { MaintenanceMaterialsController } from './maintenance-materials.controller';
import { MaintenanceMaterialsService } from './maintenance-materials.service';
import { MaintenanceVerificationController } from './maintenance-verification.controller';
import { MaintenanceWorkController } from './maintenance-work.controller';
import { MaintenanceWorkService } from './maintenance-work.service';
import { RepairReportService } from './repair-report.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    MaintenancePackagesController,
    MaintenanceVerificationController,
    MaintenanceWorkController,
    MaintenanceMaterialsController,
  ],
  providers: [
    MaintenancePackagesService,
    MaintenanceClosureService,
    MaintenanceWorkService,
    MaintenanceMaterialsService,
    RepairReportService,
  ],
})
export class MaintenancePackagesModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MaintenancePackagesController } from './maintenance-packages.controller';
import { MaintenancePackagesService } from './maintenance-packages.service';
import { MaintenanceClosureService } from './maintenance-closure.service';
import { MaintenanceVerificationController } from './maintenance-verification.controller';
import { MaintenanceWorkController } from './maintenance-work.controller';
import { MaintenanceWorkService } from './maintenance-work.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    MaintenancePackagesController,
    MaintenanceVerificationController,
    MaintenanceWorkController,
  ],
  providers: [MaintenancePackagesService, MaintenanceClosureService, MaintenanceWorkService],
})
export class MaintenancePackagesModule {}

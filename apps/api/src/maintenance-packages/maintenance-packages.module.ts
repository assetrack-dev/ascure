import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MaintenancePackagesController } from './maintenance-packages.controller';
import { MaintenancePackagesService } from './maintenance-packages.service';
import { MaintenanceClosureService } from './maintenance-closure.service';
import { MaintenanceVerificationController } from './maintenance-verification.controller';

@Module({
  imports: [PrismaModule],
  controllers: [MaintenancePackagesController, MaintenanceVerificationController],
  providers: [MaintenancePackagesService, MaintenanceClosureService],
})
export class MaintenancePackagesModule {}

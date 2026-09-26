import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MaintenancePackagesController } from './maintenance-packages.controller';
import { MaintenancePackagesService } from './maintenance-packages.service';

@Module({
  imports: [PrismaModule],
  controllers: [MaintenancePackagesController],
  providers: [MaintenancePackagesService],
})
export class MaintenancePackagesModule {}

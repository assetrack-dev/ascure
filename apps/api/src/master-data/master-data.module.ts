import { Module } from '@nestjs/common';
import { RolesGuard } from '../common/guards/roles.guard';
import { MasterDataController } from './master-data.controller';
import { MasterDataService } from './master-data.service';

@Module({
  controllers: [MasterDataController],
  providers: [MasterDataService, RolesGuard],
})
export class MasterDataModule {}

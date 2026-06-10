import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { NetworkController } from './network.controller';
import { NetworkService } from './network.service';

@Module({
  controllers: [AssetsController, NetworkController],
  providers: [AssetsService, NetworkService],
  exports: [AssetsService],
})
export class AssetsModule {}

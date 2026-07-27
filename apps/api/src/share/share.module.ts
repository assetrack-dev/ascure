import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';

@Module({
  imports: [AssetsModule],
  controllers: [ShareController],
  providers: [ShareService],
})
export class ShareModule {}

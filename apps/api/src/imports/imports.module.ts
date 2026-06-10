import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { UsersModule } from '../users/users.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [UsersModule, AssetsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}

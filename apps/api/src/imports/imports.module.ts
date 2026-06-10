import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [UsersModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}

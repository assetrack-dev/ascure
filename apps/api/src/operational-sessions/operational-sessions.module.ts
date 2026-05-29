import { Module } from '@nestjs/common';
import { OperationalSessionsController } from './operational-sessions.controller';
import { OperationalSessionsService } from './operational-sessions.service';

@Module({
  controllers: [OperationalSessionsController],
  providers: [OperationalSessionsService],
})
export class OperationalSessionsModule {}

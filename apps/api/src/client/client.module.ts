import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ClientController } from './client.controller';
import { ClientProgressService } from './client-progress.service';

@Module({
  imports: [PrismaModule],
  controllers: [ClientController],
  providers: [ClientProgressService],
  exports: [ClientProgressService],
})
export class ClientModule {}

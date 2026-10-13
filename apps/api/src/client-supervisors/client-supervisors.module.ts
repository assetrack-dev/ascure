import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ClientSupervisorsController } from './client-supervisors.controller';
import { ClientSupervisorsService } from './client-supervisors.service';

@Module({
  imports: [PrismaModule],
  controllers: [ClientSupervisorsController],
  providers: [ClientSupervisorsService],
})
export class ClientSupervisorsModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { MasterDataModule } from './master-data/master-data.module';
import { SiteVisitsModule } from './site-visits/site-visits.module';
import { TemplatesModule } from './templates/templates.module';
import { InspectionsModule } from './inspections/inspections.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    MasterDataModule,
    SiteVisitsModule,
    TemplatesModule,
    InspectionsModule,
  ],
})
export class AppModule {}


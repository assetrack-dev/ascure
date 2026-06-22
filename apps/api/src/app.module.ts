import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { MasterDataModule } from './master-data/master-data.module';
import { SiteVisitsModule } from './site-visits/site-visits.module';
import { TemplatesModule } from './templates/templates.module';
import { InspectionsModule } from './inspections/inspections.module';
import { AssetsModule } from './assets/assets.module';
import { DefectsModule } from './defects/defects.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EnterpriseModule } from './enterprise/enterprise.module';
import { TeamsModule } from './teams/teams.module';
import { OperationalSessionsModule } from './operational-sessions/operational-sessions.module';
import { ReportsModule } from './reports/reports.module';
import { ReportGenerationModule } from './report-generation/report-generation.module';
import { ImportsModule } from './imports/imports.module';
import { SyncModule } from './sync/sync.module';
import { PublicModule } from './public/public.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    // Rate-limiting baseline. NOT registered as a global guard — only routes
    // that opt in with @UseGuards(ThrottlerGuard) are throttled (currently just
    // POST /auth/login), so the mobile sync/upload bursts are untouched.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    MasterDataModule,
    AssetsModule,
    SiteVisitsModule,
    TemplatesModule,
    InspectionsModule,
    DefectsModule,
    DashboardModule,
    EnterpriseModule,
    TeamsModule,
    OperationalSessionsModule,
    ReportsModule,
    ReportGenerationModule,
    ImportsModule,
    SyncModule,
    PublicModule,
  ],
})
export class AppModule {}

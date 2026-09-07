import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';
import { MemoryUsageInterceptor } from './memory.interceptor';

/**
 * RSS-leak instrumentation (see diagnostics.service.ts for the why). The
 * interceptor registers GLOBALLY via APP_INTERCEPTOR so every route is
 * attributed without touching the other modules.
 */
@Module({
  controllers: [DiagnosticsController],
  providers: [
    DiagnosticsService,
    { provide: APP_INTERCEPTOR, useClass: MemoryUsageInterceptor },
  ],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}

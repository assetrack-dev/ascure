import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DiagnosticsService } from './diagnostics.service';

/**
 * ADMIN-only window into the RSS-leak instrumentation. The same report is
 * reachable without a token from the VPS shell: `pm2 sendSignal SIGUSR2
 * ascure-api` dumps it into the pm2 log.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  @Get('memory')
  memory() {
    return this.diagnostics.report();
  }

  /**
   * ⚠ Stalls the event loop for seconds while V8 serializes the heap — take
   * one only when heapUsed itself is what grows (a native/external leak never
   * shows up in a heap snapshot). File lands in uploads/diagnostics.
   */
  @Post('heap-snapshot')
  heapSnapshot() {
    return this.diagnostics.takeHeapSnapshot();
  }
}

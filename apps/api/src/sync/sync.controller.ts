import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { SyncHeartbeatDto } from './dto/sync-heartbeat.dto';
import { SyncService } from './sync.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  // Any authenticated field user reports their own device's pending queue size.
  @Post('heartbeat')
  heartbeat(@CurrentUser() user: RequestUser, @Body() dto: SyncHeartbeatDto) {
    return this.syncService.heartbeat(user, dto);
  }
}

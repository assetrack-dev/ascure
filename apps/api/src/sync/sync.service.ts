import { Injectable } from '@nestjs/common';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { SyncHeartbeatDto } from './dto/sync-heartbeat.dto';

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a device's offline-sync heartbeat (ADR 0002 §4): how many mutations
   * are still queued locally. The reassign gate reads the outgoing team's
   * members' counts to block handing a Pencawang to another team while the
   * outgoing team still has unsynced work. Self-reported and best-effort — the
   * count defaults to 0, so until a device reports the gate never blocks.
   */
  async heartbeat(user: RequestUser, dto: SyncHeartbeatDto) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        syncPendingCount: dto.pendingMutationCount,
        syncReportedAt: new Date(),
      },
    });

    return {
      ok: true,
      pendingMutationCount: dto.pendingMutationCount,
    };
  }
}

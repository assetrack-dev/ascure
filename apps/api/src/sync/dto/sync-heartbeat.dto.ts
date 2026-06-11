import { IsInt, Max, Min } from 'class-validator';

/**
 * A device's offline-sync heartbeat (ADR 0002 §4): how many mutations are still
 * queued locally awaiting flush to the server.
 */
export class SyncHeartbeatDto {
  @IsInt()
  @Min(0)
  @Max(100000)
  pendingMutationCount!: number;
}

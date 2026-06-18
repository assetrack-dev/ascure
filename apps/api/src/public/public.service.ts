import { Injectable } from '@nestjs/common';
import { InspectionCompletionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Aggregate, non-identifying platform numbers safe to publish on the public
 * marketing site. Counts only — never names, GPS, tenants, or any row-level
 * data. See PublicController for the (unauthenticated) exposure.
 */
export interface PublicStats {
  /**
   * The headline "real asset inspected counter": distinct assets (poles/PEs)
   * that have at least one SUBMITTED inspection. This mirrors the "done"
   * definition used by the billing contribution ledger and the daily team
   * activity view (see dashboard.service.ts) — an asset re-inspected across
   * annual cycles still counts once.
   */
  polesInspected: number;
  /** Total submitted inspections (a pole re-surveyed each cycle counts again). */
  inspectionsPerformed: number;
  /** Every tagged asset in the register (includes imported baseline poles). */
  assetsInRegister: number;
  /** Defects identified and tracked across the platform. */
  defectsLogged: number;
  /** ISO timestamp the numbers were computed (not when they were served). */
  generatedAt: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class PublicService {
  private cache: { value: PublicStats; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the cached aggregate stats, recomputing at most once per
   * CACHE_TTL_MS. The cache makes the public (unauthenticated) endpoint safe to
   * hammer — a traffic spike can't translate into a query storm.
   */
  async getStats(): Promise<PublicStats> {
    const now = Date.now();

    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }

    const value = await this.computeStats();
    this.cache = { value, expiresAt: now + CACHE_TTL_MS };

    return value;
  }

  private async computeStats(): Promise<PublicStats> {
    // NOTE: deliberately tenant-agnostic — a platform-wide aggregate. If a demo
    // / sandbox tenant ever needs excluding, add a tenant filter here.
    const [distinctInspectedAssets, inspectionsPerformed, assetsInRegister, defectsLogged] =
      await Promise.all([
        // Prisma has no COUNT(DISTINCT); fetching distinct assetIds and taking
        // the length is fine behind the 5-minute cache at pilot/early scale.
        this.prisma.inspection.findMany({
          where: { completionStatus: InspectionCompletionStatus.SUBMITTED },
          select: { assetId: true },
          distinct: ['assetId'],
        }),
        this.prisma.inspection.count({
          where: { completionStatus: InspectionCompletionStatus.SUBMITTED },
        }),
        this.prisma.asset.count(),
        this.prisma.defect.count(),
      ]);

    return {
      polesInspected: distinctInspectedAssets.length,
      inspectionsPerformed,
      assetsInRegister,
      defectsLogged,
      generatedAt: new Date().toISOString(),
    };
  }
}

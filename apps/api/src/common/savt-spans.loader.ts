import { FeederKind, Prisma, PrismaClient } from '@prisma/client';
import { canonicalizeSavtRouteCode } from '@ascure/shared-utils';
import { SavtRouteSpans, computeSavtRouteSpans } from './savt-spans';

type Db = PrismaClient | Prisma.TransactionClient;

export interface SavtFeederSpans extends SavtRouteSpans {
  feederId: string;
  /** The From Pencawang that owns the route. */
  substationId: string;
  code: string;
}

/**
 * Load SAVT routes (Feeders) with their poles' memberships + GPS and compute
 * every span (see savt-spans.ts). `where` narrows the feeders; omit it for the
 * whole tenant (~80 routes / ~7k poles on prod: one query, cheap).
 */
export async function loadSavtFeederSpans(
  db: Db,
  tenantId: string,
  where: Prisma.FeederWhereInput = {},
): Promise<Map<string, SavtFeederSpans>> {
  const feeders = await db.feeder.findMany({
    where: { ...where, tenantId, kind: FeederKind.SAVT },
    select: {
      id: true,
      substationId: true,
      code: true,
      memberships: {
        select: {
          assetId: true,
          sequenceIndex: true,
          branchSuffix: true,
          fedFromAssetId: true,
          asset: { select: { latitude: true, longitude: true } },
        },
      },
    },
  });
  const out = new Map<string, SavtFeederSpans>();
  for (const feeder of feeders) {
    const poles = feeder.memberships.map((m) => ({
      assetId: m.assetId,
      sequenceIndex: m.sequenceIndex,
      branchSuffix: m.branchSuffix,
      fedFromAssetId: m.fedFromAssetId,
      latitude: m.asset.latitude,
      longitude: m.asset.longitude,
    }));
    out.set(feeder.id, {
      feederId: feeder.id,
      substationId: feeder.substationId,
      code: feeder.code,
      ...computeSavtRouteSpans(poles),
    });
  }
  return out;
}

/**
 * Find the Feeder for a SAVT visit's route: owned by the visit's From Pencawang
 * (else its Pencawang — the same fallback the pole sync uses) with the
 * canonical KOD TIANG. Null when the route has no poles yet.
 */
export function savtFeederOwnerOf(visit: {
  fromPencawangId: string | null;
  substationId: string | null;
}): string | null {
  return visit.fromPencawangId ?? visit.substationId ?? null;
}

export function savtFeederLookupKey(ownerSubstationId: string, routeCode: string | null): string | null {
  const code = canonicalizeSavtRouteCode(routeCode);
  return code ? `${ownerSubstationId}|${code}` : null;
}

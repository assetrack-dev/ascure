import { FeederKind, Prisma } from '@prisma/client';

/**
 * SAVT route graph writes (docs/PLAN-savt-shared-poles.md), shared by asset
 * create/edit sync (AssetsService) and the shared-pole link flow
 * (SiteVisitsService). Plain tx-scoped functions — no Nest wiring — so both
 * modules use one implementation.
 *
 * A SAVT route is a Feeder OWNED BY its source Pencawang with code = the
 * canonical KOD TIANG; a pole holds ONE membership per route it carries, with
 * that route's own No. Tiang (shared-corridor poles are on several).
 */
export interface SavtMembershipParams {
  tenantId: string;
  assetId: string;
  /** The route's source Pencawang — owns the Feeder row. */
  feederSubstationId: string;
  /** Canonical KOD TIANG (canonicalizeSavtRouteCode has already run). */
  routeCode: string;
  noTiang: number;
  branchSuffix: string;
}

/** Upsert the route's Feeder + this pole's membership on it. Idempotent. */
export async function upsertSavtMembership(
  tx: Prisma.TransactionClient,
  params: SavtMembershipParams,
): Promise<void> {
  const feeder = await tx.feeder.upsert({
    where: {
      // SAVT routes are always direct lines — origin sentinel ''/0.
      substationId_code_originKind_originNumber: {
        substationId: params.feederSubstationId,
        code: params.routeCode,
        originKind: '',
        originNumber: 0,
      },
    },
    create: {
      tenantId: params.tenantId,
      substationId: params.feederSubstationId,
      code: params.routeCode,
      kind: FeederKind.SAVT,
    },
    update: {},
  });
  const fedFromAssetId = await resolveSavtParentAssetId(
    tx,
    feeder.id,
    { noTiang: params.noTiang, branchSuffix: params.branchSuffix },
    params.assetId,
  );
  await tx.poleFeederMembership.upsert({
    where: {
      assetId_feederId: { assetId: params.assetId, feederId: feeder.id },
    },
    create: {
      assetId: params.assetId,
      feederId: feeder.id,
      sequenceIndex: params.noTiang,
      branchSuffix: params.branchSuffix,
      fedFromAssetId,
    },
    update: {
      sequenceIndex: params.noTiang,
      branchSuffix: params.branchSuffix,
      fedFromAssetId,
    },
  });
}

/**
 * The parent pole ON a SAVT route: a branch hangs off its trunk pole; trunk
 * pole N follows the nearest existing lower trunk pole (poles can be added out
 * of order); pole 1 is the feeder head. Mirrors the RONDAAN parent fallback.
 */
export async function resolveSavtParentAssetId(
  tx: Prisma.TransactionClient,
  feederId: string,
  identity: { noTiang: number; branchSuffix: string },
  selfAssetId: string,
): Promise<string | null> {
  const maxTrunk =
    identity.branchSuffix.length > 0 ? identity.noTiang : identity.noTiang - 1;
  if (maxTrunk < 1) {
    return null;
  }
  const parent = await tx.poleFeederMembership.findFirst({
    where: {
      feederId,
      branchSuffix: '',
      sequenceIndex: { lte: maxTrunk },
      assetId: { not: selfAssetId },
    },
    orderBy: { sequenceIndex: 'desc' },
    select: { assetId: true },
  });
  return parent?.assetId ?? null;
}

/**
 * Backfill the network graph (north-star §2-§3; docs/adr/0001-network-graph-storage-model.md)
 * from the legacy assetCode strings — the Phase 1 migration's data half.
 *
 * For every pole (Asset whose assetCode parses as a NO TIANG RONDAAN) this:
 *   1. upserts a Feeder per (substation, feeder token)               -- "store the structure"
 *   2. creates PoleFeederMembership rows {feeder, sequenceIndex, branchSuffix}
 *   3. pre-fills Asset.fedFromAssetId from the parsed parent (observed-by-proxy;
 *      left for human confirmation — divergence here is how route changes show up)
 *   4. sets Asset.noTiangLama from metadata (the painted label) when present
 *
 * It NEVER rewrites assetCode — it only REPORTS where formatRondaan(...) disagrees,
 * so canonicalisation stays a reviewed decision, not a silent mass-rename.
 *
 * DRY-RUN by default: prints the plan + a data-quality report, writes nothing.
 * Add --apply to commit. Idempotent and non-clobbering (safe to re-run): feeders
 * upsert, memberships skipDuplicates, fedFromAssetId / noTiangLama are only filled
 * when currently null (never overwrites a human-confirmed value).
 *
 *   tsx prisma/scripts/backfill-network-graph.ts                       # dry-run, all
 *   tsx prisma/scripts/backfill-network-graph.ts --apply
 *   tsx prisma/scripts/backfill-network-graph.ts --substation <code> --apply
 *
 * Flags: --tenant <code>   --substation <code>   --lama-from-name   --apply
 *
 * Requires DATABASE_URL to point at the target database.
 */
import { PrismaClient } from '@prisma/client';
import {
  buildNormalizedKey,
  formatBranchSuffix,
  formatRondaan,
  getExpectedParentKey,
  normalizePoleInput,
  parsePoleCode,
  type ParsedPoleCode,
  type PoleMembership,
} from '@ascure/shared-utils';

const APPLY = process.argv.includes('--apply');
const LAMA_FROM_NAME = process.argv.includes('--lama-from-name');
const TENANT_CODE = argValue('--tenant');
const SUBSTATION_CODE = argValue('--substation');

const LAMA_METADATA_KEYS = [
  'noTiangLama', 'no_tiang_lama', 'No Tiang Lama', 'NO TIANG LAMA',
  'poleNumberOld', 'oldPoleNumber', 'ntl', 'NTL',
];

const prisma = new PrismaClient();

type AssetRow = {
  id: string;
  assetCode: string;
  name: string | null;
  noTiangLama: string | null;
  fedFromAssetId: string | null;
  metadata: unknown;
};

type MembershipPlan = {
  assetId: string;
  feederCode: string;
  sequenceIndex: number;
  branchSuffix: string;
};

type AssetUpdate = { fedFromAssetId?: string; noTiangLama?: string };

type Totals = {
  substations: number;
  poles: number;
  skipped: number;
  feeders: number;
  memberships: number;
  fedFrom: number;
  lama: number;
};

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function membershipKey(p: ParsedPoleCode): string {
  return buildNormalizedKey(p.feeder, p.baseNumber, p.branchParts);
}

/** The parsed parent of a membership: its branch parent, or the previous trunk
 *  pole on the same feeder, or undefined at the feeder head. */
function parentKeyOf(p: ParsedPoleCode): string | undefined {
  if (p.branchParts.length > 0) {
    return getExpectedParentKey(p);
  }
  return p.baseNumber > 1 ? buildNormalizedKey(p.feeder, p.baseNumber - 1) : undefined;
}

function readLamaFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const meta = metadata as Record<string, unknown>;
  for (const key of LAMA_METADATA_KEYS) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

async function processSubstation(
  sub: { id: string; code: string; name: string; tenantId: string },
  totals: Totals,
) {
  const assets: AssetRow[] = await prisma.asset.findMany({
    where: { substationId: sub.id },
    select: {
      id: true,
      assetCode: true,
      name: true,
      noTiangLama: true,
      fedFromAssetId: true,
      metadata: true,
    },
  });

  // Pass 1 — parse every pole and index normalizedKey -> assetId.
  const parsed = new Map<string, ParsedPoleCode[]>(); // assetId -> valid memberships
  const keyToAssetId = new Map<string, string>();
  const duplicateKeys: string[] = [];
  const parseFailures: string[] = [];

  for (const asset of assets) {
    const memberships = parsePoleCode(asset.assetCode).filter((p) => p.isValid);
    if (memberships.length === 0) {
      parseFailures.push(asset.assetCode);
      totals.skipped += 1;
      continue;
    }
    parsed.set(asset.id, memberships);
    totals.poles += 1;
    for (const m of memberships) {
      const key = membershipKey(m);
      if (keyToAssetId.has(key) && keyToAssetId.get(key) !== asset.id) {
        duplicateKeys.push(key);
      } else {
        keyToAssetId.set(key, asset.id);
      }
    }
  }

  // Pass 2 — plan feeders, memberships, fed-from and LAMA.
  const feederCodes = new Set<string>();
  const membershipPlans: MembershipPlan[] = [];
  const assetUpdates = new Map<string, AssetUpdate>();
  const unresolvedParents: string[] = [];
  const ambiguousParents: string[] = [];
  const assetCodeMismatches: string[] = [];
  const assetById = new Map(assets.map((a) => [a.id, a] as const));

  for (const [assetId, memberships] of parsed) {
    const asset = assetById.get(assetId)!;
    const update: AssetUpdate = {};

    for (const m of memberships) {
      feederCodes.add(m.feeder);
      membershipPlans.push({
        assetId,
        feederCode: m.feeder,
        sequenceIndex: m.baseNumber,
        branchSuffix: formatBranchSuffix(m.branchParts),
      });
    }

    // fed-from: resolve from the primary (lowest) membership; flag ambiguity.
    const ordered = [...memberships].sort(
      (a, b) => a.feeder.localeCompare(b.feeder) || a.baseNumber - b.baseNumber,
    );
    const resolvedParents = new Set<string>();
    for (const m of memberships) {
      const pk = parentKeyOf(m);
      if (!pk) continue;
      const parentId = keyToAssetId.get(pk);
      if (parentId && parentId !== assetId) resolvedParents.add(parentId);
    }
    if (resolvedParents.size > 1) ambiguousParents.push(asset.assetCode);

    const primaryParentKey = parentKeyOf(ordered[0]);
    if (primaryParentKey) {
      const parentId = keyToAssetId.get(primaryParentKey);
      if (parentId && parentId !== assetId) {
        if (asset.fedFromAssetId == null) update.fedFromAssetId = parentId;
      } else {
        unresolvedParents.push(`${asset.assetCode} -> ${primaryParentKey}`);
      }
    }

    // LAMA (painted label): metadata first, optionally the legacy `name`.
    if (asset.noTiangLama == null) {
      const lama =
        readLamaFromMetadata(asset.metadata) ??
        (LAMA_FROM_NAME && asset.name && asset.name.trim() ? asset.name.trim() : null);
      if (lama) update.noTiangLama = lama;
    }

    // assetCode canonicalisation drift (report only — never rewritten here).
    const canonical = formatRondaan(
      memberships.map<PoleMembership>((m) => ({
        feeder: m.feeder,
        index: m.baseNumber,
        branchParts: m.branchParts,
      })),
    );
    if (canonical && canonical !== normalizePoleInput(asset.assetCode)) {
      assetCodeMismatches.push(`${asset.assetCode} -> ${canonical}`);
    }

    if (update.fedFromAssetId || update.noTiangLama) assetUpdates.set(assetId, update);
  }

  const fedFromCount = [...assetUpdates.values()].filter((u) => u.fedFromAssetId).length;
  const lamaCount = [...assetUpdates.values()].filter((u) => u.noTiangLama).length;

  totals.substations += 1;
  totals.feeders += feederCodes.size;
  totals.memberships += membershipPlans.length;
  totals.fedFrom += fedFromCount;
  totals.lama += lamaCount;

  console.log(
    `\n# ${sub.code} (${sub.name}) — poles=${parsed.size} skipped=${parseFailures.length} ` +
      `feeders=${feederCodes.size} memberships=${membershipPlans.length} ` +
      `fedFrom=${fedFromCount} lama=${lamaCount}`,
  );
  reportSample('  parse-failures (not poles?)', parseFailures);
  reportSample('  duplicate RONDAAN keys', duplicateKeys);
  reportSample('  ambiguous fed-from (multi-feeder)', ambiguousParents);
  reportSample('  unresolved parents (gap in sequence?)', unresolvedParents);
  reportSample('  assetCode != canonical', assetCodeMismatches);

  if (!APPLY) return;

  await prisma.$transaction(
    async (tx) => {
      const feederIdByCode = new Map<string, string>();
      for (const code of feederCodes) {
        const feeder = await tx.feeder.upsert({
          where: { substationId_code: { substationId: sub.id, code } },
          create: { tenantId: sub.tenantId, substationId: sub.id, code },
          update: {},
        });
        feederIdByCode.set(code, feeder.id);
      }

      if (membershipPlans.length) {
        await tx.poleFeederMembership.createMany({
          data: membershipPlans.map((m) => ({
            assetId: m.assetId,
            feederId: feederIdByCode.get(m.feederCode)!,
            sequenceIndex: m.sequenceIndex,
            branchSuffix: m.branchSuffix,
          })),
          skipDuplicates: true,
        });
      }

      for (const [assetId, update] of assetUpdates) {
        await tx.asset.update({ where: { id: assetId }, data: update });
      }
    },
    { timeout: 120_000 },
  );
  console.log(`  ✔ committed ${sub.code}`);
}

function reportSample(label: string, items: string[]) {
  if (items.length === 0) return;
  const sample = items.slice(0, 5).join(', ');
  console.log(`${label}: ${items.length}${items.length > 5 ? ` (e.g. ${sample}, …)` : ` (${sample})`}`);
}

async function main() {
  const masked = (process.env.DATABASE_URL ?? '').replace(/:[^:@/]*@/, ':****@');
  console.log(
    `# backfill-network-graph :: apply=${APPLY} lamaFromName=${LAMA_FROM_NAME} ` +
      `tenant=${TENANT_CODE ?? 'ALL'} substation=${SUBSTATION_CODE ?? 'ALL'} db=${masked}`,
  );
  if (!APPLY) console.log('# DRY-RUN — no writes. Add --apply to commit.');

  const substations = await prisma.substation.findMany({
    where: {
      ...(SUBSTATION_CODE ? { code: SUBSTATION_CODE } : {}),
      ...(TENANT_CODE ? { tenant: { code: TENANT_CODE } } : {}),
    },
    select: { id: true, code: true, name: true, tenantId: true },
    orderBy: { code: 'asc' },
  });

  if (!substations.length) {
    console.log('No matching substations.');
    return;
  }

  const totals: Totals = {
    substations: 0,
    poles: 0,
    skipped: 0,
    feeders: 0,
    memberships: 0,
    fedFrom: 0,
    lama: 0,
  };
  for (const sub of substations) {
    await processSubstation(sub, totals);
  }

  console.log(
    `\n# TOTAL: substations=${totals.substations} poles=${totals.poles} skipped=${totals.skipped} ` +
      `feeders=${totals.feeders} memberships=${totals.memberships} fedFrom=${totals.fedFrom} lama=${totals.lama}`,
  );
  console.log(APPLY ? '# Done (committed).' : '# Done (dry-run). Re-run with --apply to write.');
}

main()
  .catch((err) => {
    console.error('ERROR:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

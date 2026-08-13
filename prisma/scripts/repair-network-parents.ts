/**
 * Repair the RONDAAN network graph's fed-from edges + report why any Pencawang
 * has no graph at all.
 *
 * WHY (field report 2026-08-13, the "everything fans back to A 4" map): the live
 * sync used to resolve a pole's parent ONCE, at that pole's own create/edit. If
 * the exact parent's membership didn't exist at that moment (out-of-order
 * offline sync, a code retyped later from ADMIN, older imports), it fell back to
 * the nearest bare TRUNK pole and the child was never re-resolved when the real
 * parent appeared. The live code now re-resolves the whole Pencawang on every
 * pole sync (assets.service reresolvePencawangParents); THIS script applies the
 * same recompute to the data already in place.
 *
 * For every Pencawang it:
 *   1. parses every pole's assetCode (RONDAAN grammar);
 *   2. creates any MISSING Feeder / PoleFeederMembership rows (poles that
 *      predate the live sync or the old backfill) and realigns a stored row's
 *      sequenceIndex/branchSuffix when the code disagrees;
 *   3. recomputes EVERY membership's fedFromAssetId by walking the grammar's
 *      expected-parent chain ("A 4/2/2" -> A 4/2/1, A 4/2, A 4/1, A 4, A 3, …;
 *      first key that exists wins) — OVERWRITING wrong values (edges are fully
 *      derived data; nothing human-set lives here);
 *   4. recomputes Asset.fedFromAssetId from the primary (lowest feeder/seq)
 *      membership — this drives the radial "downstream" isolation;
 *   5. reports, per Pencawang: parse failures (with samples), FP/TX-origin poles
 *      (deliberately NOT in the structured graph yet), memberships created,
 *      edges fixed — and flags every Pencawang that still ends up with NO graph,
 *      with the reason ("all poles FP/TX", "no pole code parses", …). That list
 *      answers "why does this Pencawang say 'no graph structure'".
 *
 * DRY-RUN by default: prints everything, writes nothing. Add --apply to commit.
 * Idempotent — a second run finds nothing to fix.
 *
 *   tsx prisma/scripts/repair-network-parents.ts                        # dry-run
 *   tsx prisma/scripts/repair-network-parents.ts --apply
 *   tsx prisma/scripts/repair-network-parents.ts --substation <code> --apply
 *
 * Flags: --tenant <code>   --substation <code>   --apply
 * Requires DATABASE_URL to point at the target database.
 */
import { FeederKind, PrismaClient } from '@prisma/client';
import {
  expectedParentKeyChain,
  formatBranchSuffix,
  parsePoleCode,
  type ParsedPoleCode,
} from '@ascure/shared-utils';

const APPLY = process.argv.includes('--apply');
const TENANT_CODE = argValue('--tenant');
const SUBSTATION_CODE = argValue('--substation');

const prisma = new PrismaClient();

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Totals = {
  substations: number;
  poles: number;
  originSkipped: number;
  parseFailures: number;
  membershipsCreated: number;
  membershipsRealigned: number;
  membershipEdgesFixed: number;
  assetEdgesFixed: number;
  emptyGraphs: number;
};

type EmptyGraphReport = { code: string; name: string; reason: string };

function reportSample(label: string, items: string[]) {
  if (items.length === 0) return;
  const sample = items.slice(0, 5).join(' | ');
  console.log(
    `${label}: ${items.length}${items.length > 5 ? ` (e.g. ${sample}, …)` : ` (${sample})`}`,
  );
}

async function processSubstation(
  sub: { id: string; code: string; name: string; tenantId: string },
  totals: Totals,
  emptyGraphs: EmptyGraphReport[],
) {
  const assets = await prisma.asset.findMany({
    where: { substationId: sub.id },
    select: { id: true, assetCode: true, fedFromAssetId: true },
  });
  if (assets.length === 0) {
    return; // nothing to graph, nothing to report — not even a picker entry
  }

  // ---- Parse every pole -----------------------------------------------------
  const codeById = new Map(assets.map((a) => [a.id, a.assetCode] as const));
  const parsedByAsset = new Map<string, ParsedPoleCode[]>();
  const parseFailures: string[] = [];
  const originSkipped: string[] = [];

  for (const asset of assets) {
    const parsed = parsePoleCode(asset.assetCode).filter((p) => p.isValid);
    if (parsed.length === 0) {
      parseFailures.push(asset.assetCode);
      continue;
    }
    // FP<n>/TX<n> origin poles have no structured-membership representation yet
    // (same guard as the live sync) — they stay string-only.
    if (parsed.some((p) => p.origin !== undefined)) {
      originSkipped.push(asset.assetCode);
      continue;
    }
    parsedByAsset.set(asset.id, parsed);
  }

  // ---- Existing membership rows (RONDAAN feeders only) ----------------------
  const existing = await prisma.poleFeederMembership.findMany({
    where: { feeder: { substationId: sub.id, kind: FeederKind.RONDAAN } },
    select: {
      id: true,
      assetId: true,
      sequenceIndex: true,
      branchSuffix: true,
      fedFromAssetId: true,
      feeder: { select: { id: true, code: true } },
    },
  });
  const existingByAssetFeeder = new Map(
    existing.map((row) => [`${row.assetId}|${row.feeder.code}`, row] as const),
  );

  // ---- Plan creations / realignments ---------------------------------------
  const feederCodes = new Set<string>();
  const toCreate: { assetId: string; feederCode: string; sequenceIndex: number; branchSuffix: string }[] = [];
  const toRealign: { id: string; sequenceIndex: number; branchSuffix: string; label: string }[] = [];

  for (const [assetId, parsedList] of parsedByAsset) {
    for (const p of parsedList) {
      feederCodes.add(p.feeder);
      const branchSuffix = formatBranchSuffix(p.branchParts);
      const row = existingByAssetFeeder.get(`${assetId}|${p.feeder}`);
      if (!row) {
        toCreate.push({ assetId, feederCode: p.feeder, sequenceIndex: p.baseNumber, branchSuffix });
      } else if (row.sequenceIndex !== p.baseNumber || row.branchSuffix !== branchSuffix) {
        toRealign.push({
          id: row.id,
          sequenceIndex: p.baseNumber,
          branchSuffix,
          label: `${codeById.get(assetId)}: ${row.feeder.code} ${row.sequenceIndex}${row.branchSuffix} -> ${p.feeder} ${p.baseNumber}${branchSuffix}`,
        });
      }
    }
  }

  // ---- Recompute every parent over the FULL set (existing + planned) --------
  type Entry = {
    assetId: string;
    parsed: ParsedPoleCode;
    currentParentId: string | null | undefined; // undefined = row doesn't exist yet
  };
  const entries: Entry[] = [];
  for (const [assetId, parsedList] of parsedByAsset) {
    for (const p of parsedList) {
      const row = existingByAssetFeeder.get(`${assetId}|${p.feeder}`);
      entries.push({ assetId, parsed: p, currentParentId: row ? row.fedFromAssetId : undefined });
    }
  }
  const keyToAssetId = new Map<string, string>();
  for (const entry of entries) {
    if (!keyToAssetId.has(entry.parsed.normalizedKey)) {
      keyToAssetId.set(entry.parsed.normalizedKey, entry.assetId);
    }
  }

  const desiredParentByAssetFeeder = new Map<string, string | null>();
  const edgeFixes: string[] = [];
  const assetPrimary = new Map<string, { feeder: string; seq: number; parentId: string | null }>();

  for (const entry of entries) {
    let parentId: string | null = null;
    for (const key of expectedParentKeyChain(entry.parsed)) {
      const id = keyToAssetId.get(key);
      if (id && id !== entry.assetId) {
        parentId = id;
        break;
      }
    }
    desiredParentByAssetFeeder.set(`${entry.assetId}|${entry.parsed.feeder}`, parentId);
    if (entry.currentParentId !== undefined && entry.currentParentId !== parentId) {
      edgeFixes.push(
        `${codeById.get(entry.assetId)}: ${
          entry.currentParentId ? (codeById.get(entry.currentParentId) ?? '?') : '(none)'
        } -> ${parentId ? (codeById.get(parentId) ?? '?') : '(none)'}`,
      );
    }
    const current = assetPrimary.get(entry.assetId);
    if (
      !current ||
      entry.parsed.feeder < current.feeder ||
      (entry.parsed.feeder === current.feeder && entry.parsed.baseNumber < current.seq)
    ) {
      assetPrimary.set(entry.assetId, {
        feeder: entry.parsed.feeder,
        seq: entry.parsed.baseNumber,
        parentId,
      });
    }
  }

  const assetEdgeFixes: string[] = [];
  for (const asset of assets) {
    const primary = assetPrimary.get(asset.id);
    if (primary && primary.parentId !== asset.fedFromAssetId) {
      assetEdgeFixes.push(codeById.get(asset.id) ?? asset.id);
    }
  }

  // ---- Report ---------------------------------------------------------------
  const willHaveGraph = entries.length > 0;
  console.log(
    `\n# ${sub.code} (${sub.name}) — poles=${assets.length} graphable=${parsedByAsset.size} ` +
      `originSkipped=${originSkipped.length} parseFailures=${parseFailures.length} ` +
      `createMemberships=${toCreate.length} realign=${toRealign.length} ` +
      `edgeFixes=${edgeFixes.length} assetEdgeFixes=${assetEdgeFixes.length}`,
  );
  reportSample('  parse-failures (not RONDAAN?)', parseFailures);
  reportSample('  FP/TX-origin poles (string-only by design)', originSkipped);
  reportSample('  membership realignments', toRealign.map((r) => r.label));
  reportSample('  edge fixes (pole: old-parent -> new-parent)', edgeFixes);
  reportSample('  asset-level fed-from fixes', assetEdgeFixes);

  if (!willHaveGraph) {
    const reason =
      originSkipped.length > 0 && parseFailures.length === 0
        ? `all ${originSkipped.length} coded poles are FP/TX-origin (structured origin graph not built yet)`
        : parseFailures.length > 0 && originSkipped.length === 0
          ? `no pole code parses as RONDAAN (${parseFailures.length} failures)`
          : parseFailures.length > 0
            ? `mixed: ${originSkipped.length} FP/TX-origin + ${parseFailures.length} unparseable`
            : 'no poles with codes';
    emptyGraphs.push({ code: sub.code, name: sub.name, reason });
    totals.emptyGraphs += 1;
  }

  totals.substations += 1;
  totals.poles += assets.length;
  totals.originSkipped += originSkipped.length;
  totals.parseFailures += parseFailures.length;
  totals.membershipsCreated += toCreate.length;
  totals.membershipsRealigned += toRealign.length;
  totals.membershipEdgesFixed += edgeFixes.length;
  totals.assetEdgesFixed += assetEdgeFixes.length;

  if (!APPLY) return;

  // ---- Apply ---------------------------------------------------------------
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

      if (toCreate.length) {
        await tx.poleFeederMembership.createMany({
          data: toCreate.map((m) => ({
            assetId: m.assetId,
            feederId: feederIdByCode.get(m.feederCode)!,
            sequenceIndex: m.sequenceIndex,
            branchSuffix: m.branchSuffix,
          })),
          skipDuplicates: true,
        });
      }
      for (const r of toRealign) {
        await tx.poleFeederMembership.update({
          where: { id: r.id },
          data: { sequenceIndex: r.sequenceIndex, branchSuffix: r.branchSuffix },
        });
      }

      // Set every membership's fed-from to the recomputed parent (covers both
      // pre-existing and just-created rows). Unconditional write on purpose:
      // a `NOT: { fedFromAssetId: parentId }` guard would skip NULL rows via
      // SQL three-valued logic (NULL <> x is UNKNOWN) — exactly the
      // just-created ones that most need the value.
      for (const [assetFeeder, parentId] of desiredParentByAssetFeeder) {
        const [assetId, feederCode] = assetFeeder.split('|');
        const feederId = feederIdByCode.get(feederCode);
        if (!feederId) continue;
        await tx.poleFeederMembership.updateMany({
          where: { assetId, feederId },
          data: { fedFromAssetId: parentId },
        });
      }

      for (const asset of assets) {
        const primary = assetPrimary.get(asset.id);
        if (primary && primary.parentId !== asset.fedFromAssetId) {
          await tx.asset.update({
            where: { id: asset.id },
            data: { fedFromAssetId: primary.parentId },
          });
        }
      }
    },
    { timeout: 120_000 },
  );
  console.log(`  ✔ committed ${sub.code}`);
}

async function main() {
  const masked = (process.env.DATABASE_URL ?? '').replace(/:[^:@/]*@/, ':****@');
  console.log(
    `# repair-network-parents :: apply=${APPLY} tenant=${TENANT_CODE ?? 'ALL'} ` +
      `substation=${SUBSTATION_CODE ?? 'ALL'} db=${masked}`,
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
    originSkipped: 0,
    parseFailures: 0,
    membershipsCreated: 0,
    membershipsRealigned: 0,
    membershipEdgesFixed: 0,
    assetEdgesFixed: 0,
    emptyGraphs: 0,
  };
  const emptyGraphs: EmptyGraphReport[] = [];

  for (const sub of substations) {
    await processSubstation(sub, totals, emptyGraphs);
  }

  console.log(
    `\n# TOTAL: substations=${totals.substations} poles=${totals.poles} ` +
      `originSkipped=${totals.originSkipped} parseFailures=${totals.parseFailures} ` +
      `created=${totals.membershipsCreated} realigned=${totals.membershipsRealigned} ` +
      `edgeFixes=${totals.membershipEdgesFixed} assetEdgeFixes=${totals.assetEdgesFixed}`,
  );
  if (emptyGraphs.length) {
    console.log(`\n# Pencawang that will still show NO graph (${emptyGraphs.length}):`);
    for (const e of emptyGraphs) {
      console.log(`  - ${e.code} (${e.name}): ${e.reason}`);
    }
  }
  console.log(APPLY ? '# Done (committed).' : '# Done (dry-run). Re-run with --apply to write.');
}

main()
  .catch((err) => {
    console.error('ERROR:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

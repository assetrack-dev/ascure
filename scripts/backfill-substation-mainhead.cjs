/**
 * Backfill Substation.mainheadId from each Pencawang's site-visit history.
 *
 * The hierarchical drill-down map (docs/PLAN-hierarchical-map.md) treats
 * Region -> Mainhead -> Pencawang as a STRUCTURAL hierarchy. Historically a
 * mainhead was only recorded per site visit, so we seed each Substation's
 * mainheadId from the dominant (most frequent) mainhead across its visits.
 *
 * Safe + idempotent: only fills substations whose mainheadId is still NULL, so
 * re-runs and any manual admin assignments are never overwritten.
 *
 * Usage:
 *   node scripts/backfill-substation-mainhead.cjs            # dry run (report only)
 *   node scripts/backfill-substation-mainhead.cjs --apply    # write the changes
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  const [substations, visits] = await Promise.all([
    prisma.substation.findMany({
      select: { id: true, code: true, name: true, mainheadId: true },
    }),
    prisma.siteVisit.findMany({
      // substationId is a required column; only mainheadId can be null.
      where: { mainheadId: { not: null } },
      select: { substationId: true, mainheadId: true },
    }),
  ]);

  // substationId -> Map(mainheadId -> visit count)
  const byStation = new Map();
  for (const v of visits) {
    let counts = byStation.get(v.substationId);
    if (!counts) byStation.set(v.substationId, (counts = new Map()));
    counts.set(v.mainheadId, (counts.get(v.mainheadId) || 0) + 1);
  }

  let alreadySet = 0;
  let assigned = 0;
  let conflicts = 0;
  let noSignal = 0;
  const conflictRows = [];
  const noSignalRows = [];

  for (const s of substations) {
    if (s.mainheadId) {
      alreadySet++;
      continue;
    }
    const counts = byStation.get(s.id);
    if (!counts || counts.size === 0) {
      noSignal++;
      noSignalRows.push(s);
      continue;
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const dominant = ranked[0][0];
    if (ranked.length > 1) {
      conflicts++;
      conflictRows.push({ s, ranked });
    }
    if (apply) {
      await prisma.substation.update({ where: { id: s.id }, data: { mainheadId: dominant } });
    }
    assigned++;
  }

  console.log(`Substations: ${substations.length} total`);
  console.log(`  already had a mainhead: ${alreadySet}`);
  console.log(
    `  ${apply ? "assigned" : "would assign"}: ${assigned}` +
      `  (${conflicts} had >1 candidate mainhead - took the most frequent)`,
  );
  console.log(`  no site-visit signal, left NULL (assign manually later): ${noSignal}`);

  if (conflictRows.length) {
    console.log("\nConflicts (>1 mainhead seen; picked most frequent):");
    for (const { s, ranked } of conflictRows.slice(0, 50)) {
      console.log(`  ${s.code} ${s.name || ""}: ${ranked.map(([m, c]) => `${m}=${c}`).join(", ")}`);
    }
    if (conflictRows.length > 50) console.log(`  ...and ${conflictRows.length - 50} more`);
  }
  if (noSignalRows.length) {
    console.log("\nNo mainhead signal (need manual assignment):");
    for (const s of noSignalRows.slice(0, 50)) console.log(`  ${s.code} ${s.name || ""}`);
    if (noSignalRows.length > 50) console.log(`  ...and ${noSignalRows.length - 50} more`);
  }
  if (!apply) console.log("\nDRY RUN - re-run with --apply to write these changes.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

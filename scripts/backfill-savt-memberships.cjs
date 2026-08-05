/**
 * SAVT shared-pole backfill (docs/PLAN-savt-shared-poles.md):
 *
 *  1. Canonicalize every SAVT visit's KOD TIANG (routeCode) — "MI-KUK",
 *     "MI – KUK" and "MI - KUK" are the SAME route and must share one key.
 *  2. Create the route Feeders (kind SAVT, owned by the From-Pencawang) and one
 *     PoleFeederMembership per SAVT pole, parsed from its assetCode against its
 *     visits' route (sequenceIndex = No. Tiang, branchSuffix = "/n" tail),
 *     with the per-route fed-from parent chain.
 *  3. REPORT (always, even in dry run):
 *     - route-code canonicalization changes,
 *     - per-route No. Tiang collisions (two assets claiming one number),
 *     - GPS-proximity duplicate suspects: poles of DIFFERENT routes within
 *       PROXIMITY_METERS of each other — the pre-shared-pole era's only way to
 *       record a shared pole was to create it twice (owner check, answer #4),
 *     - duplicate Pencawang codes per tenant (a duplicated From-Pencawang
 *       splits routes exactly like a mistyped KOD TIANG).
 *
 * Safe + idempotent: memberships are upserted by (assetId, feederId); re-runs
 * converge. Poles whose code doesn't parse on any of their routes are reported
 * and skipped, never guessed.
 *
 * Usage:
 *   node scripts/backfill-savt-memberships.cjs            # dry run (report only)
 *   node scripts/backfill-savt-memberships.cjs --apply    # write the changes
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Poles of different routes closer than this are duplicate suspects. Field GPS
// accuracy runs ±10-55m; 30m catches true duplicates without drowning the
// report in corridor neighbours (tune after the first prod run).
const PROXIMITY_METERS = 30;

// --- Canonical KOD TIANG grammar. MUST mirror packages/shared-utils/src/savt/
// route-code.ts (this script is CJS and cannot import the TS source). ---
const DASH_VARIANTS = /[‐‑‒–—―−]/g;

function canonicalizeRouteCode(value) {
  if (!value) return null;
  const canonical = String(value)
    .replace(DASH_VARIANTS, "-")
    .toUpperCase()
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
  return canonical.length > 0 ? canonical : null;
}

function parsePoleCodeOnRoute(assetCode, canonicalRoute) {
  const canonicalCode = canonicalizeRouteCode(assetCode);
  if (!canonicalCode || !canonicalRoute) return null;
  const prefix = `${canonicalRoute} `;
  if (!canonicalCode.startsWith(prefix)) return null;
  const match = canonicalCode.slice(prefix.length).match(/^(\d+)(.*)$/);
  if (!match) return null;
  return { noTiang: parseInt(match[1], 10), branchSuffix: match[2].trim() };
}

function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`SAVT shared-pole backfill — ${apply ? "APPLY" : "DRY RUN"}\n`);

  // ---------- 1. SAVT visits + route-code canonicalization ----------
  const visits = await prisma.siteVisit.findMany({
    where: { operationalScope: "SAVT" },
    select: {
      id: true,
      tenantId: true,
      substationId: true,
      fromPencawangId: true,
      routeCode: true,
      startedAt: true,
    },
    orderBy: { startedAt: "asc" },
  });

  const recodes = [];
  for (const v of visits) {
    const canonical = canonicalizeRouteCode(v.routeCode);
    if (v.routeCode && canonical !== v.routeCode) {
      recodes.push({ id: v.id, from: v.routeCode, to: canonical });
    }
  }
  if (apply) {
    for (const r of recodes) {
      await prisma.siteVisit.update({
        where: { id: r.id },
        data: { routeCode: r.to },
      });
    }
  }
  console.log(`SAVT visits: ${visits.length}`);
  console.log(
    `  route codes ${apply ? "canonicalized" : "needing canonicalization"}: ${recodes.length}`,
  );
  for (const r of recodes.slice(0, 50)) {
    console.log(`    "${r.from}" -> "${r.to}"`);
  }

  // Route identity per visit: canonical code + the feeder-owning Pencawang
  // (From-Pencawang; the visit's own substation as fallback — flag mismatches,
  // that's the plan's "verify substationId == fromPencawangId" open question).
  const routeByVisit = new Map();
  let fromMismatch = 0;
  for (const v of visits) {
    const code = canonicalizeRouteCode(v.routeCode);
    if (!code) continue;
    if (v.fromPencawangId && v.fromPencawangId !== v.substationId) fromMismatch++;
    routeByVisit.set(v.id, {
      tenantId: v.tenantId,
      code,
      feederSubstationId: v.fromPencawangId ?? v.substationId,
    });
  }
  console.log(
    `  visits where fromPencawangId != substationId (feeder anchored on From): ${fromMismatch}`,
  );

  // ---------- 2. Evidence: which poles belong to which route ----------
  // A pole's routes = the SAVT visits it was created during, linked to, or
  // inspected in. The assetCode must parse on the route to count.
  const visitIds = [...routeByVisit.keys()];
  const [createdAssets, linkRows, inspRows] = await Promise.all([
    prisma.asset.findMany({
      where: { createdDuringVisitId: { in: visitIds } },
      select: { id: true, createdDuringVisitId: true },
    }),
    prisma.siteVisitAsset.findMany({
      where: { siteVisitId: { in: visitIds } },
      select: { assetId: true, siteVisitId: true },
    }),
    prisma.inspection.findMany({
      where: { siteVisitId: { in: visitIds } },
      select: { assetId: true, siteVisitId: true },
    }),
  ]);

  // assetId -> Map(routeKey -> route), routeKey = feederSubstationId + code.
  const routesByAsset = new Map();
  const addEvidence = (assetId, visitId) => {
    const route = routeByVisit.get(visitId);
    if (!route) return;
    let routes = routesByAsset.get(assetId);
    if (!routes) routesByAsset.set(assetId, (routes = new Map()));
    routes.set(`${route.feederSubstationId}::${route.code}`, route);
  };
  for (const a of createdAssets) addEvidence(a.id, a.createdDuringVisitId);
  for (const l of linkRows) addEvidence(l.assetId, l.siteVisitId);
  for (const i of inspRows) addEvidence(i.assetId, i.siteVisitId);

  const assetIds = [...routesByAsset.keys()];
  const assets = assetIds.length
    ? await prisma.asset.findMany({
        where: { id: { in: assetIds } },
        select: {
          id: true,
          assetCode: true,
          latitude: true,
          longitude: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const assetById = new Map(assets.map((a) => [a.id, a]));

  // Parse every asset against every route it has evidence for.
  // memberships: routeKey -> Map(assetId -> {noTiang, branchSuffix})
  const membershipsByRoute = new Map();
  const routeMeta = new Map(); // routeKey -> route
  const unparsed = [];
  for (const [assetId, routes] of routesByAsset) {
    const asset = assetById.get(assetId);
    if (!asset) continue;
    let matched = false;
    for (const [routeKey, route] of routes) {
      const parsed = parsePoleCodeOnRoute(asset.assetCode, route.code);
      if (!parsed) continue;
      matched = true;
      routeMeta.set(routeKey, route);
      let members = membershipsByRoute.get(routeKey);
      if (!members) membershipsByRoute.set(routeKey, (members = new Map()));
      members.set(assetId, parsed);
    }
    if (!matched) {
      unparsed.push({ asset, routes: [...routes.values()].map((r) => r.code) });
    }
  }

  // ---------- 3a. Per-route No. Tiang collisions ----------
  const collisions = [];
  for (const [routeKey, members] of membershipsByRoute) {
    const seen = new Map(); // "noTiang|branch" -> assetId (first by createdAt)
    const ordered = [...members.entries()].sort(
      (a, b) => assetById.get(a[0]).createdAt - assetById.get(b[0]).createdAt,
    );
    for (const [assetId, m] of ordered) {
      const key = `${m.noTiang}${m.branchSuffix}`;
      const first = seen.get(key);
      if (first) {
        collisions.push({
          route: routeMeta.get(routeKey).code,
          noTiang: key,
          keptAsset: assetById.get(first).assetCode,
          droppedAssetId: assetId,
        });
        members.delete(assetId); // deterministic: first-created wins
      } else {
        seen.set(key, assetId);
      }
    }
  }

  // ---------- 3b. GPS-proximity duplicate suspects across routes ----------
  const suspects = [];
  const located = assets.filter((a) => a.latitude != null && a.longitude != null);
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      const a = located[i];
      const b = located[j];
      const routesA = [...(routesByAsset.get(a.id)?.values() ?? [])].map((r) => r.code);
      const routesB = [...(routesByAsset.get(b.id)?.values() ?? [])].map((r) => r.code);
      // Only DIFFERENT-route pairs — same-route neighbours are just the line.
      if (routesA.some((r) => routesB.includes(r))) continue;
      const d = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
      if (d <= PROXIMITY_METERS) {
        suspects.push({
          a: a.assetCode,
          routesA,
          b: b.assetCode,
          routesB,
          meters: Math.round(d),
        });
      }
    }
  }

  // ---------- 3c. Duplicate Pencawang codes per tenant ----------
  const substations = await prisma.substation.findMany({
    select: { tenantId: true, code: true, name: true, isActive: true },
  });
  const byTenantCode = new Map();
  for (const s of substations) {
    if (!s.isActive) continue;
    const key = `${s.tenantId}::${(s.code ?? "").trim().toUpperCase()}`;
    if (!(s.code ?? "").trim()) continue;
    (byTenantCode.get(key) ?? byTenantCode.set(key, []).get(key)).push(s);
  }
  const pencawangDupes = [...byTenantCode.values()].filter((list) => list.length > 1);

  // ---------- 4. Apply memberships ----------
  let feederCount = 0;
  let membershipCount = 0;
  for (const [routeKey, members] of membershipsByRoute) {
    const route = routeMeta.get(routeKey);
    feederCount++;
    membershipCount += members.size;
    if (!apply) continue;

    const feeder = await prisma.feeder.upsert({
      where: {
        substationId_code: {
          substationId: route.feederSubstationId,
          code: route.code,
        },
      },
      create: {
        tenantId: route.tenantId,
        substationId: route.feederSubstationId,
        code: route.code,
        kind: "SAVT",
      },
      update: {},
    });

    // Pass 1: memberships. Pass 2: per-route fed-from parents (a parent's
    // membership must exist before its children resolve against it).
    const assetIdByKey = new Map();
    for (const [assetId, m] of members) {
      assetIdByKey.set(`${m.noTiang}|${m.branchSuffix}`, assetId);
      await prisma.poleFeederMembership.upsert({
        where: { assetId_feederId: { assetId, feederId: feeder.id } },
        create: {
          assetId,
          feederId: feeder.id,
          sequenceIndex: m.noTiang,
          branchSuffix: m.branchSuffix,
        },
        update: { sequenceIndex: m.noTiang, branchSuffix: m.branchSuffix },
      });
    }
    const trunkNumbers = [...members.values()]
      .filter((m) => !m.branchSuffix)
      .map((m) => m.noTiang)
      .sort((x, y) => x - y);
    for (const [assetId, m] of members) {
      // Branch -> its trunk pole; trunk N -> nearest existing lower trunk.
      const maxTrunk = m.branchSuffix ? m.noTiang : m.noTiang - 1;
      const parentTrunk = trunkNumbers.filter((n) => n <= maxTrunk).pop();
      const parentAssetId =
        parentTrunk !== undefined ? assetIdByKey.get(`${parentTrunk}|`) : undefined;
      if (parentAssetId && parentAssetId !== assetId) {
        await prisma.poleFeederMembership.update({
          where: { assetId_feederId: { assetId, feederId: feeder.id } },
          data: { fedFromAssetId: parentAssetId },
        });
      }
    }
  }

  // ---------- Report ----------
  console.log(`\nSAVT poles with route evidence: ${assetIds.length}`);
  console.log(
    `  ${apply ? "wrote" : "would write"}: ${feederCount} feeders, ${membershipCount} memberships`,
  );

  if (unparsed.length) {
    console.log(
      `\nPoles whose code parses on NONE of their routes (skipped, fix by hand): ${unparsed.length}`,
    );
    for (const u of unparsed.slice(0, 50)) {
      console.log(`  "${u.asset.assetCode}" (routes: ${u.routes.join(" | ")})`);
    }
    if (unparsed.length > 50) console.log(`  ...and ${unparsed.length - 50} more`);
  }

  if (collisions.length) {
    console.log(
      `\nNo. Tiang collisions (first-created kept, later duplicate SKIPPED): ${collisions.length}`,
    );
    for (const c of collisions.slice(0, 50)) {
      console.log(
        `  route ${c.route} No. ${c.noTiang}: kept "${c.keptAsset}", skipped asset ${c.droppedAssetId}`,
      );
    }
  }

  if (suspects.length) {
    console.log(
      `\nDUPLICATE-POLE SUSPECTS (different routes, <= ${PROXIMITY_METERS} m apart — the pre-shared-pole era's duplicated shared poles): ${suspects.length}`,
    );
    for (const s of suspects.slice(0, 100)) {
      console.log(
        `  "${s.a}" [${s.routesA.join(",")}] <-> "${s.b}" [${s.routesB.join(",")}] : ${s.meters} m`,
      );
    }
  } else {
    console.log(
      `\nNo duplicate-pole suspects across routes (<= ${PROXIMITY_METERS} m) — clean.`,
    );
  }

  if (pencawangDupes.length) {
    console.log(`\nDUPLICATE PENCAWANG CODES (same tenant): ${pencawangDupes.length}`);
    for (const list of pencawangDupes.slice(0, 50)) {
      console.log(
        `  ${list[0].code}: ${list.map((s) => `"${s.name ?? ""}"`).join(" vs ")}`,
      );
    }
  } else {
    console.log(`\nNo duplicate Pencawang codes — clean.`);
  }

  if (!apply) console.log("\nDRY RUN - re-run with --apply to write these changes.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

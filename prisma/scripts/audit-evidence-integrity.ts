/**
 * READ-ONLY evidence-integrity audit — finds inspections whose Smart-Sensor
 * (clearance / KELEGAAN) photo was NOT captured at the pole with the rest of the
 * work: the "measure the height somewhere else, in a batch" pattern.
 *
 * It writes NOTHING. There is no --apply. It only runs SELECTs and prints a
 * report, so it is safe to run against production.
 *
 *   pnpm tsx prisma/scripts/audit-evidence-integrity.ts                 # all teams
 *   pnpm tsx prisma/scripts/audit-evidence-integrity.ts --mainhead GERIK
 *   pnpm tsx prisma/scripts/audit-evidence-integrity.ts --team "Gerik Survey"
 *   pnpm tsx prisma/scripts/audit-evidence-integrity.ts --days 120       # window
 *   pnpm tsx prisma/scripts/audit-evidence-integrity.ts --json           # machine output
 *
 * Requires DATABASE_URL to point at the target database (prod = the VPS .env).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT MEASURES, and why each signal is trustworthy on its own terms.
 *
 * The "clearance photo" is an InspectionImage whose templateItemId points to a
 * checklist item whose label contains KELEGAAN (the Smart-Sensor height reading).
 * The "pole photos" are that same inspection's OTHER geotagged photos — the
 * genuine at-the-pole documentation. Per the field report the pole work is real;
 * only the height is faked, so the honest pole photos are the reference.
 *
 *  1. TIME CONTRAST (per visit) — the headline, and it uses NO GPS at all, so no
 *     accuracy / canopy / map-pick caveat touches it. Compare the time SPAN of a
 *     visit's clearance photos against the span of its pole photos. A crew that
 *     walked poles for hours but "measured" all of them inside a few minutes
 *     batched the readings. Uses the photo's device `timestamp` (capture time),
 *     never `createdAt` (server insert — identical for a whole offline batch, so
 *     useless here).
 *
 *  2. PHOTO-TO-PHOTO DISTANCE (per inspection) — GPS-error-robust, because both
 *     fixes come from the same phone minutes apart so the error largely cancels.
 *     Distance from the clearance photo to the centroid of that inspection's pole
 *     photos. A large value means the reading was taken away from the pole work.
 *     A zoom / out-of-reach offset is common to ALL the crew's photos, so it
 *     cancels here and does NOT inflate this number.
 *
 *  3. PHOTO-TO-POLE DISTANCE (per inspection) — the absolute backstop, looser
 *     because it must tolerate the honest zoom / no-access offset AND because the
 *     pole's own coordinate may be a (precise) satellite map-pick or a (noisy)
 *     GPS fix — the source is not yet stored, so treat this as corroboration, not
 *     proof.
 *
 * A visit is FLAGGED when the batch signature is present: many clearance photos,
 * their time span tiny next to the pole-photo span, and/or their locations far
 * from where the poles were actually photographed. Every threshold is a named
 * constant below — tune them against the real distribution once you have run it.
 */
import { PrismaClient } from '@prisma/client';

// ── Tunables (deliberately conservative — flag the egregious, not the marginal).
const WINDOW_DAYS_DEFAULT = 180; // how far back to look
const KELEGAAN_MATCH = 'KELEGAAN'; // template-item label substring (upper-cased)
// Photo↔photo: an honest zoom / no-access offset is tens of metres; a batched
// reading is hundreds+. 200 m sits clear of the honest ceiling.
const PHOTO_TO_PHOTO_FLAG_M = 200;
// Photo↔pole: looser, for the reasons in signal 3 above.
const PHOTO_TO_POLE_FLAG_M = 300;
// Time batching: N+ clearance photos whose whole span is under M minutes, while
// the pole photos of the same visit span at least CONTRAST× longer.
const BATCH_MIN_CLEARANCE_PHOTOS = 4;
const BATCH_MAX_SPAN_MIN = 15;
const BATCH_SPAN_CONTRAST = 6;

type Args = {
  mainhead?: string;
  team?: string;
  days: number;
  json: boolean;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const days = Number(get('--days'));
  return {
    mainhead: get('--mainhead'),
    team: get('--team'),
    days: Number.isFinite(days) && days > 0 ? days : WINDOW_DAYS_DEFAULT,
    json: argv.includes('--json'),
  };
}

/** Metres between two lat/lng points (haversine). */
function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Geo = { latitude: number; longitude: number };
const hasGeo = (p: {
  latitude: number | null;
  longitude: number | null;
}): p is { latitude: number; longitude: number } =>
  typeof p.latitude === 'number' &&
  Number.isFinite(p.latitude) &&
  typeof p.longitude === 'number' &&
  Number.isFinite(p.longitude) &&
  // A 0/0 fix is the null-island sentinel, never a real Malaysian pole.
  !(p.latitude === 0 && p.longitude === 0);

function centroid(points: Geo[]): Geo | null {
  if (points.length === 0) return null;
  const sum = points.reduce(
    (acc, p) => ({ latitude: acc.latitude + p.latitude, longitude: acc.longitude + p.longitude }),
    { latitude: 0, longitude: 0 },
  );
  return { latitude: sum.latitude / points.length, longitude: sum.longitude / points.length };
}

const fmtDuration = (ms: number) => {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  return `${m}m${String(s).padStart(2, '0')}s`;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);

  try {
    // KELEGAAN checklist items, so we can tell a clearance photo from a pole photo.
    const kelegaanItems = await prisma.inspectionTemplateItem.findMany({
      where: { label: { contains: KELEGAAN_MATCH, mode: 'insensitive' } },
      select: { id: true },
    });
    const kelegaanItemIds = new Set(kelegaanItems.map((i) => i.id));

    // All inspections in the window, with their images + pole + visit + crew.
    const inspections = await prisma.inspection.findMany({
      where: {
        createdAt: { gte: since },
        siteVisit: args.mainhead
          ? { mainhead: { contains: args.mainhead, mode: 'insensitive' } }
          : args.team
            ? { team: { name: { contains: args.team, mode: 'insensitive' } } }
            : undefined,
      },
      select: {
        id: true,
        asset: { select: { assetCode: true, latitude: true, longitude: true } },
        siteVisit: {
          select: {
            id: true,
            mainhead: true,
            pencawangName: true,
            pencawangCode: true,
            team: { select: { name: true, code: true } },
          },
        },
        inspectionImages: {
          select: {
            templateItemId: true,
            latitude: true,
            longitude: true,
            timestamp: true,
          },
        },
      },
    });

    // ── Per-inspection findings, grouped up to visit then team.
    type VisitAgg = {
      visitId: string;
      mainhead: string;
      pencawang: string;
      team: string;
      teamCode: string;
      poleCount: number;
      clearanceTimes: number[];
      poleTimes: number[];
      farPhotoToPhoto: { pole: string; meters: number }[];
      farPhotoToPole: { pole: string; meters: number }[];
      clearanceGeos: Geo[];
      poleGeos: Geo[];
      // Inspections where DIST↔ph could actually be computed (clearance photo
      // had geo AND there was a pole photo to compare it to) — the denominator
      // for the "what fraction is off" proportion, so 1-of-400 reads as noise
      // and 151-of-278 reads as systematic.
      comparable: number;
    };
    const visits = new Map<string, VisitAgg>();

    // Data-coverage counters — resolve WHY a signal did or didn't fire. If few
    // photos carry a device timestamp, the TIME signal simply had nothing to
    // work with (a data gap, not an all-clear).
    let imgTotal = 0;
    let imgWithTimestamp = 0;
    let imgWithGeo = 0;

    for (const insp of inspections) {
      const v = insp.siteVisit;
      const key = v.id;
      let agg = visits.get(key);
      if (!agg) {
        agg = {
          visitId: v.id,
          mainhead: v.mainhead ?? '—',
          pencawang: v.pencawangName ?? v.pencawangCode ?? '—',
          team: v.team?.name ?? '—',
          teamCode: v.team?.code ?? '—',
          poleCount: 0,
          clearanceTimes: [],
          poleTimes: [],
          farPhotoToPhoto: [],
          farPhotoToPole: [],
          clearanceGeos: [],
          poleGeos: [],
          comparable: 0,
        };
        visits.set(key, agg);
      }
      agg.poleCount += 1;

      for (const img of insp.inspectionImages) {
        imgTotal += 1;
        if (img.timestamp) imgWithTimestamp += 1;
        if (hasGeo(img)) imgWithGeo += 1;
      }

      const clearancePhotos = insp.inspectionImages.filter(
        (img) => img.templateItemId && kelegaanItemIds.has(img.templateItemId),
      );
      const polePhotos = insp.inspectionImages.filter(
        (img) => !img.templateItemId || !kelegaanItemIds.has(img.templateItemId),
      );

      // Times (device capture time only — createdAt is worthless for offline batches).
      for (const p of clearancePhotos) {
        if (p.timestamp) agg.clearanceTimes.push(p.timestamp.getTime());
      }
      for (const p of polePhotos) {
        if (p.timestamp) agg.poleTimes.push(p.timestamp.getTime());
      }

      const clearanceGeos = clearancePhotos.filter(hasGeo);
      const poleGeos = polePhotos.filter(hasGeo);
      agg.clearanceGeos.push(...clearanceGeos);
      agg.poleGeos.push(...poleGeos);

      if (clearanceGeos.length > 0) {
        const cCentroid = centroid(clearanceGeos)!;

        // Signal 2 — clearance vs this inspection's pole photos.
        const poleCentroid = centroid(poleGeos);
        if (poleCentroid) {
          agg.comparable += 1;
          const d = distanceMeters(cCentroid, poleCentroid);
          if (d >= PHOTO_TO_PHOTO_FLAG_M) {
            agg.farPhotoToPhoto.push({ pole: insp.asset.assetCode, meters: Math.round(d) });
          }
        }

        // Signal 3 — clearance vs the pole's own coordinate.
        if (hasGeo(insp.asset)) {
          const d = distanceMeters(cCentroid, insp.asset);
          if (d >= PHOTO_TO_POLE_FLAG_M) {
            agg.farPhotoToPole.push({ pole: insp.asset.assetCode, meters: Math.round(d) });
          }
        }
      }
    }

    // ── Score + sort visits; keep only those with a signal.
    const spanMs = (times: number[]) =>
      times.length < 2 ? 0 : Math.max(...times) - Math.min(...times);

    const flagged = [...visits.values()]
      .map((v) => {
        const clearanceSpan = spanMs(v.clearanceTimes);
        const poleSpan = spanMs(v.poleTimes);
        const batched =
          v.clearanceTimes.length >= BATCH_MIN_CLEARANCE_PHOTOS &&
          clearanceSpan <= BATCH_MAX_SPAN_MIN * 60_000 &&
          poleSpan >= clearanceSpan * BATCH_SPAN_CONTRAST;

        // Whole-visit spatial: clearance photos tight, poles spread.
        let clusterNote: string | null = null;
        if (v.clearanceGeos.length >= BATCH_MIN_CLEARANCE_PHOTOS && v.poleGeos.length >= 2) {
          const cC = centroid(v.clearanceGeos)!;
          const pC = centroid(v.poleGeos)!;
          const clearanceRadius = Math.max(...v.clearanceGeos.map((g) => distanceMeters(g, cC)));
          const poleRadius = Math.max(...v.poleGeos.map((g) => distanceMeters(g, pC)));
          if (poleRadius >= 150 && clearanceRadius <= 50 && poleRadius >= clearanceRadius * 3) {
            clusterNote = `clearance photos within ${Math.round(clearanceRadius)} m while poles span ${Math.round(poleRadius)} m`;
          }
        }

        const signals =
          (batched ? 1 : 0) +
          (v.farPhotoToPhoto.length > 0 ? 1 : 0) +
          (v.farPhotoToPole.length > 0 ? 1 : 0) +
          (clusterNote ? 1 : 0);

        // Fraction of comparable inspections whose clearance photo is off. This is
        // what separates systematic (54% of 278) from a stray fix (1 of 404).
        const proportion =
          v.comparable > 0 ? v.farPhotoToPhoto.length / v.comparable : 0;
        // STRONG = a pattern, not an outlier: many far photos AND a real share of
        // the visit, or the time/cluster signature fired outright.
        const strong =
          batched ||
          !!clusterNote ||
          (v.farPhotoToPhoto.length >= 5 && proportion >= 0.15);

        return { v, clearanceSpan, poleSpan, batched, clusterNote, signals, proportion, strong };
      })
      .filter((r) => r.signals > 0)
      .sort(
        (a, b) =>
          Number(b.strong) - Number(a.strong) ||
          b.proportion - a.proportion ||
          b.v.farPhotoToPhoto.length - a.v.farPhotoToPhoto.length,
      );

    const strongList = flagged.filter((r) => r.strong);
    const weakList = flagged.filter((r) => !r.strong);

    if (args.json) {
      console.log(JSON.stringify(flagged, null, 2));
      return;
    }

    // ── Human report.
    const scanScope = args.mainhead
      ? `mainhead ~ "${args.mainhead}"`
      : args.team
        ? `team ~ "${args.team}"`
        : 'ALL teams';
    console.log('');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('  ASCURE — EVIDENCE INTEGRITY AUDIT  (read-only, nothing written)');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`  Scope   : ${scanScope}`);
    console.log(`  Window  : last ${args.days} days (since ${since.toISOString().slice(0, 10)})`);
    console.log(`  Scanned : ${inspections.length} inspections across ${visits.size} visits`);
    const pct = (n: number) => (imgTotal > 0 ? Math.round((n / imgTotal) * 100) : 0);
    console.log(
      `  Photos  : ${imgTotal} total · ${pct(imgWithGeo)}% geotagged · ${pct(imgWithTimestamp)}% with a capture time`,
    );
    if (imgWithTimestamp === 0) {
      console.log('            ⚠ NO capture times stored → the TIME / batch signal cannot run on this data.');
    }
    console.log(
      `  Flagged : ${strongList.length} STRONG (systematic) + ${weakList.length} weak/low-confidence`,
    );
    console.log('');

    // Per-team rollup so the outlier crew is obvious — STRONG visits only, since
    // those are the ones worth a conversation.
    const byTeam = new Map<string, { team: string; code: string; strong: number; weak: number }>();
    for (const r of flagged) {
      const k = r.v.team;
      const t = byTeam.get(k) ?? { team: r.v.team, code: r.v.teamCode, strong: 0, weak: 0 };
      if (r.strong) t.strong += 1;
      else t.weak += 1;
      byTeam.set(k, t);
    }
    if (byTeam.size > 0) {
      console.log('  ── By team (strong-signal visits first) ─────────────────────');
      for (const t of [...byTeam.values()].sort((a, b) => b.strong - a.strong || b.weak - a.weak)) {
        console.log(`   • ${t.team} (${t.code}) — ${t.strong} strong, ${t.weak} weak`);
      }
      console.log('');
    }

    const printVisit = (r: (typeof flagged)[number]) => {
      const v = r.v;
      const share =
        v.comparable > 0 ? ` (${Math.round(r.proportion * 100)}% of ${v.comparable} measured)` : '';
      console.log('  ──────────────────────────────────────────────────────────────');
      console.log(`  ${v.team} (${v.teamCode})  ·  ${v.mainhead}  ·  ${v.pencawang}`);
      console.log(`  Visit ${v.visitId}  —  ${v.poleCount} poles`);
      if (r.batched) {
        console.log(
          `   ⚠ TIME     ${v.clearanceTimes.length} clearance photos span only ${fmtDuration(r.clearanceSpan)}, ` +
            `but pole photos span ${fmtDuration(r.poleSpan)}  →  readings BATCHED`,
        );
      }
      if (r.clusterNote) {
        console.log(`   ⚠ CLUSTER  ${r.clusterNote}`);
      }
      if (v.farPhotoToPhoto.length > 0) {
        const worst = [...v.farPhotoToPhoto].sort((a, b) => b.meters - a.meters).slice(0, 6);
        console.log(
          `   ⚠ DIST↔ph  ${v.farPhotoToPhoto.length} clearance photo(s) ≥${PHOTO_TO_PHOTO_FLAG_M} m from their pole photos${share}:`,
        );
        console.log(`             ${worst.map((f) => `${f.pole} (${f.meters} m)`).join(', ')}`);
      }
      if (v.farPhotoToPole.length > 0) {
        const worst = [...v.farPhotoToPole].sort((a, b) => b.meters - a.meters).slice(0, 6);
        console.log(
          `   · DIST↔pole ${v.farPhotoToPole.length} clearance photo(s) ≥${PHOTO_TO_POLE_FLAG_M} m from the pole coord (corroborating):`,
        );
        console.log(`             ${worst.map((f) => `${f.pole} (${f.meters} m)`).join(', ')}`);
      }
    };

    if (strongList.length > 0) {
      console.log('  ══ STRONG — systematic, worth acting on ═════════════════════');
      strongList.forEach(printVisit);
      console.log('');
    }
    if (weakList.length > 0) {
      console.log('  ══ WEAK / low-confidence — a few stray photos, likely noise ═');
      console.log('  (Shown so nothing is hidden; a lone far fix is usually bad GPS,');
      console.log('   not fraud. Do NOT act on these without eyeballing them.)');
      for (const r of weakList) {
        const worst = r.v.farPhotoToPhoto.concat(r.v.farPhotoToPole).sort((a, b) => b.meters - a.meters)[0];
        console.log(
          `   • ${r.v.team} (${r.v.teamCode}) · ${r.v.mainhead} · ${r.v.pencawang} — ` +
            `${r.v.farPhotoToPhoto.length} far of ${r.v.comparable}` +
            (worst ? `, worst ${worst.pole} (${worst.meters} m)` : ''),
        );
      }
      console.log('');
    }
    console.log('  Legend: TIME/CLUSTER/DIST↔ph are GPS-error-robust; DIST↔pole is a');
    console.log('  softer backstop (pole coord source not yet stored). Tune thresholds');
    console.log('  at the top of this file against what you see here.');
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Shift a SAVT route's clearance data ONE POLE FORWARD (pole n -> pole n+1).
 *
 * Why: on a SAVT route the clearance reading of span n -> n+1 belongs on the TO
 * pole (n+1) — the QR AUTO pipeline and the TNB report read it there. Some crews
 * recorded it on the FROM pole (n) instead, so every span reads one pole early.
 * This moves, for each MAIN pole of the route (1, 2, 3 …):
 *   - the reading        (GAMBAR KELEGAAN / BACAAN KELEGAAN — the OCR item)
 *   - the terrain        (KEADAAN DI TAPAK)
 *   - the reading photo  (InspectionImage tagged to the reading item)
 * from pole n to pole n+1. Pole 1 ends up with none of them (it has no
 * incoming span). Branch poles (5/1 …) are left untouched and listed.
 *
 * The route is picked exactly like the SAVT checklist export: every exportable
 * inspection (submitted, or sent back for re-inspection) of SAVT visits whose
 * routeCode == --route, latest per pole, numbered membership-first.
 *
 * SAFETY — a route is REFUSED (nothing written for it) when:
 *   - pole 1 has no reading            (route looks already correct)
 *   - the last main pole has a reading or reading photo (data would be lost)
 *   - No. Tiang has a duplicate or a gap in the main sequence
 *   - a moved item carries a defect    (would need the full verdict re-run)
 *   - a pole's template lacks the reading / terrain item, or a visit is cancelled
 *   - (apply) a photo file to move is missing on disk
 *
 * Writes: InspectionResult values + the matching InspectionItemResult
 * (result/remark) on each pole, InspectionImage re-pointed to the new pole,
 * Inspection.lastAmendedAt/By stamped (shows as "Amended (MYT) / Amended By").
 * Photo FILES are COPIED into the new pole's folder; the originals are KEPT,
 * so restoring the DB backup is a complete rollback. A JSON log of every
 * before/after value is written next to where you run it.
 *
 * DRY-RUN by default (prints the plan, writes nothing):
 *   tsx prisma/scripts/shift-savt-kelegaan.ts --route "KC - KJG" [--route "…"]
 * Apply (one or more routes; --by = the ADMIN account credited as "Amended By"):
 *   tsx prisma/scripts/shift-savt-kelegaan.ts --route "KC - KJG" --apply --by admin@example.com
 * Options:
 *   --uploads-dir <path>   photo root (default: $UPLOADS_DIR, else apps/api/uploads)
 *
 * Requires DATABASE_URL to point at the target database.
 */
import { copyFile, mkdir, rm, stat, writeFile } from 'fs/promises';
import { resolve } from 'path';
import {
  FeederKind,
  InspectionCompletionStatus,
  InspectionItemResultSource,
  InspectionItemResultValue,
  OperationalScope,
  Prisma,
  PrismaClient,
  SiteVisitStatus,
} from '@prisma/client';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
function argValues(flag: string): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === flag && argv[i + 1] && !argv[i + 1].startsWith('--')) out.push(argv[i + 1]);
  });
  return out;
}
const ROUTES = argValues('--route').map((r) => r.trim()).filter(Boolean);
const BY_EMAIL = argValues('--by')[0]?.trim().toLowerCase();
const UPLOADS_DIR = resolve(
  argValues('--uploads-dir')[0] ??
    process.env.UPLOADS_DIR ??
    resolve(process.cwd(), 'apps', 'api', 'uploads'),
);

// Same order as the API's KELEGAAN_LABEL_ALIASES (checklist-columns.ts).
const READING_LABELS = [
  'GAMBAR KELEGAAN 1',
  'BACAAN KELEGAAN 1',
  'KELEGAAN 1',
  'BACAAN KELEGAAN',
  'GAMBAR KELEGAAN',
  'KELEGAAN',
];
const TERRAIN_LABELS = ['KEADAAN DI TAPAK', 'KEADAAN DI TAPAK 1'];

const norm = (v: string | null | undefined) =>
  (v ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

// packages/shared-utils canonicalizeSavtRouteCode (inlined: scripts run standalone)
function canonicalRoute(value: string | null | undefined): string | null {
  if (!value) return null;
  const c = value
    .replace(/[‐‑‒–—―−]/g, '-')
    .toUpperCase()
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
  return c || null;
}

// reports.service stripRoutePrefix: "KC - KJG 26" -> "26"
function stripRoutePrefix(assetCode: string, routeCode: string): string {
  const prefix = `${routeCode.trim()} `;
  return assetCode.toUpperCase().startsWith(prefix.toUpperCase())
    ? assetCode.slice(prefix.length).trim()
    : assetCode;
}

// ── types ────────────────────────────────────────────────────────────────────
const VALUE_KEYS = [
  'valueText',
  'valueNumber',
  'valueBoolean',
  'valueDate',
  'valueDateTime',
  'valueJson',
] as const;
type Values = {
  valueText: string | null;
  valueNumber: Prisma.Decimal | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueDateTime: Date | null;
  valueJson: Prisma.JsonValue | null;
};
const EMPTY: Values = {
  valueText: null,
  valueNumber: null,
  valueBoolean: null,
  valueDate: null,
  valueDateTime: null,
  valueJson: null,
};

function pickValues(row: Partial<Values> | undefined): Values {
  if (!row) return { ...EMPTY };
  const out = { ...EMPTY };
  for (const k of VALUE_KEYS) (out as Record<string, unknown>)[k] = row[k] ?? null;
  return out;
}
function isEmpty(v: Values): boolean {
  return VALUE_KEYS.every((k) => {
    const x = v[k];
    if (x == null) return true;
    if (typeof x === 'string') return x.trim() === '';
    if (Array.isArray(x)) return x.length === 0;
    return false;
  });
}
function show(v: Values): string {
  if (isEmpty(v)) return '—';
  if (v.valueText?.trim()) return v.valueText.trim();
  if (v.valueNumber != null) return v.valueNumber.toString();
  if (v.valueBoolean != null) return String(v.valueBoolean);
  if (Array.isArray(v.valueJson)) return (v.valueJson as unknown[]).join(', ');
  return JSON.stringify(v.valueJson ?? v.valueDate ?? v.valueDateTime);
}
function toWrite(v: Values) {
  return {
    valueText: v.valueText,
    valueNumber: v.valueNumber,
    valueBoolean: v.valueBoolean,
    valueDate: v.valueDate,
    valueDateTime: v.valueDateTime,
    valueJson: v.valueJson == null ? Prisma.DbNull : (v.valueJson as Prisma.InputJsonValue),
  };
}

type TemplateItem = { id: string; label: string };
type ItemResultRow = {
  id: string;
  checklistItemId: string | null;
  label: string;
  result: InspectionItemResultValue;
  remark: string | null;
  isDefect: boolean;
  isEmergency: boolean;
  defect: { id: string } | null;
};
type Photo = { id: string; filename: string };

interface Pole {
  noTiang: string;
  inspectionId: string;
  siteVisitId: string;
  assetCode: string;
  readingItem: TemplateItem;
  terrainItem: TemplateItem;
  reading: Values;
  terrain: Values;
  readingIR: ItemResultRow | null;
  terrainIR: ItemResultRow | null;
  photos: Photo[];
}

function findItem(items: TemplateItem[], labels: string[]): TemplateItem | null {
  for (const label of labels) {
    const hit = items.find((i) => norm(i.label) === label);
    if (hit) return hit;
  }
  return null;
}
function findIR(rows: ItemResultRow[], item: TemplateItem): ItemResultRow | null {
  return (
    rows.find((r) => r.checklistItemId === item.id) ??
    rows.find(
      (r) => !(r.isEmergency && r.checklistItemId === null) && norm(r.label) === norm(item.label),
    ) ??
    null
  );
}

// ── one route ────────────────────────────────────────────────────────────────
async function planRoute(prisma: PrismaClient, route: string) {
  const refuse = (why: string[]) => ({ ok: false as const, why });

  const inspections = await prisma.inspection.findMany({
    where: {
      OR: [
        { completionStatus: InspectionCompletionStatus.SUBMITTED },
        { reinspectionRequestedAt: { not: null } },
      ],
      siteVisit: { operationalScope: OperationalScope.SAVT, routeCode: route },
    },
    orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      tenantId: true,
      assetId: true,
      siteVisitId: true,
      siteVisit: { select: { status: true, lifecycleStatus: true } },
      asset: { select: { assetCode: true } },
      template: {
        select: { sections: { select: { items: { select: { id: true, label: true } } } } },
      },
      results: {
        select: {
          templateItemId: true,
          valueText: true,
          valueNumber: true,
          valueBoolean: true,
          valueDate: true,
          valueDateTime: true,
          valueJson: true,
        },
      },
      itemResults: {
        where: { source: InspectionItemResultSource.SURVEY },
        select: {
          id: true,
          checklistItemId: true,
          label: true,
          result: true,
          remark: true,
          isDefect: true,
          isEmergency: true,
          defect: { select: { id: true } },
        },
      },
      inspectionImages: { select: { id: true, filename: true, templateItemId: true } },
    },
  });

  if (inspections.length === 0) {
    const codes = await prisma.siteVisit.findMany({
      where: { operationalScope: OperationalScope.SAVT, routeCode: { not: null } },
      select: { routeCode: true },
      distinct: ['routeCode'],
    });
    const want = canonicalRoute(route);
    const near = codes
      .map((c) => c.routeCode as string)
      .filter((c) => canonicalRoute(c) === want || norm(c).includes(norm(route)));
    return refuse([
      `No submitted SAVT inspections found for route code "${route}".`,
      near.length
        ? `Did you mean: ${near.map((c) => `"${c}"`).join(', ')} ?`
        : 'Check the exact KOD TIANG (as shown in the checklist export).',
    ]);
  }

  const tenants = new Set(inspections.map((i) => i.tenantId));
  if (tenants.size > 1) return refuse([`Route "${route}" exists in ${tenants.size} tenants.`]);
  const tenantId = inspections[0].tenantId;

  // Latest inspection per pole (already newest-first), like the export.
  const latest = new Map<string, (typeof inspections)[number]>();
  for (const i of inspections) if (!latest.has(i.assetId)) latest.set(i.assetId, i);

  // Membership-first No. Tiang on this route, else the assetCode suffix.
  const canon = canonicalRoute(route);
  const memberships = await prisma.poleFeederMembership.findMany({
    where: {
      assetId: { in: [...latest.keys()] },
      feeder: { tenantId, kind: FeederKind.SAVT },
    },
    select: { assetId: true, sequenceIndex: true, branchSuffix: true, feeder: { select: { code: true } } },
  });
  const noByAsset = new Map<string, string>();
  for (const m of memberships) {
    if (canon && m.feeder.code === canon) noByAsset.set(m.assetId, `${m.sequenceIndex}${m.branchSuffix}`);
  }

  const why: string[] = [];
  const warn: string[] = [];
  const mains = new Map<number, Pole>();
  const branches: { noTiang: string; reading: string; photos: number }[] = [];
  const seen = new Map<string, number>();

  for (const insp of latest.values()) {
    const noTiang = (noByAsset.get(insp.assetId) ?? stripRoutePrefix(insp.asset.assetCode, route)).trim();
    seen.set(noTiang, (seen.get(noTiang) ?? 0) + 1);
    if (insp.siteVisit.status === SiteVisitStatus.CANCELLED) {
      why.push(`Tiang ${noTiang}: its visit is CANCELLED.`);
      continue;
    }
    const items: TemplateItem[] = insp.template.sections.flatMap((s) => s.items);
    const readingItem = findItem(items, READING_LABELS);
    const terrainItem = findItem(items, TERRAIN_LABELS);
    const resultOf = (item: TemplateItem | null) =>
      pickValues(item ? insp.results.find((r) => r.templateItemId === item.id) : undefined);
    const photos = readingItem
      ? insp.inspectionImages
          .filter((im) => im.templateItemId === readingItem.id)
          .map((im) => ({ id: im.id, filename: im.filename }))
      : [];

    if (!/^\d+$/.test(noTiang)) {
      branches.push({ noTiang, reading: show(resultOf(readingItem)), photos: photos.length });
      continue;
    }
    if (!readingItem || !terrainItem) {
      why.push(
        `Tiang ${noTiang}: its checklist has no ${!readingItem ? 'reading (GAMBAR/BACAAN KELEGAAN)' : 'KEADAAN DI TAPAK'} item.`,
      );
      continue;
    }
    const itemRows = insp.itemResults as ItemResultRow[];
    mains.set(Number(noTiang), {
      noTiang,
      inspectionId: insp.id,
      siteVisitId: insp.siteVisitId,
      assetCode: insp.asset.assetCode,
      readingItem,
      terrainItem,
      reading: resultOf(readingItem),
      terrain: resultOf(terrainItem),
      readingIR: findIR(itemRows, readingItem),
      terrainIR: findIR(itemRows, terrainItem),
      photos,
    });
  }

  for (const [no, n] of seen) if (n > 1) why.push(`Tiang ${no} appears ${n} times on the route (duplicate No. Tiang).`);
  const N = Math.max(0, ...mains.keys());
  for (let k = 1; k <= N; k++) if (!mains.has(k)) why.push(`Tiang ${k} is missing from the main sequence 1..${N}.`);
  if (N < 2) why.push('Fewer than 2 main poles — nothing to shift.');
  if (why.length) return refuse(why);

  const first = mains.get(1)!;
  const last = mains.get(N)!;
  if (isEmpty(first.reading)) {
    why.push('Tiang 1 has NO reading — this route looks like it already has readings on the TO pole.');
  }
  if (!isEmpty(last.reading) || last.photos.length) {
    why.push(
      `Last pole Tiang ${N} already has a reading (${show(last.reading)}) / ${last.photos.length} photo(s) — shifting would lose it.`,
    );
  }
  for (const p of mains.values()) {
    for (const ir of [p.readingIR, p.terrainIR]) {
      if (ir && (ir.isDefect || ir.defect)) {
        why.push(`Tiang ${p.noTiang}: "${ir.label}" carries a defect — fix by hand instead.`);
      }
    }
  }
  if (why.length) return refuse(why);

  if (!isEmpty(last.terrain)) {
    warn.push(`Last pole Tiang ${N} had terrain "${show(last.terrain)}" — it is replaced by Tiang ${N - 1}'s.`);
  }
  for (const b of branches) {
    if (b.reading !== '—' || b.photos) {
      warn.push(`Branch Tiang ${b.noTiang} (reading ${b.reading}, ${b.photos} photo) is NOT moved.`);
    }
  }
  const visits = new Set([...mains.values()].map((p) => p.siteVisitId));
  if (visits.size > 1) warn.push(`The route's poles come from ${visits.size} visits (latest inspection per pole).`);

  // Plan: target k <- source k-1 (k = 2..N); Tiang 1 <- nothing.
  const steps = [...Array(N).keys()].map((i) => {
    const target = mains.get(i + 1)!;
    const source = i === 0 ? null : mains.get(i)!;
    return { target, source };
  });

  return { ok: true as const, tenantId, steps, branches, warn, N };
}

type Plan = Extract<Awaited<ReturnType<typeof planRoute>>, { ok: true }>;

const photoFile = (inspectionId: string, filename: string) =>
  resolve(UPLOADS_DIR, 'inspections', inspectionId, filename);

/** Photo files the plan would move that are NOT on disk under UPLOADS_DIR. */
async function missingPhotoFiles(plan: Plan): Promise<string[]> {
  const missing: string[] = [];
  for (const { source } of plan.steps) {
    for (const ph of source?.photos ?? []) {
      const f = photoFile(source!.inspectionId, ph.filename);
      try {
        await stat(f);
      } catch {
        missing.push(f);
      }
    }
  }
  return missing;
}

function printPlan(route: string, plan: Plan) {
  console.log(`\nRoute "${route}" — ${plan.N} main poles, ${plan.branches.length} branch poles`);
  console.log('  Tiang | reading before -> after | terrain before -> after | photos before -> after');
  for (const { target, source } of plan.steps) {
    const rAfter = source ? show(source.reading) : '—';
    const tAfter = source ? show(source.terrain) : '—';
    const pAfter = source ? source.photos.length : 0;
    console.log(
      `  ${target.noTiang.padStart(5)} | ${show(target.reading).padStart(8)} -> ${rAfter.padEnd(8)} | ` +
        `${show(target.terrain).padStart(14)} -> ${tAfter.padEnd(14)} | ${target.photos.length} -> ${pAfter}`,
    );
  }
  for (const w of plan.warn) console.log(`  ⚠ ${w}`);
}

// ── apply ────────────────────────────────────────────────────────────────────
async function applyRoute(prisma: PrismaClient, route: string, plan: Plan, byUserId: string) {
  // 1) photo moves (main() already refused the route if any file is missing)
  const moves = plan.steps.flatMap(({ target, source }) =>
    (source?.photos ?? []).map((ph) => ({
      imageId: ph.id,
      filename: ph.filename,
      from: photoFile(source!.inspectionId, ph.filename),
      to: photoFile(target.inspectionId, ph.filename),
      targetInspectionId: target.inspectionId,
      targetItemId: target.readingItem.id,
    })),
  );

  // 2) copy photo files into the new pole's folder (originals are KEPT)
  const copied: string[] = [];
  try {
    for (const m of moves) {
      await mkdir(resolve(m.to, '..'), { recursive: true });
      await copyFile(m.from, m.to);
      copied.push(m.to);
    }
  } catch (e) {
    for (const f of copied) await rm(f, { force: true });
    console.log(`  ✗ FAILED copying photos (${(e as Error).message}) — nothing written.`);
    return false;
  }

  // 3) DB: values, verdict rows, photo rows, amendment stamp — one transaction
  const now = new Date();
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const { target, source } of plan.steps) {
          for (const kind of ['reading', 'terrain'] as const) {
            const item = kind === 'reading' ? target.readingItem : target.terrainItem;
            const before = kind === 'reading' ? target.reading : target.terrain;
            const after = source ? (kind === 'reading' ? source.reading : source.terrain) : { ...EMPTY };
            if (isEmpty(after) && isEmpty(before)) {
              // nothing to clear, but an existing (empty) row is left as is
            } else {
              await tx.inspectionResult.upsert({
                where: { inspectionId_templateItemId: { inspectionId: target.inspectionId, templateItemId: item.id } },
                create: { inspectionId: target.inspectionId, templateItemId: item.id, ...toWrite(after) },
                update: toWrite(after),
              });
            }

            const srcIR = source ? (kind === 'reading' ? source.readingIR : source.terrainIR) : null;
            const tgtIR = kind === 'reading' ? target.readingIR : target.terrainIR;
            const irData = {
              checklistItemId: item.id,
              result: srcIR?.result ?? InspectionItemResultValue.NA,
              remark: srcIR?.remark ?? null,
              isDefect: false,
              isEmergency: false,
              severity: null,
            };
            if (tgtIR) {
              await tx.inspectionItemResult.update({ where: { id: tgtIR.id }, data: irData });
            } else if (srcIR) {
              await tx.inspectionItemResult.create({
                data: { inspectionId: target.inspectionId, label: item.label, ...irData },
              });
            }
          }
          await tx.inspection.update({
            where: { id: target.inspectionId },
            data: { lastAmendedAt: now, lastAmendedById: byUserId },
          });
        }
        for (const m of moves) {
          await tx.inspectionImage.update({
            where: { id: m.imageId },
            data: {
              inspectionId: m.targetInspectionId,
              templateItemId: m.targetItemId,
              url: `/uploads/inspections/${m.targetInspectionId}/${m.filename}`,
            },
          });
        }
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  } catch (e) {
    for (const f of copied) await rm(f, { force: true });
    console.log(`  ✗ FAILED in the database (${(e as Error).message}) — rolled back, nothing written.`);
    return false;
  }

  // 4) audit log of every before/after
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const logFile = resolve(process.cwd(), `shift-savt-kelegaan_${route.replace(/[^A-Za-z0-9]+/g, '_')}_${stamp}.json`);
  await writeFile(
    logFile,
    JSON.stringify(
      {
        route,
        appliedAt: now.toISOString(),
        byUserId,
        uploadsDir: UPLOADS_DIR,
        steps: plan.steps.map(({ target, source }) => ({
          noTiang: target.noTiang,
          inspectionId: target.inspectionId,
          readingBefore: show(target.reading),
          readingAfter: source ? show(source.reading) : '—',
          terrainBefore: show(target.terrain),
          terrainAfter: source ? show(source.terrain) : '—',
          photosIn: (source?.photos ?? []).map((p) => p.id),
        })),
        photoMoves: moves.map(({ imageId, from, to }) => ({ imageId, from, to })),
      },
      null,
      2,
    ),
  );
  console.log(
    `  ✓ APPLIED — ${plan.steps.length} poles updated, ${moves.length} photo(s) moved. Log: ${logFile}`,
  );
  return true;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (ROUTES.length === 0) {
    console.log('Usage: tsx prisma/scripts/shift-savt-kelegaan.ts --route "<KOD TIANG>" [--route …] [--apply --by <admin email>]');
    process.exitCode = 1;
    return;
  }
  const prisma = new PrismaClient();
  try {
    let byUserId = '';
    if (APPLY) {
      if (!BY_EMAIL) {
        console.log('--apply needs --by <email of the ADMIN account to credit as "Amended By">.');
        process.exitCode = 1;
        return;
      }
      const by = await prisma.user.findFirst({
        where: { email: { equals: BY_EMAIL, mode: 'insensitive' } },
        select: { id: true, email: true, role: true },
      });
      if (!by) {
        console.log(`No user with email ${BY_EMAIL}.`);
        process.exitCode = 1;
        return;
      }
      byUserId = by.id;
      console.log(`Amended By: ${by.email} (${by.role})`);
    }
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (nothing is written)'} · photo folder: ${UPLOADS_DIR}`);

    let refused = 0;
    let applied = 0;
    for (const route of ROUTES) {
      const plan = await planRoute(prisma, route);
      if (!plan.ok) {
        refused++;
        console.log(`\nRoute "${route}" — ✗ REFUSED, nothing will be changed:`);
        plan.why.forEach((w) => console.log(`  - ${w}`));
        continue;
      }
      printPlan(route, plan);
      const missing = await missingPhotoFiles(plan);
      if (missing.length) {
        refused++;
        console.log(`  ✗ REFUSED — ${missing.length} photo file(s) not found under ${UPLOADS_DIR}, e.g.:`);
        missing.slice(0, 3).forEach((f) => console.log(`      ${f}`));
        console.log('    Pass --uploads-dir <the folder the API stores uploads in> and re-run.');
        continue;
      }
      const nPhotos = plan.steps.reduce((n, s) => n + (s.source?.photos.length ?? 0), 0);
      console.log(`  ✓ all ${nPhotos} photo file(s) found on disk`);
      if (APPLY) {
        if (await applyRoute(prisma, route, plan, byUserId)) applied++;
        else refused++;
      }
    }
    console.log(
      APPLY
        ? `\nDone: ${applied} route(s) applied, ${refused} refused/failed.`
        : `\nDry-run only: ${ROUTES.length - refused} route(s) ready, ${refused} refused. Re-run with --apply --by <email> to write.`,
    );
    if (APPLY && applied) {
      console.log('Next: re-download the SAVT checklist for these routes; recompile any visual report already at Laporan Selesai.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

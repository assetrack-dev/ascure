/**
 * READ-ONLY diagnostic for the "Asset Details vs checklist download disagree"
 * report. Dumps the GROUND TRUTH for a pole + checklist item: every inspection
 * it has, and for each, the raw InspectionResult columns (valueText / valueNumber
 * / valueBoolean / valueJson / valueDate) behind the item — so we can see WHICH
 * column holds the value and WHICH inspection Asset Details would show.
 *
 * Writes NOTHING (SELECTs only). Safe on prod.
 *
 *   pnpm tsx prisma/scripts/diagnose-checklist-value.ts --pole "D 8/1" --item PVC --pencawang STADIUM
 *
 * Requires DATABASE_URL (export it from .env like the deploy runbook does).
 *
 * How to read it: Asset Details shows the pole's LATEST submitted inspection,
 * resolving each value via text→json(multi)→number→boolean→date. If the value
 * sits in `valueNumber` on that latest inspection but the download shows blank,
 * the DOWNLOAD is the stale reader (it isn't reading that column / mapping the
 * item) — Asset Details is correct. If the value is on an OLDER inspection than
 * the latest, it's an inspection-selection mismatch instead.
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
};

// Mirror of the shared checklistResultValue priority, so the diagnostic shows
// what Asset Details / the map panel resolve.
function resolve(r: {
  valueText: string | null;
  valueNumber: unknown;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueDateTime: Date | null;
  valueJson: unknown;
}): string {
  const text = r.valueText?.trim();
  if (Array.isArray(r.valueJson) && r.valueJson.length > 0) {
    return r.valueJson.map((v) => String(v)).join(', ') + (text ? `, ${text}` : '');
  }
  if (text) return text;
  if (r.valueNumber != null) return String(r.valueNumber);
  if (r.valueBoolean != null) return r.valueBoolean ? 'Yes' : 'No';
  if (r.valueDate != null) return r.valueDate.toISOString().slice(0, 10);
  if (r.valueDateTime != null) return r.valueDateTime.toISOString();
  return '';
}

(async () => {
  const poleQ = arg('--pole') ?? 'D 8/1';
  const itemQ = arg('--item') ?? 'PVC';
  const pencawangQ = arg('--pencawang');

  const assets = await p.asset.findMany({
    where: {
      assetCode: { contains: poleQ, mode: 'insensitive' },
      ...(pencawangQ
        ? { substation: { name: { contains: pencawangQ, mode: 'insensitive' } } }
        : {}),
    },
    select: {
      id: true,
      assetCode: true,
      substation: { select: { name: true, code: true } },
      inspections: {
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          inspectionCycle: true,
          completionStatus: true,
          submittedAt: true,
          updatedAt: true,
          reinspectionRequestedAt: true,
          results: {
            where: { templateItem: { label: { contains: itemQ, mode: 'insensitive' } } },
            select: {
              valueText: true,
              valueNumber: true,
              valueBoolean: true,
              valueDate: true,
              valueDateTime: true,
              valueJson: true,
              updatedAt: true,
              templateItem: { select: { label: true, key: true, inputType: true } },
            },
          },
        },
      },
    },
  });

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`  CHECKLIST VALUE DIAGNOSTIC — pole ~"${poleQ}", item ~"${itemQ}"${pencawangQ ? `, pencawang ~"${pencawangQ}"` : ''}`);
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`  Matched ${assets.length} asset(s).`);

  for (const a of assets) {
    console.log('');
    console.log(`  ── ${a.assetCode}  ·  ${a.substation?.name ?? '—'} (${a.substation?.code ?? '—'})`);
    console.log(`     ${a.inspections.length} inspection(s). Asset Details shows the FIRST submitted/sent-back one below (▶).`);
    // Which inspection Asset Details picks: latest with SUBMITTED or reinspection.
    const shown = a.inspections.find(
      (i) => i.completionStatus === 'SUBMITTED' || i.reinspectionRequestedAt != null,
    );
    for (const insp of a.inspections) {
      const marker = insp.id === shown?.id ? '▶' : ' ';
      console.log(
        `   ${marker} insp ${insp.id.slice(0, 8)} · cycle ${insp.inspectionCycle} · ${insp.completionStatus}` +
          ` · submitted ${insp.submittedAt?.toISOString().slice(0, 16) ?? '—'} · updated ${insp.updatedAt?.toISOString().slice(0, 16) ?? '—'}`,
      );
      if (insp.results.length === 0) {
        console.log(`        (no "${itemQ}" item result on this inspection)`);
      }
      for (const r of insp.results) {
        console.log(
          `        "${r.templateItem?.label}" [${r.templateItem?.inputType}] → resolves: "${resolve(r)}"`,
        );
        console.log(
          `           raw: text=${JSON.stringify(r.valueText)} number=${r.valueNumber ?? 'null'} bool=${r.valueBoolean ?? 'null'} json=${JSON.stringify(r.valueJson)} date=${r.valueDate?.toISOString().slice(0, 10) ?? 'null'} · row updated ${r.updatedAt?.toISOString().slice(0, 16) ?? '—'}`,
        );
      }
    }
  }
  console.log('');
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});

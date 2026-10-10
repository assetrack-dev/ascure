/**
 * One-time backfill: auto "TIDAK PATUH GROUND CLEARANCE" over all collected
 * SAVR data (TNB feedback #3, 2026-10-10). Same evaluation + write the API now
 * runs on every submit / office edit (apps/api/src/inspections/ground-clearance.*),
 * i.e. the QR AUTO rule: a pole that receives a TAK PATUH span gets the
 * checklist item "TALIAN (UTAMA / SERVIS) - TIDAK PATUH GROUND CLEARANCE" = YES
 * and its Kejanggalan; on a final report (LAPORAN SELESAI / ARKIB) it opens
 * released and follows the Pencawang's maintenance package.
 *
 * DRY RUN (default — writes nothing; prints per-Pencawang counts + a JSON list):
 *   tsx prisma/scripts/backfill-ground-clearance.ts
 *   tsx prisma/scripts/backfill-ground-clearance.ts --pencawang "TAMAN SEMAMBU"
 *
 * APPLY (--by = the ADMIN account credited as "Amended By"):
 *   tsx prisma/scripts/backfill-ground-clearance.ts --apply --by admin@example.com
 *
 * Requires DATABASE_URL. Take a DB backup before --apply.
 */
import { writeFileSync } from 'fs';
import { PrismaClient, UserRole } from '@prisma/client';
import {
  applyPencawangGroundClearance,
  evaluatePencawangGroundClearance,
  type GcPencawangReport,
} from '../../apps/api/src/inspections/ground-clearance.apply';
import { resolveDefectGovernanceMode } from '../../apps/api/src/common/authorization/defect-governance';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
function argValues(flag: string): string[] {
  const out: string[] = [];
  argv.forEach((arg, index) => {
    if (arg === flag && argv[index + 1] && !argv[index + 1].startsWith('--')) out.push(argv[index + 1]);
  });
  return out;
}
const FILTERS = argValues('--pencawang').map((value) => value.trim().toUpperCase()).filter(Boolean);
const BY_EMAIL = argValues('--by')[0]?.trim().toLowerCase();

const prisma = new PrismaClient();

type Row = {
  substationId: string;
  tenantId: string;
  name: string;
  mainhead: string;
  owners: string;
  report: GcPencawangReport;
};

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (nothing written)'} · defect governance: ${resolveDefectGovernanceMode()}`);

  let actorUserId: string | null = null;
  if (APPLY) {
    if (!BY_EMAIL) throw new Error('--apply needs --by <admin email> (credited as "Amended By").');
    const actor = await prisma.user.findFirst({
      where: { email: { equals: BY_EMAIL, mode: 'insensitive' }, role: UserRole.ADMIN, isActive: true },
      select: { id: true },
    });
    if (!actor) throw new Error(`No active ADMIN user ${BY_EMAIL}.`);
    actorUserId = actor.id;
  }

  // Every Pencawang with a submitted (or sent-back) survey inspection.
  const substations = await prisma.substation.findMany({
    where: {
      assets: {
        some: {
          inspections: {
            some: { OR: [{ completionStatus: 'SUBMITTED' }, { reinspectionRequestedAt: { not: null } }] },
          },
        },
      },
    },
    select: {
      id: true,
      tenantId: true,
      code: true,
      name: true,
      mainhead: { select: { name: true } },
      siteVisits: {
        select: {
          maintenancePackages: { select: { maintenanceOrganization: { select: { name: true } } } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });
  const chosen = substations.filter(
    (sub) =>
      FILTERS.length === 0 ||
      FILTERS.some((filter) => `${sub.name ?? ''} ${sub.code ?? ''}`.toUpperCase().includes(filter)),
  );
  console.log(`Pencawang to check: ${chosen.length}${FILTERS.length ? ` (filter: ${FILTERS.join(', ')})` : ''}`);

  const rows: Row[] = [];
  for (const sub of chosen) {
    const report = await evaluatePencawangGroundClearance(prisma, sub.tenantId, sub.id);
    const owners = [
      ...new Set(sub.siteVisits.flatMap((visit) => visit.maintenancePackages.map((pkg) => pkg.maintenanceOrganization.name))),
    ].join(', ');
    rows.push({
      substationId: sub.id,
      tenantId: sub.tenantId,
      name: sub.name || sub.code || sub.id,
      mainhead: sub.mainhead?.name ?? '—',
      owners: owners || '—',
      report,
    });
  }

  const changed = rows.filter(
    (row) => row.report.toSet.length > 0 || row.report.toWithdraw.length > 0 || row.report.unwritable.length > 0,
  );
  const total = (pick: (report: GcPencawangReport) => number) => rows.reduce((sum, row) => sum + pick(row.report), 0);

  console.log('');
  console.log(['PENCAWANG', 'MAINHEAD', 'SAVR POLES', 'NEW FLAGS', 'ALREADY', 'SURVEYOR ONLY', 'WITHDRAW', 'NO ITEM', 'MAINTENANCE COMPANY'].join('\t'));
  for (const row of changed) {
    console.log(
      [
        row.name,
        row.mainhead,
        row.report.poles,
        row.report.toSet.length,
        row.report.agreed,
        row.report.surveyorOnly,
        row.report.toWithdraw.length,
        row.report.unwritable.length,
        row.owners,
      ].join('\t'),
    );
  }
  console.log('');
  console.log(
    `TOTAL: ${rows.length} Pencawang checked · ${changed.length} with changes · ` +
      `${total((r) => r.poles)} SAVR poles · NEW flags ${total((r) => r.toSet.length)} · ` +
      `already flagged & agreed ${total((r) => r.agreed)} · surveyor-only (kept) ${total((r) => r.surveyorOnly)} · ` +
      `withdraw ${total((r) => r.toWithdraw.length)} · failing but template has no Yes/No item ${total((r) => r.unwritable.length)} · ` +
      `office overrides ${total((r) => r.overridden)}`,
  );

  const logName = `backfill-ground-clearance_${APPLY ? 'apply' : 'dryrun'}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(
    logName,
    JSON.stringify(
      changed.map((row) => ({
        pencawang: row.name,
        mainhead: row.mainhead,
        maintenanceCompany: row.owners,
        newFlags: row.report.toSet.map((pole) => ({ pole: pole.code, why: pole.reasons })),
        withdraw: row.report.toWithdraw.map((pole) => pole.code),
        noItem: row.report.unwritable.map((pole) => ({ pole: pole.code, why: pole.reasons })),
      })),
      null,
      2,
    ),
  );
  console.log(`Details: ${logName}`);

  if (!APPLY) {
    console.log('\nDry run only — re-run with --apply --by <admin email> to write.');
    return;
  }

  let set = 0;
  let withdrawn = 0;
  for (const row of changed) {
    if (row.report.toSet.length === 0 && row.report.toWithdraw.length === 0) continue;
    const result = await applyPencawangGroundClearance(prisma, row.tenantId, row.substationId, { actorUserId });
    set += result.set;
    withdrawn += result.withdrawn;
    console.log(`  ${row.name}: ${result.set} set, ${result.withdrawn} withdrawn`);
  }
  console.log(`\nAPPLIED: ${set} TIDAK PATUH GROUND CLEARANCE set, ${withdrawn} withdrawn.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

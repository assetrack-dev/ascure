/**
 * Promote legacy QA-gated defects to VERIFIED for the INSPECTOR_OWNS model.
 *
 * Under INSPECTOR_OWNS (the active governance mode) a submitted defect opens at
 * VERIFIED — there is no QA/QC review gate. Defects created BEFORE that switch
 * (or during a QA_GATED window) are stuck at DETECTED / UNDER_REVIEW — or have a
 * NULL lifecycleStatus (legacy rows; the board renders NULL as DETECTED) — and
 * pile up in the Operations Board "Awaiting QA/QC" column. This promotes all of
 * them to VERIFIED so they surface as "Maintenance Ready" like every new defect,
 * and the (now-empty) QA/QC column is hidden by the board UI under INSPECTOR_OWNS.
 *
 * This is a SILENT status flip (no timeline event); updatedAt bumps via @updatedAt.
 * It is a one-off cleanup of legacy data — do NOT run it under QA_GATED, where
 * DETECTED/UNDER_REVIEW are legitimately mid-review.
 *
 * DRY-RUN by default: prints how many rows WOULD change, writes nothing.
 * Add --apply to commit.
 *
 *   tsx prisma/scripts/backfill-defect-verified.ts            # dry-run
 *   tsx prisma/scripts/backfill-defect-verified.ts --apply
 *
 * Requires DATABASE_URL to point at the target database.
 */
import { DefectLifecycleStatus, PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const FROM_STATUSES: DefectLifecycleStatus[] = [
  DefectLifecycleStatus.DETECTED,
  DefectLifecycleStatus.UNDER_REVIEW,
];
const TO_STATUS = DefectLifecycleStatus.VERIFIED;

async function main() {
  const prisma = new PrismaClient();

  try {
    const detected = await prisma.defect.count({
      where: { lifecycleStatus: DefectLifecycleStatus.DETECTED },
    });
    const underReview = await prisma.defect.count({
      where: { lifecycleStatus: DefectLifecycleStatus.UNDER_REVIEW },
    });
    const nullStatus = await prisma.defect.count({
      where: { lifecycleStatus: null },
    });
    const total = detected + underReview + nullStatus;

    console.log('Legacy QA/QC defects (to promote -> VERIFIED):');
    console.log(`  DETECTED:               ${detected}`);
    console.log(`  UNDER_REVIEW:           ${underReview}`);
    console.log(`  NULL (shown DETECTED):  ${nullStatus}`);
    console.log(`  TOTAL:                  ${total}`);

    if (total === 0) {
      console.log('\nNothing to backfill.');
      return;
    }

    if (!APPLY) {
      console.log(
        `\nDRY-RUN: would set ${total} defect(s) -> ${TO_STATUS}. Re-run with --apply to commit.`,
      );
      return;
    }

    // Enforce the header warning: never auto-approve under QA_GATED, where
    // DETECTED/UNDER_REVIEW are legitimately mid-review.
    if (process.env.DEFECT_GOVERNANCE_MODE === 'QA_GATED') {
      console.error(
        '\nABORTED: DEFECT_GOVERNANCE_MODE=QA_GATED. Under QA_GATED these defects are ' +
          'legitimately mid-review; this backfill would silently auto-approve them ' +
          '(no timeline event, no verifiedBy/verifiedAt). Switch to INSPECTOR_OWNS first.',
      );
      process.exit(1);
    }

    const result = await prisma.defect.updateMany({
      where: {
        OR: [{ lifecycleStatus: { in: FROM_STATUSES } }, { lifecycleStatus: null }],
      },
      data: { lifecycleStatus: TO_STATUS },
    });

    console.log(`\nAPPLIED: promoted ${result.count} defect(s) to ${TO_STATUS}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

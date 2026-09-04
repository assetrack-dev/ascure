import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Generalized checklist-value edit — PATCH /inspections/:id/checklist-result.
 *
 * A MANAGER may edit ANY recorded checklist value (not just the Kelegaan reading)
 * on the inspections of the teams they manage: their own company AND — as a main
 * contractor — their active subcontractor subtree (owner-approved 2026-07-21).
 * This DELIBERATELY extends the oversight scope to this ONE value-correction
 * mutation; amend/submit stay own-org strict (see subcontractor-oversight.e2e).
 * ADMIN / QA actor are also allowed; a technician (crew) is not. The free-text
 * value is coerced to the item's stored type.
 *
 * The edit also RE-RUNS THE VERDICT (checklist-verdict.util.ts): the seed item
 * is a defect-trigger BOOLEAN, so under the ASCURE SAVR polarity YES = "the
 * defect exists" = FAIL → the InspectionItemResult and its Defect follow the
 * edited value, unless maintenance has locked the defect.
 *
 * Seed: template item "Pole condition" (BOOLEAN) on every inspection; Company S
 * (SUBCONTRACTOR) is a child of Company A (MAIN_CONTRACTOR); Company B unrelated.
 */
describe('Authz · generalized checklist-value edit', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};
  const url = (inspectionId: string) =>
    `/api/v1/inspections/${inspectionId}/checklist-result`;
  const POLE = 'POLE CONDITION'; // normalized label of the seed BOOLEAN item

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    token.mgrA = await login(app, EMAILS.mgrA); // main contractor (parent of S)
    token.mgrB = await login(app, EMAILS.mgrB); // unrelated main contractor
    token.subMgr = await login(app, EMAILS.subMgr); // the subcontractor's own manager
    token.techA = await login(app, EMAILS.techA); // crew (not a governance actor)
  }, 30000);

  afterAll(async () => {
    // Restore the shared seed: drop the InspectionResult rows these tests
    // created, put the two item-results back to their seeded verdict, and
    // re-create the seeded defects (the re-verdict deletes/re-raises them with
    // fresh ids along the way).
    await prisma?.inspectionResult.deleteMany({
      where: { inspectionId: { in: [IDS.inspection.a, IDS.sub.inspection] } },
    });
    await prisma?.defect.deleteMany({
      where: {
        inspectionItemResultId: { in: [IDS.itemResult.a, IDS.sub.itemResult] },
      },
    });
    for (const id of [IDS.itemResult.a, IDS.sub.itemResult]) {
      await prisma?.inspectionItemResult.update({
        where: { id },
        data: {
          checklistItemId: null,
          result: 'FAIL',
          isDefect: true,
          isEmergency: false,
          severity: 'MEDIUM',
          maintenanceCategory: null,
        },
      });
    }
    await prisma?.defect.createMany({
      data: [
        { id: IDS.defect.a, inspectionItemResultId: IDS.itemResult.a, status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED' },
        { id: IDS.sub.defect, inspectionItemResultId: IDS.sub.itemResult, status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED' },
      ],
    });
    await app?.close();
  });

  it("own-company MANAGER edits an item on their own team's inspection (200) and the typed value persists", async () => {
    await http(app, token.mgrA)
      .patch(url(IDS.inspection.a))
      .send({ columnKey: POLE, value: 'Yes', siteVisitId: IDS.visit.a })
      .expect(200);
    const row = await prisma.inspectionResult.findFirst({
      where: { inspectionId: IDS.inspection.a },
    });
    expect(row?.valueBoolean).toBe(true);
    // Defect-trigger BOOLEAN: YES = "the defect exists" = FAIL — the seeded
    // verdict and defect stand (and the item-result is now template-linked).
    const item = await prisma.inspectionItemResult.findUnique({
      where: { id: IDS.itemResult.a },
    });
    expect(item?.result).toBe('FAIL');
    expect(item?.isDefect).toBe(true);
    expect(item?.checklistItemId).toBe(IDS.template.item);
    const defect = await prisma.defect.findUnique({
      where: { inspectionItemResultId: IDS.itemResult.a },
    });
    expect(defect).not.toBeNull();
  });

  it('main-contractor MANAGER edits a SUBCONTRACTOR inspection item (200 — the new cross-company write) and NO withdraws its defect', async () => {
    await http(app, token.mgrA)
      .patch(url(IDS.sub.inspection))
      .send({ columnKey: POLE, value: 'No', siteVisitId: IDS.sub.visit })
      .expect(200);
    const row = await prisma.inspectionResult.findFirst({
      where: { inspectionId: IDS.sub.inspection },
    });
    expect(row?.valueBoolean).toBe(false);
    // NO = the defect does not exist → PASS, defect gone (it was VERIFIED,
    // i.e. not yet claimed by maintenance).
    const item = await prisma.inspectionItemResult.findUnique({
      where: { id: IDS.sub.itemResult },
    });
    expect(item?.result).toBe('PASS');
    expect(item?.isDefect).toBe(false);
    expect(item?.severity).toBeNull();
    const defect = await prisma.defect.findUnique({
      where: { inspectionItemResultId: IDS.sub.itemResult },
    });
    expect(defect).toBeNull();
  });

  it('editing the answer back to YES re-raises the defect (item-level severity)', async () => {
    await http(app, token.mgrA)
      .patch(url(IDS.sub.inspection))
      .send({ columnKey: POLE, value: 'Yes', siteVisitId: IDS.sub.visit })
      .expect(200);
    const item = await prisma.inspectionItemResult.findUnique({
      where: { id: IDS.sub.itemResult },
    });
    expect(item?.result).toBe('FAIL');
    expect(item?.isDefect).toBe(true);
    expect(item?.severity).toBe('MEDIUM');
    const defect = await prisma.defect.findUnique({
      where: { inspectionItemResultId: IDS.sub.itemResult },
    });
    expect(defect?.severity).toBe('MEDIUM');
    expect(defect?.status).toBe('OPEN');
  });

  it('an unrelated main contractor (B) canNOT edit the subcontractor inspection (404)', () =>
    http(app, token.mgrB)
      .patch(url(IDS.sub.inspection))
      .send({ columnKey: POLE, value: 'Yes' })
      .expect(404));

  it("the subcontractor manager canNOT edit the parent contractor's inspection (404 — no upward)", () =>
    http(app, token.subMgr)
      .patch(url(IDS.inspection.a))
      .send({ columnKey: POLE, value: 'Yes' })
      .expect(404));

  it('a technician (crew) canNOT edit — value corrections are ADMIN/MANAGER/QA only (403)', () =>
    http(app, token.techA)
      .patch(url(IDS.inspection.a))
      .send({ columnKey: POLE, value: 'Yes' })
      .expect(403));

  it('rejects a value that does not match the item type (400 — BOOLEAN expects Yes/No)', () =>
    http(app, token.mgrA)
      .patch(url(IDS.inspection.a))
      .send({ columnKey: POLE, value: 'maybe' })
      .expect(400));

  it('rejects an unknown column (400)', () =>
    http(app, token.mgrA)
      .patch(url(IDS.inspection.a))
      .send({ columnKey: 'NO SUCH ITEM', value: 'x' })
      .expect(400));

  it('an empty value clears the recorded value (200 → null) and withdraws the verdict + defect', async () => {
    await http(app, token.mgrA)
      .patch(url(IDS.inspection.a))
      .send({ columnKey: POLE, value: '' })
      .expect(200);
    const row = await prisma.inspectionResult.findFirst({
      where: { inspectionId: IDS.inspection.a },
    });
    expect(row?.valueBoolean).toBeNull();
    const item = await prisma.inspectionItemResult.findUnique({
      where: { id: IDS.itemResult.a },
    });
    expect(item?.result).toBe('NA');
    expect(item?.isDefect).toBe(false);
    const defect = await prisma.defect.findUnique({
      where: { inspectionItemResultId: IDS.itemResult.a },
    });
    expect(defect).toBeNull();
  });

  it('a maintenance-locked defect survives an edit that clears the answer (item verdict updates, defect stays)', async () => {
    // Re-raise on inspection.a, then hand the defect to maintenance.
    await http(app, token.mgrA)
      .patch(url(IDS.inspection.a))
      .send({ columnKey: POLE, value: 'Yes', siteVisitId: IDS.visit.a })
      .expect(200);
    await prisma.defect.update({
      where: { inspectionItemResultId: IDS.itemResult.a },
      data: { lifecycleStatus: 'IN_PROGRESS' },
    });

    await http(app, token.mgrA)
      .patch(url(IDS.inspection.a))
      .send({ columnKey: POLE, value: 'No', siteVisitId: IDS.visit.a })
      .expect(200);

    const item = await prisma.inspectionItemResult.findUnique({
      where: { id: IDS.itemResult.a },
    });
    expect(item?.isDefect).toBe(false);
    // Someone is working this defect — the edit must not delete it.
    const defect = await prisma.defect.findUnique({
      where: { inspectionItemResultId: IDS.itemResult.a },
    });
    expect(defect?.lifecycleStatus).toBe('IN_PROGRESS');
  });
});

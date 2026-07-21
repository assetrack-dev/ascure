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
    // Restore the shared seed: drop the InspectionResult rows these tests created.
    await prisma?.inspectionResult.deleteMany({
      where: { inspectionId: { in: [IDS.inspection.a, IDS.sub.inspection] } },
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
  });

  it('main-contractor MANAGER edits a SUBCONTRACTOR inspection item (200 — the new cross-company write)', async () => {
    await http(app, token.mgrA)
      .patch(url(IDS.sub.inspection))
      .send({ columnKey: POLE, value: 'No', siteVisitId: IDS.sub.visit })
      .expect(200);
    const row = await prisma.inspectionResult.findFirst({
      where: { inspectionId: IDS.sub.inspection },
    });
    expect(row?.valueBoolean).toBe(false);
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

  it('an empty value clears the recorded value (200 → null)', async () => {
    await http(app, token.mgrA)
      .patch(url(IDS.inspection.a))
      .send({ columnKey: POLE, value: '' })
      .expect(200);
    const row = await prisma.inspectionResult.findFirst({
      where: { inspectionId: IDS.inspection.a },
    });
    expect(row?.valueBoolean).toBeNull();
  });
});

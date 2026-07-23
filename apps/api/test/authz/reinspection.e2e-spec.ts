import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * "Send this pole back for re-inspection" — the manager/DC remedy for data the
 * office can see is wrong but cannot correct from a desk (the case that prompted
 * it: a Smart-Sensor clearance the photo contradicts).
 *
 * The properties that matter:
 *
 *  1. AUTHORITY — manager / DC / ADMIN only; a technician cannot challenge data.
 *  2. NOTHING IS DESTROYED — every recorded answer, photo and defect survives;
 *     the crew corrects a populated form rather than starting blank.
 *  3. THE POLE READS "NOT INSPECTED" — the inspection returns to DRAFT, which is
 *     what turns it red again on the crew's map (mobile colours from
 *     `latestInspection.status`/`submittedAt`) and drops it from coverage.
 *  4. THE CREW CAN ACTUALLY REACH IT — a survey that already left the field is
 *     reopened, status AND lifecycle, or the pole would go red with no way to
 *     redo it.
 *  5. THE FLAG CLEARS on re-submit, and defects that are no longer defects are
 *     reconciled then (not at flag time).
 */
const R = {
  substation: '30000000-0000-4000-8000-0000000000e1',
  team: '20000000-0000-4000-8000-0000000000e1',
  visit: '60000000-0000-4000-8000-0000000000e1',
  asset: '70000000-0000-4000-8000-0000000000e1',
  inspection: '80000000-0000-4000-8000-0000000000e1',
  itemResult: '90000000-0000-4000-8000-0000000000e1',
};

describe('Authz · send a pole back for re-inspection', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  /** Put the fixture back to "submitted, survey completed" between cases. */
  const resetToSubmitted = async (visitStatus: 'ACTIVE' | 'COMPLETED') => {
    await prisma.inspection.update({
      where: { id: R.inspection },
      data: {
        completionStatus: 'SUBMITTED',
        submittedAt: new Date(),
        reinspectionReason: null,
        reinspectionRequestedAt: null,
        reinspectionRequestedById: null,
      },
    });
    await prisma.siteVisit.update({
      where: { id: R.visit },
      data: {
        status: visitStatus,
        lifecycleStatus:
          visitStatus === 'COMPLETED' ? 'RONDAAN_SELESAI' : 'DALAM_RONDAAN',
        completedAt: visitStatus === 'COMPLETED' ? new Date() : null,
        endedAt: visitStatus === 'COMPLETED' ? new Date() : null,
      },
    });
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    await prisma.substation.create({
      data: {
        id: R.substation,
        tenantId: IDS.tenant.t1,
        name: 'Reinspect Pencawang',
        code: 'RI-1',
      },
    });
    await prisma.team.create({
      data: {
        id: R.team,
        tenantId: IDS.tenant.t1,
        name: 'Reinspect Team',
        code: 'RIT',
        organizationId: IDS.org.a,
      },
    });
    await prisma.teamMember.create({
      data: { teamId: R.team, userId: IDS.user.techA },
    });
    await prisma.asset.create({
      data: {
        id: R.asset,
        tenantId: IDS.tenant.t1,
        assetCode: 'RI-POLE-1',
        substationId: R.substation,
        assetTypeId: IDS.assetType.savr,
      },
    });
    await prisma.siteVisit.create({
      data: {
        id: R.visit,
        tenantId: IDS.tenant.t1,
        teamId: R.team,
        substationId: R.substation,
        createdByUserId: IDS.user.mgrA,
        organizationId: IDS.org.a,
        status: 'COMPLETED',
        lifecycleStatus: 'RONDAAN_SELESAI',
        completedAt: new Date(),
        endedAt: new Date(),
      },
    });
    await prisma.inspection.create({
      data: {
        id: R.inspection,
        tenantId: IDS.tenant.t1,
        assetId: R.asset,
        siteVisitId: R.visit,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
    // A recorded answer + the defect it raised — both must survive a send-back.
    await prisma.inspectionItemResult.create({
      data: {
        id: R.itemResult,
        inspectionId: R.inspection,
        label: 'Pole condition',
        result: 'FAIL',
        isDefect: true,
        severity: 'MEDIUM',
      },
    });
    await prisma.inspectionResult.create({
      data: {
        inspectionId: R.inspection,
        templateItemId: IDS.template.item,
        valueText: '5.98',
      },
    });
    // The pole as the DC sees it — a Linked Assets row of the survey, which is
    // where the send-back button lives and whose recorded values must not
    // vanish when the pole is flagged.
    await prisma.siteVisitAsset.create({
      data: { siteVisitId: R.visit, assetId: R.asset, source: 'INSPECTION' },
    });

    token.mgrA = await login(app, EMAILS.mgrA);
    token.techA = await login(app, EMAILS.techA);
    token.adminT1 = await login(app, EMAILS.adminT1);
  }, 60000);

  afterAll(async () => {
    await prisma.siteVisitAsset.deleteMany({ where: { siteVisitId: R.visit } });
    await prisma.inspectionResult.deleteMany({
      where: { inspectionId: R.inspection },
    });
    await prisma.inspectionItemResult.deleteMany({
      where: { inspectionId: R.inspection },
    });
    await prisma.inspection.deleteMany({ where: { id: R.inspection } });
    await prisma.siteVisit.deleteMany({ where: { id: R.visit } });
    await prisma.asset.deleteMany({ where: { id: R.asset } });
    await prisma.teamMember.deleteMany({ where: { teamId: R.team } });
    await prisma.team.deleteMany({ where: { id: R.team } });
    await prisma.substation.deleteMany({ where: { id: R.substation } });
    await app?.close();
  });

  describe('authority', () => {
    beforeEach(() => resetToSubmitted('COMPLETED'));

    it('a technician cannot send a pole back', () =>
      http(app, token.techA)
        .post(`/api/v1/inspections/${R.inspection}/request-reinspection`)
        .send({ reason: 'looks wrong' })
        .expect(403));

    it('a reason is required — the crew has to know what to redo', () =>
      http(app, token.mgrA)
        .post(`/api/v1/inspections/${R.inspection}/request-reinspection`)
        .send({ reason: '   ' })
        .expect(400));

    it('the managing manager can', () =>
      http(app, token.mgrA)
        .post(`/api/v1/inspections/${R.inspection}/request-reinspection`)
        .send({ reason: 'Kelegaan 5.98 m contradicts the photo' })
        .expect(201));
  });

  describe('what it does', () => {
    beforeEach(async () => {
      await resetToSubmitted('COMPLETED');
      await http(app, token.mgrA)
        .post(`/api/v1/inspections/${R.inspection}/request-reinspection`)
        .send({ reason: 'Kelegaan 5.98 m contradicts the photo' })
        .expect(201);
    });

    it('returns the pole to DRAFT and records why', async () => {
      const inspection = await prisma.inspection.findUniqueOrThrow({
        where: { id: R.inspection },
      });
      expect(inspection.completionStatus).toBe('DRAFT');
      expect(inspection.submittedAt).toBeNull();
      expect(inspection.reinspectionReason).toContain('5.98');
      expect(inspection.reinspectionRequestedById).toBe(IDS.user.mgrA);
    });

    it('destroys nothing — the answers and the defect survive', async () => {
      const [itemResults, results] = await Promise.all([
        prisma.inspectionItemResult.findMany({
          where: { inspectionId: R.inspection },
        }),
        prisma.inspectionResult.findMany({
          where: { inspectionId: R.inspection },
        }),
      ]);
      expect(itemResults).toHaveLength(1);
      expect(itemResults[0].isDefect).toBe(true);
      expect(results[0].valueText).toBe('5.98');
    });

    it('reopens a completed survey so the crew can actually reach the pole', async () => {
      const visit = await prisma.siteVisit.findUniqueOrThrow({
        where: { id: R.visit },
      });
      // The lifecycle alone is not enough — a COMPLETED status blocks every
      // save/submit path, which would leave a red pole nobody can fix.
      expect(visit.status).toBe('IN_PROGRESS');
      expect(visit.lifecycleStatus).toBe('PERLU_PINDAAN');
      expect(visit.completedAt).toBeNull();
    });

    it('cannot be sent back twice', () =>
      http(app, token.mgrA)
        .post(`/api/v1/inspections/${R.inspection}/request-reinspection`)
        .send({ reason: 'again' })
        .expect(400));

    it('clears the flag when the crew re-submits', async () => {
      await http(app, token.adminT1)
        .post(`/api/v1/inspections/${R.inspection}/submit`)
        .expect(201);

      const inspection = await prisma.inspection.findUniqueOrThrow({
        where: { id: R.inspection },
      });
      expect(inspection.completionStatus).toBe('SUBMITTED');
      expect(inspection.reinspectionReason).toBeNull();
      expect(inspection.reinspectionRequestedAt).toBeNull();
    });
  });

  describe('the Linked Assets row the DC is looking at', () => {
    beforeEach(() => resetToSubmitted('ACTIVE'));

    const linkedRow = async () => {
      const res = await http(app, token.mgrA)
        .get(`/api/v1/site-visits/${R.visit}`)
        .expect(200);
      return res.body.linkedAssets.find(
        (link: { assetId: string }) => link.assetId === R.asset,
      );
    };

    it('keeps its recorded answers after the pole is sent back', async () => {
      const before = await linkedRow();
      expect(before.checklistValues['POLE CONDITION']).toBe('5.98');

      await http(app, token.mgrA)
        .post(`/api/v1/inspections/${R.inspection}/request-reinspection`)
        .send({ reason: 'Kelegaan 5.98 m contradicts the photo' })
        .expect(201);

      // The row still reads exactly as before — the values, and the inspection
      // behind them, are only hidden if the serializer drops a sent-back DRAFT.
      // Blanking every column here is what would read as data loss to the DC.
      const after = await linkedRow();
      expect(after.checklistValues['POLE CONDITION']).toBe('5.98');
      expect(after.asset.latestInspection.id).toBe(R.inspection);
      // …but it now reports as unsubmitted, which is what turns the pole red.
      expect(after.asset.latestInspection.status).toBe('DRAFT');
      expect(after.asset.latestInspection.submittedAt).toBeNull();
    });
  });

  describe('a survey still in the field', () => {
    beforeEach(() => resetToSubmitted('ACTIVE'));

    it('is left alone — the crew can already reach the pole', async () => {
      const res = await http(app, token.mgrA)
        .post(`/api/v1/inspections/${R.inspection}/request-reinspection`)
        .send({ reason: 'reading looks wrong' });
      expect(res.status).toBe(201);
      expect(res.body.reopenedSurvey).toBe(false);

      const visit = await prisma.siteVisit.findUniqueOrThrow({
        where: { id: R.visit },
      });
      expect(visit.lifecycleStatus).toBe('DALAM_RONDAAN');
    });
  });
});

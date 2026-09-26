import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Closing routed Kejanggalan (docs/PLAN-maintenance-flow.md §5.3, M1 step 3).
 *
 *  - verify / reject a repair: TNB Foreman/Technician, the MAIN CONTRACTOR
 *    manager over the routed company (incl. its subcontractors), ADMIN.
 *    Not a subcontractor manager, not another company, not the crew.
 *  - cannot-repair outcomes: TNB (or ADMIN) only — close as not repairable,
 *    send back, or hand to another company.
 *  - re-open a closed Kejanggalan: TNB (or ADMIN) only.
 *  - TNB Engineer: view only.
 *  - the legacy /defects/:id/closure-verification obeys the same rule for
 *    routed Kejanggalan (the crew can no longer self-close).
 *
 * Self-contained: builds and removes its own TNB org / Mainhead / PE chain.
 */
const C = {
  tnb: '0e000000-0000-4000-8000-0000000000c1',
  foreman: '10000000-0000-4000-8000-0000000000c7',
  engineer: '10000000-0000-4000-8000-0000000000c8',
  region: 'd0000000-0000-4000-8000-0000000000c1',
  mh: 'e0000000-0000-4000-8000-0000000000c1',
  sub: '30000000-0000-4000-8000-0000000000c1',
  visit: '60000000-0000-4000-8000-0000000000c1',
  asset: '70000000-0000-4000-8000-0000000000c1',
  inspection: '80000000-0000-4000-8000-0000000000c1',
  email: { foreman: 'close.foreman@authz.test', engineer: 'close.engineer@authz.test' },
};

// One item-result + defect per scenario, all on the same pole.
const SCENARIOS = {
  bySub: { routedTo: IDS.sub.org, outcome: 'RESOLVED' },
  reject: { routedTo: IDS.org.a, outcome: 'RESOLVED' },
  cannotHandOff: { routedTo: IDS.org.a, outcome: 'EXTERNAL_CONSTRAINT' },
  cannotClose: { routedTo: IDS.org.a, outcome: 'EXTERNAL_CONSTRAINT' },
  legacy: { routedTo: IDS.org.a, outcome: 'RESOLVED' },
} as const;
type Scenario = keyof typeof SCENARIOS;
const KEYS = Object.keys(SCENARIOS) as Scenario[];
const itemId = (index: number) => `90000000-0000-4000-8000-0000000000c${index + 1}`;
const defectId = (key: Scenario) =>
  `a0000000-0000-4000-8000-0000000000c${KEYS.indexOf(key) + 1}`;

describe('Authz · maintenance closure (verify / reject / re-open / cannot-repair)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};
  const base = '/api/v1/maintenance-verification';

  const state = (key: Scenario) =>
    prisma.defect.findUniqueOrThrow({
      where: { id: defectId(key) },
      select: {
        lifecycleStatus: true,
        status: true,
        maintenanceOrganizationId: true,
        assignedToTeamId: true,
        resolutionOutcome: true,
        closureVerifiedByUserId: true,
      },
    });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const { passwordHash } = await prisma.user.findUniqueOrThrow({
      where: { id: IDS.user.mgrA },
      select: { passwordHash: true },
    });
    const t = IDS.tenant.t1;

    await prisma.organization.create({
      data: { id: C.tnb, tenantId: t, name: 'TNB (closure spec)', type: 'TNB', isActive: true },
    });
    await prisma.user.createMany({
      data: [
        { id: C.foreman, tenantId: t, email: C.email.foreman, name: 'TNB Foreman', passwordHash, role: 'CLIENT', clientRank: 'FOREMAN', organizationId: C.tnb },
        { id: C.engineer, tenantId: t, email: C.email.engineer, name: 'TNB Engineer', passwordHash, role: 'CLIENT', clientRank: 'ENGINEER', organizationId: C.tnb },
      ],
    });
    await prisma.operationalRegion.create({
      data: { id: C.region, tenantId: t, name: 'Close Region', code: 'CLS', isActive: true },
    });
    await prisma.mainhead.create({
      data: { id: C.mh, name: 'CLOSE MH', isActive: true, operationalRegionId: C.region },
    });
    await prisma.organizationMainhead.create({
      data: { organizationId: C.tnb, mainheadId: C.mh, isActive: true },
    });
    await prisma.substation.create({
      data: { id: C.sub, tenantId: t, name: 'Close Pencawang', code: 'CL-9', mainheadId: C.mh },
    });
    await prisma.siteVisit.create({
      data: {
        id: C.visit,
        tenantId: t,
        teamId: IDS.team.a,
        createdByUserId: IDS.user.mgrA,
        organizationId: IDS.org.a,
        status: 'ACTIVE',
        substationId: C.sub,
        mainheadId: C.mh,
        lifecycleStatus: 'LAPORAN_SELESAI',
      },
    });
    await prisma.asset.create({
      data: { id: C.asset, tenantId: t, assetCode: 'CL-POLE-9', substationId: C.sub, assetTypeId: IDS.assetType.savr },
    });
    await prisma.inspection.create({
      data: {
        id: C.inspection,
        tenantId: t,
        assetId: C.asset,
        siteVisitId: C.visit,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
    await prisma.inspectionItemResult.createMany({
      data: KEYS.map((key, index) => ({
        id: itemId(index),
        inspectionId: C.inspection,
        label: `Kejanggalan ${key}`,
        result: 'FAIL' as const,
        isDefect: true,
        severity: 'MEDIUM' as const,
      })),
    });
    const now = new Date();
    await prisma.defect.createMany({
      data: KEYS.map((key, index) => ({
        id: defectId(key),
        inspectionItemResultId: itemId(index),
        severity: 'MEDIUM' as const,
        // Submitted by the crew: the state the existing completion endpoint leaves.
        status: 'RESOLVED' as const,
        lifecycleStatus: 'COMPLETED' as const,
        resolutionOutcome: SCENARIOS[key].outcome,
        maintenanceOrganizationId: SCENARIOS[key].routedTo,
        assignedToTeamId: IDS.team.a,
        maintainedAt: now,
        resolvedAt: now,
      })),
    });

    token.admin = await login(app, EMAILS.adminT1);
    token.mgrA = await login(app, EMAILS.mgrA);
    token.mgrB = await login(app, EMAILS.mgrB);
    token.subMgr = await login(app, EMAILS.subMgr);
    token.techA = await login(app, EMAILS.techA);
    token.foreman = await login(app, C.email.foreman);
    token.engineer = await login(app, C.email.engineer);
  });

  afterAll(async () => {
    const ids = KEYS.map(defectId);
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: ids } } });
    await prisma.defect.deleteMany({ where: { id: { in: ids } } });
    await prisma.inspectionItemResult.deleteMany({ where: { inspectionId: C.inspection } });
    await prisma.inspection.deleteMany({ where: { id: C.inspection } });
    await prisma.siteVisit.deleteMany({ where: { id: C.visit } });
    await prisma.asset.deleteMany({ where: { id: C.asset } });
    await prisma.substation.deleteMany({ where: { id: C.sub } });
    await prisma.organizationMainhead.deleteMany({ where: { organizationId: C.tnb } });
    await prisma.mainhead.deleteMany({ where: { id: C.mh } });
    await prisma.operationalRegion.deleteMany({ where: { id: C.region } });
    await prisma.user.deleteMany({ where: { id: { in: [C.foreman, C.engineer] } } });
    await prisma.organization.deleteMany({ where: { id: C.tnb } });
    await app?.close();
  });

  describe('queue', () => {
    it('TNB Engineer sees the queue but may not act', async () => {
      const res = await http(app, token.engineer).get(base).expect(200);
      expect(res.body.actor).toMatchObject({
        kind: 'TNB',
        canVerify: false,
        canDecideCannotRepair: false,
        canReopen: false,
      });
      expect(res.body.counts).toEqual({ pending: 3, cannotRepair: 2 });
      const ids = res.body.items.map((item: { id: string }) => item.id);
      expect(ids).toEqual(
        expect.arrayContaining([defectId('bySub'), defectId('reject'), defectId('legacy')]),
      );
    });

    it('cannot-repair items sit in their own tab', async () => {
      const res = await http(app, token.foreman).get(`${base}?tab=CANNOT_REPAIR`).expect(200);
      expect(res.body.actor).toMatchObject({ canVerify: true, canDecideCannotRepair: true });
      expect(res.body.items.every((item: { cannotRepair: boolean }) => item.cannotRepair)).toBe(true);
      expect(res.body.items).toHaveLength(2);
    });

    it('the main contractor sees its own + subcontractor work; can verify, not decide', async () => {
      const res = await http(app, token.mgrA).get(base).expect(200);
      expect(res.body.actor).toMatchObject({
        kind: 'MAIN_CONTRACTOR',
        canVerify: true,
        canDecideCannotRepair: false,
        canReopen: false,
      });
      expect(res.body.items.map((item: { id: string }) => item.id)).toContain(defectId('bySub'));
    });

    it('a subcontractor manager has no verification queue (403)', () =>
      http(app, token.subMgr).get(base).expect(403));

    it('a technician has no verification queue (403)', () =>
      http(app, token.techA).get(base).expect(403));
  });

  describe('verify', () => {
    it('another main contractor cannot see the repair (404)', () =>
      http(app, token.mgrB).post(`${base}/${defectId('bySub')}/verify`).send({}).expect(404));

    it('TNB Engineer cannot verify (403)', () =>
      http(app, token.engineer).post(`${base}/${defectId('bySub')}/verify`).send({}).expect(403));

    it("the main contractor verifies its subcontractor's repair", async () => {
      await http(app, token.mgrA)
        .post(`${base}/${defectId('bySub')}/verify`)
        .send({ notes: 'Checked on site' })
        .expect(201);
      expect(await state('bySub')).toMatchObject({
        lifecycleStatus: 'CLOSED',
        status: 'CLOSED',
        closureVerifiedByUserId: IDS.user.mgrA,
      });
    });

    it('verifying twice is refused (400)', () =>
      http(app, token.foreman).post(`${base}/${defectId('bySub')}/verify`).send({}).expect(400));
  });

  describe('reject', () => {
    it('needs a reason (400)', () =>
      http(app, token.foreman).post(`${base}/${defectId('reject')}/reject`).send({ reason: ' ' }).expect(400));

    it('TNB sends the repair back to the same crew', async () => {
      await http(app, token.foreman)
        .post(`${base}/${defectId('reject')}/reject`)
        .send({ reason: 'After photo does not show the stay wire' })
        .expect(201);
      expect(await state('reject')).toMatchObject({
        lifecycleStatus: 'IN_PROGRESS',
        status: 'IN_PROGRESS',
        resolutionOutcome: null,
        assignedToTeamId: IDS.team.a,
        maintenanceOrganizationId: IDS.org.a,
      });
    });
  });

  describe('cannot repair', () => {
    it('the main contractor cannot close its own cannot-repair (403)', () =>
      http(app, token.mgrA).post(`${base}/${defectId('cannotClose')}/verify`).send({}).expect(403));

    it('the main contractor cannot close it via the legacy endpoint either (403)', () =>
      http(app, token.mgrA)
        .patch(`/api/v1/defects/${defectId('cannotClose')}/closure-verification`)
        .send({})
        .expect(403));

    it('TNB closes it as not repairable', async () => {
      await http(app, token.foreman)
        .post(`${base}/${defectId('cannotClose')}/verify`)
        .send({ notes: 'Needs outage — tracked by TNB' })
        .expect(201);
      expect(await state('cannotClose')).toMatchObject({
        lifecycleStatus: 'CLOSED',
        resolutionOutcome: 'EXTERNAL_CONSTRAINT',
      });
    });

    it('TNB hands another one to a different company', async () => {
      await http(app, token.mgrA)
        .post(`${base}/${defectId('cannotHandOff')}/reassign`)
        .send({ maintenanceOrganizationId: IDS.org.maint, reason: 'x' })
        .expect(403);
      await http(app, token.foreman)
        .post(`${base}/${defectId('cannotHandOff')}/reassign`)
        .send({ maintenanceOrganizationId: IDS.org.maint, reason: 'Needs a pole-replacement crew' })
        .expect(201);
      expect(await state('cannotHandOff')).toMatchObject({
        lifecycleStatus: 'VERIFIED',
        status: 'OPEN',
        maintenanceOrganizationId: IDS.org.maint,
        assignedToTeamId: null,
        resolutionOutcome: null,
      });
    });
  });

  describe('re-open', () => {
    it('only TNB (Foreman/Technician) or admin may re-open', async () => {
      const path = `${base}/${defectId('bySub')}/reopen`;
      await http(app, token.engineer).post(path).send({ reason: 'x' }).expect(403);
      await http(app, token.mgrA).post(path).send({ reason: 'x' }).expect(403);
      await http(app, token.foreman).post(path).send({ reason: 'Stay wire loose again' }).expect(201);
      expect(await state('bySub')).toMatchObject({
        lifecycleStatus: 'IN_PROGRESS',
        status: 'IN_PROGRESS',
        closureVerifiedByUserId: null,
        maintenanceOrganizationId: IDS.sub.org,
      });
    });

    it('an open Kejanggalan cannot be re-opened (400)', () =>
      http(app, token.foreman).post(`${base}/${defectId('reject')}/reopen`).send({ reason: 'x' }).expect(400));
  });

  describe('legacy closure endpoint on a routed Kejanggalan', () => {
    const path = `/api/v1/defects/${defectId('legacy')}/closure-verification`;

    it('the crew can no longer self-close (403)', () =>
      http(app, token.techA).patch(path).send({}).expect(403));

    it('the main contractor manager can', async () => {
      await http(app, token.mgrA).patch(path).send({}).expect(200);
      expect((await state('legacy')).lifecycleStatus).toBe('CLOSED');
    });
  });

  it('every decision is on the timeline', async () => {
    const count = await prisma.defectTimelineEntry.count({
      where: { defectId: { in: KEYS.map(defectId) } },
    });
    expect(count).toBeGreaterThanOrEqual(6);
  });
});

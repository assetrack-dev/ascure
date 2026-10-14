import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * TNB Supervisor (docs/PLAN-maintenance-flow.md §19, N55).
 *
 *  1. Rank SUPERVISOR acts (canActOnMaintenanceAsClient) but only for the
 *     contractor companies assigned to it — none assigned = sees nothing.
 *  2. ADMIN and a TNB Foreman / Technician assign the companies (own TNB org);
 *     an Engineer, a contractor or the Supervisor itself cannot.
 *  3. Maintenance Packages: only its companies' work (+ untouched PEs), and it
 *     can hand work only to / change work only of its companies.
 *  4. Repair Verification: only its companies' repairs; verify there, 404 elsewhere.
 *  5. Survey views (step 4c, "by Pencawang"): only its companies' surveys, and
 *     every pole of a Pencawang one of them surveyed — never a PE surveyed only
 *     by another company, nor an untouched PE. Same rule on the Asset Map, the
 *     pole panel and /site-visits; a Foreman keeps the whole Mainhead.
 *
 * Self-contained: builds and removes its own TNB org / Mainhead / PE chain.
 */
const S = {
  tnb: '0e000000-0000-4000-8000-0000000000d1',
  foreman: '10000000-0000-4000-8000-0000000000d7',
  engineer: '10000000-0000-4000-8000-0000000000d8',
  supervisor: '10000000-0000-4000-8000-0000000000d9',
  region: 'd0000000-0000-4000-8000-0000000000d1',
  mh: 'e0000000-0000-4000-8000-0000000000d1',
  sub: '30000000-0000-4000-8000-0000000000d1',
  /** PE surveyed only by Company B. */
  subB: '30000000-0000-4000-8000-0000000000d2',
  /** PE nobody has surveyed. */
  subIdle: '30000000-0000-4000-8000-0000000000d3',
  visit: '60000000-0000-4000-8000-0000000000d1',
  visitB: '60000000-0000-4000-8000-0000000000d2',
  asset: '70000000-0000-4000-8000-0000000000d1',
  /** Not yet surveyed, in Company A's PE — still visible (real totals). */
  assetIdleInA: '70000000-0000-4000-8000-0000000000d2',
  assetB: '70000000-0000-4000-8000-0000000000d3',
  assetIdle: '70000000-0000-4000-8000-0000000000d4',
  inspectionB: '80000000-0000-4000-8000-0000000000d2',
  inspection: '80000000-0000-4000-8000-0000000000d1',
  item: { a: '90000000-0000-4000-8000-0000000000d1', b: '90000000-0000-4000-8000-0000000000d2' },
  defect: { a: 'a0000000-0000-4000-8000-0000000000d1', b: 'a0000000-0000-4000-8000-0000000000d2' },
  email: {
    foreman: 'sup.foreman@authz.test',
    engineer: 'sup.engineer@authz.test',
    supervisor: 'sup.supervisor@authz.test',
  },
};

type Lane = { category: string; total: number; canAssign: boolean };
type Pe = { siteVisitId: string; lanes: Lane[] };

describe('Authz · TNB Supervisor (company-scoped maintenance)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};
  const board = async (who: string) =>
    (await http(app, token[who]).get('/api/v1/maintenance-packages/board').expect(200)).body as {
      companies: Array<{ id: string }>;
      pencawangs: Pe[];
    };
  const pe = (body: { pencawangs: Pe[] }) => body.pencawangs.find((row) => row.siteVisitId === S.visit);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const { passwordHash } = await prisma.user.findUniqueOrThrow({
      where: { id: IDS.user.mgrA },
      select: { passwordHash: true },
    });
    const t = IDS.tenant.t1;

    await prisma.organization.create({
      data: { id: S.tnb, tenantId: t, name: 'TNB (supervisor spec)', type: 'TNB', isActive: true },
    });
    await prisma.user.createMany({
      data: [
        { id: S.foreman, tenantId: t, email: S.email.foreman, name: 'TNB Foreman', passwordHash, role: 'CLIENT', clientRank: 'FOREMAN', organizationId: S.tnb },
        { id: S.engineer, tenantId: t, email: S.email.engineer, name: 'TNB Engineer', passwordHash, role: 'CLIENT', clientRank: 'ENGINEER', organizationId: S.tnb },
        { id: S.supervisor, tenantId: t, email: S.email.supervisor, name: 'TNB Supervisor', passwordHash, role: 'CLIENT', clientRank: 'SUPERVISOR', organizationId: S.tnb },
      ],
    });
    await prisma.operationalRegion.create({
      data: { id: S.region, tenantId: t, name: 'Sup Region', code: 'SUP', isActive: true },
    });
    await prisma.mainhead.create({
      data: { id: S.mh, name: 'SUP MH', isActive: true, operationalRegionId: S.region },
    });
    await prisma.organizationMainhead.create({
      data: { organizationId: S.tnb, mainheadId: S.mh, isActive: true },
    });
    await prisma.substation.createMany({
      data: [
        { id: S.sub, tenantId: t, name: 'Sup Pencawang', code: 'SP-1', mainheadId: S.mh },
        { id: S.subB, tenantId: t, name: 'Sup Pencawang B', code: 'SP-2', mainheadId: S.mh },
        { id: S.subIdle, tenantId: t, name: 'Sup Pencawang idle', code: 'SP-3', mainheadId: S.mh },
      ],
    });
    await prisma.siteVisit.create({
      data: {
        id: S.visit,
        tenantId: t,
        teamId: IDS.team.a,
        createdByUserId: IDS.user.mgrA,
        organizationId: IDS.org.a,
        status: 'ACTIVE',
        substationId: S.sub,
        mainheadId: S.mh,
        lifecycleStatus: 'LAPORAN_SELESAI',
      },
    });
    // Company B surveys its own PE on the same Mainhead.
    await prisma.siteVisit.create({
      data: {
        id: S.visitB,
        tenantId: t,
        teamId: IDS.team.b,
        createdByUserId: IDS.user.mgrB,
        organizationId: IDS.org.b,
        status: 'ACTIVE',
        substationId: S.subB,
        mainheadId: S.mh,
        lifecycleStatus: 'DALAM_RONDAAN',
      },
    });
    const pole = (id: string, code: string, substationId: string) => ({
      id, tenantId: t, assetCode: code, substationId, assetTypeId: IDS.assetType.savr, latitude: 3.5, longitude: 101.5,
    });
    await prisma.asset.createMany({
      data: [
        pole(S.asset, 'SUP-POLE-1', S.sub),
        pole(S.assetIdleInA, 'SUP-POLE-1B', S.sub),
        pole(S.assetB, 'SUP-POLE-2', S.subB),
        pole(S.assetIdle, 'SUP-POLE-3', S.subIdle),
      ],
    });
    await prisma.inspection.create({
      data: {
        id: S.inspection,
        tenantId: t,
        assetId: S.asset,
        siteVisitId: S.visit,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
    await prisma.inspection.create({
      data: {
        id: S.inspectionB,
        tenantId: t,
        assetId: S.assetB,
        siteVisitId: S.visitB,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techB,
        completionStatus: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
    await prisma.inspectionItemResult.createMany({
      data: [S.item.a, S.item.b].map((id) => ({
        id,
        inspectionId: S.inspection,
        label: 'Kejanggalan',
        result: 'FAIL' as const,
        isDefect: true,
        severity: 'MEDIUM' as const,
      })),
    });
    const now = new Date();
    // Rentis → Company A, Cat tiang → Company B; both repaired, waiting verification.
    await prisma.defect.createMany({
      data: [
        { id: S.defect.a, inspectionItemResultId: S.item.a, maintenanceCategory: 'RENTIS' as const, maintenanceOrganizationId: IDS.org.a },
        { id: S.defect.b, inspectionItemResultId: S.item.b, maintenanceCategory: 'CAT_TIANG' as const, maintenanceOrganizationId: IDS.org.b },
      ].map((row) => ({
        ...row,
        severity: 'MEDIUM' as const,
        status: 'RESOLVED' as const,
        lifecycleStatus: 'COMPLETED' as const,
        resolutionOutcome: 'RESOLVED' as const,
        maintainedAt: now,
        resolvedAt: now,
      })),
    });
    await prisma.maintenancePackage.createMany({
      data: [
        { tenantId: t, siteVisitId: S.visit, category: 'RENTIS', maintenanceOrganizationId: IDS.org.a },
        { tenantId: t, siteVisitId: S.visit, category: 'CAT_TIANG', maintenanceOrganizationId: IDS.org.b },
      ],
    });

    token.admin = await login(app, EMAILS.adminT1);
    token.mgrA = await login(app, EMAILS.mgrA);
    token.foreman = await login(app, S.email.foreman);
    token.engineer = await login(app, S.email.engineer);
    token.supervisor = await login(app, S.email.supervisor);
  });

  afterAll(async () => {
    const defects = [S.defect.a, S.defect.b];
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: defects } } });
    await prisma.defect.deleteMany({ where: { id: { in: defects } } });
    await prisma.maintenancePackage.deleteMany({ where: { siteVisitId: S.visit } });
    await prisma.inspectionItemResult.deleteMany({ where: { inspectionId: S.inspection } });
    await prisma.inspection.deleteMany({ where: { id: { in: [S.inspection, S.inspectionB] } } });
    await prisma.siteVisit.deleteMany({ where: { id: { in: [S.visit, S.visitB] } } });
    await prisma.asset.deleteMany({ where: { id: { in: [S.asset, S.assetIdleInA, S.assetB, S.assetIdle] } } });
    await prisma.substation.deleteMany({ where: { id: { in: [S.sub, S.subB, S.subIdle] } } });
    await prisma.organizationMainhead.deleteMany({ where: { organizationId: S.tnb } });
    await prisma.mainhead.deleteMany({ where: { id: S.mh } });
    await prisma.operationalRegion.deleteMany({ where: { id: S.region } });
    await prisma.clientCompanyAccess.deleteMany({ where: { userId: S.supervisor } });
    await prisma.user.deleteMany({ where: { id: { in: [S.foreman, S.engineer, S.supervisor] } } });
    await prisma.organization.deleteMany({ where: { id: S.tnb } });
    await app?.close();
  });

  it('sign-in flags: a Supervisor acts, a Foreman manages Supervisors', async () => {
    const sup = await http(app, token.supervisor).get('/api/v1/auth/me').expect(200);
    expect(sup.body).toMatchObject({
      clientRank: 'SUPERVISOR',
      isClientSupervisor: true,
      canManageClientSupervisors: false,
      canActOnMaintenanceAsClient: true,
    });
    const foreman = await http(app, token.foreman).get('/api/v1/auth/me').expect(200);
    expect(foreman.body).toMatchObject({ isClientSupervisor: false, canManageClientSupervisors: true });
  });

  it('no company assigned yet → the Supervisor sees nothing (fails closed)', async () => {
    expect(pe(await board('supervisor'))).toBeUndefined();
    const groups = await http(app, token.supervisor).get('/api/v1/maintenance-verification/groups').expect(200);
    expect(groups.body.totalGroups).toBe(0);
  });

  it('only ADMIN / TNB Foreman / Technician manage Supervisors', async () => {
    await http(app, token.engineer).get('/api/v1/client-supervisors').expect(403);
    await http(app, token.mgrA).get('/api/v1/client-supervisors').expect(403);
    await http(app, token.supervisor).get('/api/v1/client-supervisors').expect(403);
    const list = await http(app, token.foreman).get('/api/v1/client-supervisors').expect(200);
    expect(list.body.supervisors.map((row: { userId: string }) => row.userId)).toEqual([S.supervisor]);
    expect(list.body.companies.map((company: { id: string }) => company.id)).toEqual(
      expect.arrayContaining([IDS.org.a, IDS.org.b]),
    );
    const admin = await http(app, token.admin).get('/api/v1/client-supervisors').expect(200);
    expect(admin.body.supervisors.some((row: { userId: string }) => row.userId === S.supervisor)).toBe(true);
  });

  it('a Foreman assigns Company A; only contractor companies are accepted', async () => {
    await http(app, token.foreman)
      .put(`/api/v1/client-supervisors/${S.supervisor}/companies`)
      .send({ organizationIds: [S.tnb] })
      .expect(400);
    const res = await http(app, token.foreman)
      .put(`/api/v1/client-supervisors/${S.supervisor}/companies`)
      .send({ organizationIds: [IDS.org.a] })
      .expect(200);
    expect(res.body.companies.map((company: { id: string }) => company.id)).toEqual([IDS.org.a]);
  });

  it("Packages board: only Company A's work, only Company A as a destination", async () => {
    const body = await board('supervisor');
    expect(body.companies.map((company) => company.id)).toEqual([IDS.org.a]);
    const row = pe(body);
    expect(row).toBeDefined();
    expect(row?.lanes.find((lane) => lane.category === 'RENTIS')).toMatchObject({ total: 1, canAssign: true });
    // Company B's Cat tiang is not counted and not changeable.
    expect(row?.lanes.find((lane) => lane.category === 'CAT_TIANG')).toMatchObject({ total: 0, canAssign: false });
    await http(app, token.supervisor)
      .post('/api/v1/maintenance-packages')
      .send({ siteVisitId: S.visit, category: 'CAT_TIANG', maintenanceOrganizationId: IDS.org.a })
      .expect(403);
    await http(app, token.supervisor)
      .post('/api/v1/maintenance-packages')
      .send({ siteVisitId: S.visit, category: 'RENTIS', maintenanceOrganizationId: IDS.org.b })
      .expect(403);
    await http(app, token.supervisor)
      .post('/api/v1/maintenance-packages')
      .send({ siteVisitId: S.visit, category: 'RENTIS', assignedTeamId: IDS.team.a })
      .expect(201);
  });

  it("Repair Verification: Company A's repair only — verify it, 404 on Company B's", async () => {
    const groups = await http(app, token.supervisor).get('/api/v1/maintenance-verification/groups').expect(200);
    expect(groups.body.groups.map((group: { company: { id: string } }) => group.company.id)).toEqual([IDS.org.a]);
    expect(groups.body.actor).toMatchObject({ canVerify: true, canDecideCannotRepair: true, canReopen: true });
    await http(app, token.supervisor)
      .post(`/api/v1/maintenance-verification/${S.defect.b}/verify`)
      .send({})
      .expect(404);
    await http(app, token.supervisor)
      .post(`/api/v1/maintenance-verification/${S.defect.a}/verify`)
      .send({ notes: 'OK' })
      .expect(201);
    const row = await prisma.defect.findUniqueOrThrow({ where: { id: S.defect.a }, select: { lifecycleStatus: true } });
    expect(row.lifecycleStatus).toBe('CLOSED');
  });

  // ── Step 4c: survey views by company ("by Pencawang") ─────────────────────
  const progress = async (who: string) =>
    (await http(app, token[who]).get(`/api/v1/client/progress?mainheadId=${S.mh}`).expect(200)).body as {
      total: number;
      inspected: number;
      groups: Array<{ id: string; total: number; inspected: number }>;
      pencawang: { total: number; completed: number };
    };

  it("Progress: only Company A's Pencawang, with every pole in it (real totals)", async () => {
    const sup = await progress('supervisor');
    expect(sup.groups.map((group) => group.id)).toEqual([S.sub]);
    expect(sup).toMatchObject({ total: 2, inspected: 1, pencawang: { total: 1, completed: 0 } });

    // A Foreman keeps the whole Mainhead: three PEs, four poles.
    const foreman = await progress('foreman');
    expect(foreman.groups.map((group) => group.id).sort()).toEqual([S.sub, S.subB, S.subIdle].sort());
    expect(foreman.total).toBe(4);

    const top = await http(app, token.supervisor).get('/api/v1/client/progress').expect(200);
    expect(top.body.groups).toEqual([expect.objectContaining({ id: S.mh, total: 2, inspected: 1 })]);
    const mainheads = await http(app, token.supervisor).get('/api/v1/client/mainheads').expect(200);
    expect(mainheads.body.map((mh: { id: string }) => mh.id)).toEqual([S.mh]);
  });

  it("Pencawang poles: Company A's PE lists every pole; other PEs are refused", async () => {
    const own = await http(app, token.supervisor).get(`/api/v1/client/pencawang/${S.sub}/poles`).expect(200);
    expect(own.body.poles.map((row: { id: string }) => row.id).sort()).toEqual([S.asset, S.assetIdleInA].sort());
    await http(app, token.supervisor).get(`/api/v1/client/pencawang/${S.subB}/poles`).expect(403);
    await http(app, token.supervisor).get(`/api/v1/client/pencawang/${S.subIdle}/poles`).expect(403);
    await http(app, token.foreman).get(`/api/v1/client/pencawang/${S.subB}/poles`).expect(200);
  });

  it("Surveys: only Company A's survey; Company B's is refused", async () => {
    const visits = await http(app, token.supervisor).get('/api/v1/client/visits').expect(200);
    const ids = visits.body.visits.map((row: { id: string }) => row.id);
    expect(ids).toContain(S.visit);
    expect(ids).not.toContain(S.visitB);
    await http(app, token.supervisor).get(`/api/v1/client/visits/${S.visit}`).expect(200);
    await http(app, token.supervisor).get(`/api/v1/client/visits/${S.visitB}`).expect(403);
    const foreman = await http(app, token.foreman).get('/api/v1/client/visits').expect(200);
    expect(foreman.body.visits.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining([S.visit, S.visitB]),
    );
    // The generic site-visit list follows the same company rule.
    const list = await http(app, token.supervisor).get('/api/v1/site-visits').expect(200);
    expect(JSON.stringify(list.body)).not.toContain(S.visitB);
  });

  it("Asset Map + pole panel: Company A's Pencawang only", async () => {
    const points = await http(app, token.supervisor)
      .get(`/api/v1/assets/map?level=points&mainheadId=${S.mh}`)
      .expect(200);
    const body = JSON.stringify(points.body);
    expect(body).toContain(S.asset);
    expect(body).toContain(S.assetIdleInA);
    expect(body).not.toContain(S.assetB);
    expect(body).not.toContain(S.assetIdle);

    const bubbles = await http(app, token.supervisor)
      .get(`/api/v1/assets/map?level=pencawang&mainheadId=${S.mh}`)
      .expect(200);
    expect(JSON.stringify(bubbles.body)).not.toContain(S.subB);
    expect(JSON.stringify(bubbles.body)).not.toContain(S.subIdle);

    // The PE's check-in card is withheld for a PE outside scope.
    const other = await http(app, token.supervisor)
      .get(`/api/v1/assets/map?level=points&pencawangId=${S.subB}`)
      .expect(200);
    expect(other.body).toMatchObject({ poles: [], pencawang: null });

    await http(app, token.supervisor).get(`/api/v1/assets/${S.assetIdleInA}`).expect(200);
    await http(app, token.supervisor).get(`/api/v1/assets/${S.assetB}`).expect(404);
    await http(app, token.supervisor).get(`/api/v1/assets/${S.assetIdle}`).expect(404);
    await http(app, token.foreman).get(`/api/v1/assets/${S.assetB}`).expect(200);
  });

  it("pole repairs: a Supervisor sees only its companies' repairs", async () => {
    const sup = await http(app, token.supervisor).get(`/api/v1/assets/${S.asset}/repairs`).expect(200);
    expect(sup.body.map((row: { id: string }) => row.id)).toEqual([S.defect.a]);
    const foreman = await http(app, token.foreman).get(`/api/v1/assets/${S.asset}/repairs`).expect(200);
    expect(foreman.body.map((row: { id: string }) => row.id).sort()).toEqual([S.defect.a, S.defect.b].sort());
  });

  it('a Supervisor with no company sees no survey view data (fails closed)', async () => {
    await http(app, token.foreman)
      .put(`/api/v1/client-supervisors/${S.supervisor}/companies`)
      .send({ organizationIds: [] })
      .expect(200);
    const top = await http(app, token.supervisor).get('/api/v1/client/progress').expect(200);
    expect(top.body).toMatchObject({ total: 0, groups: [] });
    const visits = await http(app, token.supervisor).get('/api/v1/client/visits').expect(200);
    expect(visits.body.total).toBe(0);
    await http(app, token.supervisor).get(`/api/v1/assets/${S.asset}`).expect(404);
  });
});

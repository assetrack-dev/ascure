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
 *  5. The client survey views are closed to a Supervisor until step 4c.
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
  visit: '60000000-0000-4000-8000-0000000000d1',
  asset: '70000000-0000-4000-8000-0000000000d1',
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
    await prisma.substation.create({
      data: { id: S.sub, tenantId: t, name: 'Sup Pencawang', code: 'SP-1', mainheadId: S.mh },
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
    await prisma.asset.create({
      data: { id: S.asset, tenantId: t, assetCode: 'SUP-POLE-1', substationId: S.sub, assetTypeId: IDS.assetType.savr },
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
    await prisma.inspection.deleteMany({ where: { id: S.inspection } });
    await prisma.siteVisit.deleteMany({ where: { id: S.visit } });
    await prisma.asset.deleteMany({ where: { id: S.asset } });
    await prisma.substation.deleteMany({ where: { id: S.sub } });
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

  it('the client survey views stay closed to a Supervisor (until step 4c)', async () => {
    await http(app, token.supervisor).get('/api/v1/client/progress').expect(403);
    await http(app, token.foreman).get('/api/v1/client/progress').expect(200);
  });
});

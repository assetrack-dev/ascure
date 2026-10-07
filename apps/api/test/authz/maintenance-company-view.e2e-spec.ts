import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Plan §15 (2026-10-08) — a contractor's own Manager / Supervisor on the
 * Maintenance Packages board, and repair progress.
 *
 *  1. A SUBCONTRACTOR Manager sees only the PEs / work routed to its company,
 *     counts only its own Kejanggalan, and may re-team that work within its own
 *     teams — never another company's lane, never another company, never a
 *     withdraw. TNB's target date / notes / "assigned by" survive a re-team.
 *  2. A contractor SUPERVISOR sees its company's work, read only.
 *  3. Progress counts: to do / in progress / awaiting verification / closed.
 *  4. Auth flag canViewMaintenancePackages (repair verification stays TNB / MC / admin).
 *
 * Self-contained: subcontractor S (IDS.sub.org, Manager S, Team S) under Company A.
 */
const P = {
  teamS2: '20000000-0000-4000-8000-0000000c1501',
  sub: '30000000-0000-4000-8000-0000000c1501',
  visit: '60000000-0000-4000-8000-0000000c1501',
  asset: ['70000000-0000-4000-8000-0000000c1501', '70000000-0000-4000-8000-0000000c1502'],
  inspection: ['80000000-0000-4000-8000-0000000c1501', '80000000-0000-4000-8000-0000000c1502'],
  item: [
    '90000000-0000-4000-8000-0000000c1501',
    '90000000-0000-4000-8000-0000000c1502',
    '90000000-0000-4000-8000-0000000c1503',
  ],
  defect: {
    rentis: 'a0000000-0000-4000-8000-0000000c1501',
    sel: 'a0000000-0000-4000-8000-0000000c1502',
    cat: 'a0000000-0000-4000-8000-0000000c1503',
  },
};
const ALL_DEFECTS = Object.values(P.defect);
const DUE = '2026-12-31T00:00:00.000Z';

type BoardPe = {
  siteVisitId: string;
  totals: { total: number; open: number; noTeam: number };
  progress: { todo: number; inProgress: number; awaiting: number; closed: number };
  lanes: Array<{ category: string; total: number; canAssign: boolean }>;
};

describe('Authz · maintenance packages — contractor company view + progress (plan §15)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  const board = async (who: string) => {
    const res = await http(app, token[who]).get('/api/v1/maintenance-packages/board').expect(200);
    return res.body as {
      actorKind: string;
      canAssign: boolean;
      companies: Array<{ id: string }>;
      teams: Array<{ id: string }>;
      pencawangs: BoardPe[];
    };
  };
  const pe = (body: { pencawangs: BoardPe[] }) =>
    body.pencawangs.find((row) => row.siteVisitId === P.visit);
  const lane = (row: BoardPe | undefined, category: string) =>
    row?.lanes.find((candidate) => candidate.category === category);
  const pkgOf = (category: 'RENTIS' | 'SELENGGARAAN' | 'CAT_TIANG') =>
    prisma.maintenancePackage.findFirst({ where: { siteVisitId: P.visit, category } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const t = IDS.tenant.t1;

    await prisma.team.create({
      data: { id: P.teamS2, tenantId: t, name: 'Team S2', code: 'TS2-C15', organizationId: IDS.sub.org },
    });
    await prisma.substation.create({
      data: { id: P.sub, tenantId: t, name: 'Company View PE', code: 'CV-1', latitude: 3.9, longitude: 103.4 },
    });
    await prisma.siteVisit.create({
      data: {
        id: P.visit,
        tenantId: t,
        teamId: IDS.team.a,
        substationId: P.sub,
        createdByUserId: IDS.user.mgrA,
        organizationId: IDS.org.a,
        status: 'ACTIVE',
        lifecycleStatus: 'LAPORAN_SELESAI',
        laporanSelesaiAt: new Date(),
      },
    });
    await prisma.asset.createMany({
      data: P.asset.map((id, index) => ({
        id,
        tenantId: t,
        assetCode: `CV-POLE-${index + 1}`,
        substationId: P.sub,
        assetTypeId: IDS.assetType.savr,
      })),
    });
    await prisma.inspection.createMany({
      data: P.inspection.map((id, index) => ({
        id,
        tenantId: t,
        assetId: P.asset[index],
        siteVisitId: P.visit,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED' as const,
        submittedAt: new Date(),
      })),
    });
    const inspectionOf = [P.inspection[0], P.inspection[1], P.inspection[1]];
    await prisma.inspectionItemResult.createMany({
      data: P.item.map((id, index) => ({
        id,
        inspectionId: inspectionOf[index],
        label: 'Kejanggalan',
        result: 'FAIL' as const,
        isDefect: true,
        severity: 'MEDIUM' as const,
      })),
    });
    await prisma.defect.createMany({
      data: [
        { id: P.defect.rentis, inspectionItemResultId: P.item[0], status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED', maintenanceCategory: 'RENTIS' },
        { id: P.defect.sel, inspectionItemResultId: P.item[1], status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED', maintenanceCategory: 'SELENGGARAAN' },
        { id: P.defect.cat, inspectionItemResultId: P.item[2], status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED', maintenanceCategory: 'CAT_TIANG' },
      ],
    });

    token.admin = await login(app, EMAILS.adminT1);
    token.subMgr = await login(app, EMAILS.subMgr);
    token.supA = await login(app, EMAILS.supA);
    token.techA = await login(app, EMAILS.techA);

    // TNB's side (done by ADMIN here): Rentis → subcontractor S (company only, with
    // a target date + note); Selenggaraan → Company B; Cat tiang → Company A.
    await http(app, token.admin)
      .post('/api/v1/maintenance-packages')
      .send({ siteVisitId: P.visit, category: 'RENTIS', maintenanceOrganizationId: IDS.sub.org, dueDate: DUE, notes: 'TNB note' })
      .expect(201);
    await http(app, token.admin)
      .post('/api/v1/maintenance-packages')
      .send({ siteVisitId: P.visit, category: 'SELENGGARAAN', maintenanceOrganizationId: IDS.org.b })
      .expect(201);
    await http(app, token.admin)
      .post('/api/v1/maintenance-packages')
      .send({ siteVisitId: P.visit, category: 'CAT_TIANG', maintenanceOrganizationId: IDS.org.a })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.maintenancePoleAssignment.deleteMany({ where: { siteVisitId: P.visit } });
    await prisma.maintenancePackage.deleteMany({ where: { siteVisitId: P.visit } });
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: ALL_DEFECTS } } });
    await prisma.defect.deleteMany({ where: { id: { in: ALL_DEFECTS } } });
    await prisma.inspectionItemResult.deleteMany({ where: { id: { in: P.item } } });
    await prisma.inspection.deleteMany({ where: { id: { in: P.inspection } } });
    await prisma.siteVisit.deleteMany({ where: { id: P.visit } });
    await prisma.asset.deleteMany({ where: { id: { in: P.asset } } });
    await prisma.substation.deleteMany({ where: { id: P.sub } });
    await prisma.team.deleteMany({ where: { id: P.teamS2 } });
    await app?.close();
  });

  describe('auth flags', () => {
    const me = async (who: string) =>
      (await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token[who]}`).expect(200))
        .body as { canViewMaintenancePackages?: boolean; canViewRepairVerification?: boolean };

    it('a subcontractor manager + a contractor supervisor get the packages page, not repair verification', async () => {
      expect(await me('subMgr')).toMatchObject({ canViewMaintenancePackages: true, canViewRepairVerification: false });
      expect(await me('supA')).toMatchObject({ canViewMaintenancePackages: true, canViewRepairVerification: false });
    });

    it('a technician gets neither', async () => {
      expect(await me('techA')).toMatchObject({ canViewMaintenancePackages: false, canViewRepairVerification: false });
      await http(app, token.techA).get('/api/v1/maintenance-packages/board').expect(403);
    });
  });

  describe('subcontractor manager', () => {
    it('sees only its own company work: own lanes assignable, the rest not; own teams only', async () => {
      const body = await board('subMgr');
      expect(body).toMatchObject({ actorKind: 'COMPANY', canAssign: true });
      expect(body.companies.map((company) => company.id)).toEqual([IDS.sub.org]);
      expect(body.teams.map((team) => team.id).sort()).toEqual([IDS.sub.team, P.teamS2].sort());

      const row = pe(body);
      // Only the Rentis Kejanggalan is the subcontractor's.
      expect(row?.totals).toMatchObject({ total: 1, open: 1, noTeam: 1 });
      expect(row?.progress).toEqual({ todo: 1, inProgress: 0, awaiting: 0, closed: 0 });
      expect(lane(row, 'RENTIS')).toMatchObject({ total: 1, canAssign: true });
      expect(lane(row, 'SELENGGARAAN')).toMatchObject({ total: 0, canAssign: false });
      expect(lane(row, 'CAT_TIANG')).toMatchObject({ canAssign: false });
    });

    it('re-teams its lane; TNB target date, note and "assigned by" stay', async () => {
      const before = await pkgOf('RENTIS');
      await http(app, token.subMgr)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visit, category: 'RENTIS', assignedTeamId: IDS.sub.team, dueDate: '2027-06-30', notes: 'mine' })
        .expect(201);
      const after = await pkgOf('RENTIS');
      expect(after).toMatchObject({
        maintenanceOrganizationId: IDS.sub.org,
        assignedTeamId: IDS.sub.team,
        notes: 'TNB note',
        assignedByUserId: before!.assignedByUserId,
      });
      expect(after!.dueDate?.toISOString()).toBe(DUE);
      expect(
        await prisma.defect.findUniqueOrThrow({
          where: { id: P.defect.rentis },
          select: { assignedToTeamId: true, lifecycleStatus: true },
        }),
      ).toEqual({ assignedToTeamId: IDS.sub.team, lifecycleStatus: 'ASSIGNED' });
      expect(pe(await board('subMgr'))?.totals.noTeam).toBe(0);
    });

    it('cannot touch another company lane, the whole PE, another company, or withdraw', async () => {
      await http(app, token.subMgr)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visit, category: 'SELENGGARAAN', assignedTeamId: IDS.sub.team })
        .expect(403);
      await http(app, token.subMgr)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visit, assignedTeamId: IDS.sub.team })
        .expect(403);
      await http(app, token.subMgr)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visit, category: 'RENTIS', assignedTeamId: IDS.team.a })
        .expect(403);
      const own = await pkgOf('RENTIS');
      await http(app, token.subMgr).del(`/api/v1/maintenance-packages/${own!.id}`).expect(403);
    });

    it('splits its own poles between its own teams, keeping the target date', async () => {
      await http(app, token.subMgr)
        .post(`/api/v1/maintenance-packages/${P.visit}/poles`)
        .send({ assetIds: [P.asset[0]], category: 'RENTIS', assignedTeamId: P.teamS2 })
        .expect(201);
      const split = await prisma.maintenancePoleAssignment.findFirstOrThrow({
        where: { siteVisitId: P.visit, assetId: P.asset[0] },
      });
      expect(split).toMatchObject({ maintenanceOrganizationId: IDS.sub.org, assignedTeamId: P.teamS2 });
      expect(split.dueDate?.toISOString()).toBe(DUE);

      // Pole 2's work types are other companies' — not its to split.
      await http(app, token.subMgr)
        .post(`/api/v1/maintenance-packages/${P.visit}/poles`)
        .send({ assetIds: [P.asset[1]], assignedTeamId: P.teamS2 })
        .expect(403);

      // Back to its own Rentis package (the PE owner for that work type).
      await http(app, token.subMgr)
        .post(`/api/v1/maintenance-packages/${P.visit}/poles/clear`)
        .send({ assetIds: [P.asset[0]] })
        .expect(201);
    });
  });

  describe('contractor supervisor (view only)', () => {
    it("sees its company's Cat tiang work but cannot assign", async () => {
      const body = await board('supA');
      expect(body).toMatchObject({ actorKind: 'COMPANY', canAssign: false });
      const row = pe(body);
      expect(row?.totals).toMatchObject({ total: 1 });
      expect(lane(row, 'CAT_TIANG')).toMatchObject({ total: 1, canAssign: false });
      await http(app, token.supA)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visit, category: 'CAT_TIANG', assignedTeamId: IDS.team.a })
        .expect(403);
    });
  });

  describe('progress', () => {
    it('counts in progress / awaiting verification / closed', async () => {
      await prisma.defect.update({ where: { id: P.defect.sel }, data: { lifecycleStatus: 'IN_PROGRESS' } });
      await prisma.defect.update({ where: { id: P.defect.cat }, data: { lifecycleStatus: 'COMPLETED' } });
      await prisma.defect.update({ where: { id: P.defect.rentis }, data: { lifecycleStatus: 'CLOSED', status: 'CLOSED' } });
      try {
        const row = pe(await board('admin'));
        expect(row?.progress).toEqual({ todo: 0, inProgress: 1, awaiting: 1, closed: 1 });
        expect(row?.totals).toMatchObject({ total: 3, open: 1 });
      } finally {
        await prisma.defect.updateMany({
          where: { id: { in: ALL_DEFECTS } },
          data: { lifecycleStatus: 'ASSIGNED', status: 'OPEN' },
        });
      }
    });
  });
});

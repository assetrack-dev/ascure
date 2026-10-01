import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Plan §12 (2026-10-01) — team assignment + Main Contractor assigning.
 *
 *  1. TNB may hand a PE straight to a TEAM (company implied): the Kejanggalan go
 *     to that crew (VERIFIED → ASSIGNED); a team from another company is a 400.
 *  2. A Main Contractor MANAGER sees PEs on its company's Mainheads plus PEs
 *     routed into its group; assigns only to its own company / subcontractors /
 *     their teams; never touches a lane TNB gave to an outside company.
 *  3. BULK assigns one destination to many PEs, reporting the ones it skipped.
 *  4. A Manager re-teaming from the Maintenance Workspace keeps the package's
 *     team in step.
 *
 * Self-contained: Company A (IDS.org.a, MAIN_CONTRACTOR, mgrA) with its
 * subcontractor S (IDS.sub.org) is the Main Contractor under test.
 */
const P = {
  tnb: '0e000000-0000-4000-8000-0000000c1201',
  foreman: '10000000-0000-4000-8000-0000000c1201',
  engineer: '10000000-0000-4000-8000-0000000c1202',
  teamA2: '20000000-0000-4000-8000-0000000c1201',
  region: 'd0000000-0000-4000-8000-0000000c1201',
  mhTnb: 'e0000000-0000-4000-8000-0000000c1201',
  mhMc: 'e0000000-0000-4000-8000-0000000c1202',
  subTnb: '30000000-0000-4000-8000-0000000c1201',
  subMc: '30000000-0000-4000-8000-0000000c1202',
  visitTnb: '60000000-0000-4000-8000-0000000c1201',
  visitMc: '60000000-0000-4000-8000-0000000c1202',
  asset: [
    '70000000-0000-4000-8000-0000000c1201',
    '70000000-0000-4000-8000-0000000c1202',
    '70000000-0000-4000-8000-0000000c1203',
  ],
  inspection: [
    '80000000-0000-4000-8000-0000000c1201',
    '80000000-0000-4000-8000-0000000c1202',
    '80000000-0000-4000-8000-0000000c1203',
  ],
  item: [
    '90000000-0000-4000-8000-0000000c1201',
    '90000000-0000-4000-8000-0000000c1202',
    '90000000-0000-4000-8000-0000000c1203',
  ],
  defect: {
    rentis: 'a0000000-0000-4000-8000-0000000c1201',
    sel: 'a0000000-0000-4000-8000-0000000c1202',
    mc: 'a0000000-0000-4000-8000-0000000c1203',
  },
  email: { foreman: 'teams.foreman@authz.test', engineer: 'teams.engineer@authz.test' },
};

const ALL_DEFECTS = Object.values(P.defect);
const VISITS = [P.visitTnb, P.visitMc];

describe('Authz · maintenance packages — teams + Main Contractor (plan §12)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  const defect = (id: string) =>
    prisma.defect.findUniqueOrThrow({
      where: { id },
      select: {
        maintenanceOrganizationId: true,
        assignedToTeamId: true,
        assignedTeamId: true,
        lifecycleStatus: true,
      },
    });
  const packagesOf = (siteVisitId: string) =>
    prisma.maintenancePackage.findMany({
      where: { siteVisitId },
      select: { id: true, category: true, maintenanceOrganizationId: true, assignedTeamId: true },
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
      data: { id: P.tnb, tenantId: t, name: 'TNB (teams spec)', type: 'TNB', isActive: true },
    });
    await prisma.user.createMany({
      data: [
        { id: P.foreman, tenantId: t, email: P.email.foreman, name: 'TNB Foreman T', passwordHash, role: 'CLIENT', clientRank: 'FOREMAN', organizationId: P.tnb },
        { id: P.engineer, tenantId: t, email: P.email.engineer, name: 'TNB Engineer T', passwordHash, role: 'CLIENT', clientRank: 'ENGINEER', organizationId: P.tnb },
      ],
    });
    await prisma.team.create({
      data: { id: P.teamA2, tenantId: t, name: 'Team A2', code: 'TA2-C12', organizationId: IDS.org.a },
    });
    await prisma.operationalRegion.create({
      data: { id: P.region, tenantId: t, name: 'Teams Region', code: 'TMR', isActive: true },
    });
    await prisma.mainhead.createMany({
      data: [
        { id: P.mhTnb, name: 'TEAMS MH TNB', isActive: true, operationalRegionId: P.region },
        { id: P.mhMc, name: 'TEAMS MH MC', isActive: true, operationalRegionId: P.region },
      ],
    });
    await prisma.organizationMainhead.createMany({
      data: [
        // TNB owns both; Company A (the MC) is assigned only the MC Mainhead.
        { organizationId: P.tnb, mainheadId: P.mhTnb, isActive: true },
        { organizationId: P.tnb, mainheadId: P.mhMc, isActive: true },
        { organizationId: IDS.org.a, mainheadId: P.mhMc, isActive: true },
      ],
    });
    await prisma.substation.createMany({
      data: [
        { id: P.subTnb, tenantId: t, name: 'Teams PE TNB', code: 'TM-1', mainheadId: P.mhTnb, latitude: 3.81, longitude: 103.32 },
        { id: P.subMc, tenantId: t, name: 'Teams PE MC', code: 'TM-2', mainheadId: P.mhMc, latitude: 3.82, longitude: 103.33 },
      ],
    });
    const visitBase = {
      tenantId: t,
      teamId: IDS.team.a,
      createdByUserId: IDS.user.mgrA,
      organizationId: IDS.org.a,
      status: 'ACTIVE' as const,
      lifecycleStatus: 'LAPORAN_SELESAI' as const,
      laporanSelesaiAt: new Date(),
    };
    await prisma.siteVisit.createMany({
      data: [
        { ...visitBase, id: P.visitTnb, substationId: P.subTnb, mainheadId: P.mhTnb },
        { ...visitBase, id: P.visitMc, substationId: P.subMc, mainheadId: P.mhMc },
      ],
    });
    const visitOf = [P.visitTnb, P.visitTnb, P.visitMc];
    await prisma.asset.createMany({
      data: P.asset.map((id, index) => ({
        id,
        tenantId: t,
        assetCode: `TM-POLE-${index + 1}`,
        substationId: index === 2 ? P.subMc : P.subTnb,
        assetTypeId: IDS.assetType.savr,
      })),
    });
    await prisma.inspection.createMany({
      data: P.inspection.map((id, index) => ({
        id,
        tenantId: t,
        assetId: P.asset[index],
        siteVisitId: visitOf[index],
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED' as const,
        submittedAt: new Date(),
      })),
    });
    await prisma.inspectionItemResult.createMany({
      data: P.item.map((id, index) => ({
        id,
        inspectionId: P.inspection[index],
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
        { id: P.defect.mc, inspectionItemResultId: P.item[2], status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED', maintenanceCategory: 'SELENGGARAAN' },
      ],
    });

    token.foreman = await login(app, P.email.foreman);
    token.engineer = await login(app, P.email.engineer);
    token.mgrA = await login(app, EMAILS.mgrA);
    token.mgrB = await login(app, EMAILS.mgrB);
  });

  afterAll(async () => {
    await prisma.maintenancePackage.deleteMany({ where: { siteVisitId: { in: VISITS } } });
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: ALL_DEFECTS } } });
    await prisma.defect.deleteMany({ where: { id: { in: ALL_DEFECTS } } });
    await prisma.inspectionItemResult.deleteMany({ where: { id: { in: P.item } } });
    await prisma.inspection.deleteMany({ where: { id: { in: P.inspection } } });
    await prisma.siteVisit.deleteMany({ where: { id: { in: VISITS } } });
    await prisma.asset.deleteMany({ where: { id: { in: P.asset } } });
    await prisma.substation.deleteMany({ where: { id: { in: [P.subTnb, P.subMc] } } });
    await prisma.organizationMainhead.deleteMany({
      where: { mainheadId: { in: [P.mhTnb, P.mhMc] } },
    });
    await prisma.mainhead.deleteMany({ where: { id: { in: [P.mhTnb, P.mhMc] } } });
    await prisma.operationalRegion.deleteMany({ where: { id: P.region } });
    await prisma.team.deleteMany({ where: { id: P.teamA2 } });
    await prisma.user.deleteMany({ where: { id: { in: [P.foreman, P.engineer] } } });
    await prisma.organization.deleteMany({ where: { id: P.tnb } });
    await app?.close();
  });

  describe('TNB assigns a team', () => {
    it('a team from another company than the one named is a 400', () =>
      http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitTnb, maintenanceOrganizationId: IDS.org.b, assignedTeamId: IDS.team.a })
        .expect(400));

    it('neither company nor team is a 400', () =>
      http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitTnb })
        .expect(400));

    it('team only: the company is implied and the crew gets the work', async () => {
      const res = await http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitTnb, assignedTeamId: IDS.team.a })
        .expect(201);
      expect(res.body.routing).toEqual({ routed: 2, moved: 0, kept: 0, teamAssigned: 2 });

      const [pkg] = await packagesOf(P.visitTnb);
      expect(pkg).toMatchObject({ category: null, maintenanceOrganizationId: IDS.org.a, assignedTeamId: IDS.team.a });
      for (const id of [P.defect.rentis, P.defect.sel]) {
        expect(await defect(id)).toMatchObject({
          maintenanceOrganizationId: IDS.org.a,
          assignedToTeamId: IDS.team.a,
          assignedTeamId: IDS.team.a,
          lifecycleStatus: 'ASSIGNED',
        });
      }
    });

    it('re-posting the same team is idempotent', async () => {
      const res = await http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitTnb, assignedTeamId: IDS.team.a })
        .expect(201);
      expect(res.body.routing).toEqual({ routed: 0, moved: 0, kept: 0, teamAssigned: 0 });
    });

    it('the board shows the team and the PE location', async () => {
      const res = await http(app, token.foreman).get('/api/v1/maintenance-packages/board').expect(200);
      expect(res.body.actorKind).toBe('TNB');
      const row = res.body.pencawangs.find((pe: { siteVisitId: string }) => pe.siteVisitId === P.visitTnb);
      expect(row).toMatchObject({ latitude: 3.81, longitude: 103.32, canAssign: true });
      expect(row.packages[0].team).toEqual({ id: IDS.team.a, name: 'Team A' });
      expect(res.body.teams.map((team: { id: string }) => team.id)).toEqual(
        expect.arrayContaining([IDS.team.a, IDS.team.b, IDS.sub.team]),
      );
    });

    it('TNB Engineer cannot bulk assign (403)', () =>
      http(app, token.engineer)
        .post('/api/v1/maintenance-packages/bulk')
        .send({ siteVisitIds: [P.visitMc], assignedTeamId: IDS.team.a })
        .expect(403));
  });

  describe('Main Contractor manager', () => {
    it('sees its Mainhead PEs + PEs routed into its group; picks only its group', async () => {
      const res = await http(app, token.mgrA).get('/api/v1/maintenance-packages/board').expect(200);
      expect(res.body.actorKind).toBe('MAIN_CONTRACTOR');
      expect(res.body.canAssign).toBe(true);
      const ids = res.body.pencawangs.map((pe: { siteVisitId: string }) => pe.siteVisitId);
      expect(ids).toEqual(expect.arrayContaining([P.visitTnb, P.visitMc]));

      expect(res.body.companies.map((c: { id: string }) => c.id).sort()).toEqual(
        [IDS.org.a, IDS.sub.org].sort(),
      );
      const teamIds = res.body.teams.map((team: { id: string }) => team.id);
      expect(teamIds).toEqual(expect.arrayContaining([IDS.team.a, P.teamA2, IDS.sub.team]));
      expect(teamIds).not.toContain(IDS.team.b);
    });

    it('a Main Contractor outside the picture sees neither PE', async () => {
      const res = await http(app, token.mgrB).get('/api/v1/maintenance-packages/board').expect(200);
      const ids = res.body.pencawangs.map((pe: { siteVisitId: string }) => pe.siteVisitId);
      expect(ids).not.toContain(P.visitTnb);
      expect(ids).not.toContain(P.visitMc);
      await http(app, token.mgrB)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitMc, assignedTeamId: IDS.team.b })
        .expect(404);
    });

    it('cannot hand work to a company outside its group (403)', () =>
      http(app, token.mgrA)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitTnb, assignedTeamId: IDS.team.b })
        .expect(403));

    it('re-teams a PE TNB gave it — to its subcontractor crew', async () => {
      const res = await http(app, token.mgrA)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitTnb, assignedTeamId: IDS.sub.team })
        .expect(201);
      expect(res.body.routing).toEqual({ routed: 0, moved: 2, kept: 0, teamAssigned: 2 });
      expect(await defect(P.defect.sel)).toMatchObject({
        maintenanceOrganizationId: IDS.sub.org,
        assignedToTeamId: IDS.sub.team,
        lifecycleStatus: 'ASSIGNED',
      });
    });

    it('bulk: assigns what it may, reports what it skipped', async () => {
      // TNB first sends Rentis on visitTnb to Company B — now outside A's group.
      await http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitTnb, category: 'RENTIS', maintenanceOrganizationId: IDS.org.b })
        .expect(201);

      const res = await http(app, token.mgrA)
        .post('/api/v1/maintenance-packages/bulk')
        .send({
          siteVisitIds: [P.visitMc, P.visitTnb, P.visitMc],
          category: 'RENTIS',
          assignedTeamId: IDS.team.a,
        })
        .expect(201);
      expect(res.body).toMatchObject({ assigned: 1, skipped: 1 });
      const skipped = res.body.results.find((row: { status: string }) => row.status === 'SKIPPED');
      expect(skipped.siteVisitId).toBe(P.visitTnb);
      expect(skipped.reason).toMatch(/only TNB/);
      expect(await defect(P.defect.rentis)).toMatchObject({ maintenanceOrganizationId: IDS.org.b });
    });

    it('may not reassign the whole PE while a lane sits outside its group (403)', async () => {
      await http(app, token.mgrA)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitTnb, assignedTeamId: IDS.team.a })
        .expect(403);
      // …but its own Selenggaraan lane is still its to change.
      await http(app, token.mgrA)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitTnb, category: 'SELENGGARAAN', assignedTeamId: IDS.team.a })
        .expect(201);
      expect(await defect(P.defect.sel)).toMatchObject({
        maintenanceOrganizationId: IDS.org.a,
        assignedToTeamId: IDS.team.a,
      });

      const board = await http(app, token.mgrA).get('/api/v1/maintenance-packages/board').expect(200);
      const row = board.body.pencawangs.find((pe: { siteVisitId: string }) => pe.siteVisitId === P.visitTnb);
      expect(row.canAssign).toBe(false);
      const lane = (category: string) =>
        row.lanes.find((candidate: { category: string }) => candidate.category === category);
      expect(lane('RENTIS').canAssign).toBe(false);
      expect(lane('SELENGGARAAN').canAssign).toBe(true);
    });

    it("a Manager re-teaming in the Workspace keeps the package's team in step", async () => {
      // The bulk above gave visitMc a RENTIS-lane package; make it whole-PE → team A.
      await http(app, token.mgrA)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitMc, assignedTeamId: IDS.team.a })
        .expect(201);
      await http(app, token.mgrA)
        .patch('/api/v1/defects/maintenance-workspace/assign')
        .send({ substationId: P.subMc, assignedToTeamId: P.teamA2 })
        .expect(200);
      expect(await defect(P.defect.mc)).toMatchObject({ assignedToTeamId: P.teamA2 });
      const [pkg] = await packagesOf(P.visitMc);
      expect(pkg.assignedTeamId).toBe(P.teamA2);
    });

    it('withdraws its own package on its Mainhead, not one TNB routed elsewhere', async () => {
      const outside = (await packagesOf(P.visitTnb)).find((pkg) => pkg.category === 'RENTIS');
      await http(app, token.mgrA).del(`/api/v1/maintenance-packages/${outside!.id}`).expect(403);

      const own = (await packagesOf(P.visitTnb)).find((pkg) => pkg.category === 'SELENGGARAAN');
      // Its own group's work, but on TNB's Mainhead — TNB's to withdraw.
      await http(app, token.mgrA).del(`/api/v1/maintenance-packages/${own!.id}`).expect(403);

      const [mine] = await packagesOf(P.visitMc);
      const res = await http(app, token.mgrA).del(`/api/v1/maintenance-packages/${mine.id}`).expect(200);
      expect(res.body.routing.moved).toBe(1);
      expect(await defect(P.defect.mc)).toMatchObject({
        maintenanceOrganizationId: null,
        assignedToTeamId: null,
        lifecycleStatus: 'VERIFIED',
      });
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * TNB → maintenance company packages (docs/PLAN-maintenance-flow.md §5, M1 step 2).
 *
 *  1. VIEW: ADMIN + every TNB rank see the board, scoped to TNB's Mainheads and
 *     to PEs whose report is final (LAPORAN SELESAI / ARKIB). Contractors 403.
 *  2. ACT: only TNB FOREMAN / TECHNICIAN (+ ADMIN) assign; ENGINEER 403.
 *  3. ROUTING: assigning stamps Defect.maintenanceOrganizationId so the company
 *     sees its pool; splitting by work type moves just that lane.
 *  4. REASSIGN (owner rule): only Kejanggalan without repair evidence move, with
 *     their work state reset; evidenced ones stay with the original company;
 *     work delegated inside the new company's own subtree is left alone.
 *  5. WITHDRAW returns the not-started Kejanggalan to TNB (unrouted).
 *  6. EMERGENCIES with no package are routed manually, single-winner.
 *
 * Self-contained: builds and removes its own TNB org / Mainheads / PE chain.
 */
const P = {
  tnb: '0e000000-0000-4000-8000-0000000000b1',
  foreman: '10000000-0000-4000-8000-0000000000b7',
  engineer: '10000000-0000-4000-8000-0000000000b8',
  region: 'd0000000-0000-4000-8000-0000000000b1',
  mh: 'e0000000-0000-4000-8000-0000000000b1',
  mhOut: 'e0000000-0000-4000-8000-0000000000b2',
  sub: '30000000-0000-4000-8000-0000000000b1',
  subOut: '30000000-0000-4000-8000-0000000000b2',
  visit: '60000000-0000-4000-8000-0000000000b1',
  visitField: '60000000-0000-4000-8000-0000000000b2',
  visitOut: '60000000-0000-4000-8000-0000000000b3',
  asset: [
    '70000000-0000-4000-8000-0000000000b1',
    '70000000-0000-4000-8000-0000000000b2',
    '70000000-0000-4000-8000-0000000000b3',
    '70000000-0000-4000-8000-0000000000b4',
    '70000000-0000-4000-8000-0000000000b5',
  ],
  inspection: [
    '80000000-0000-4000-8000-0000000000b1',
    '80000000-0000-4000-8000-0000000000b2',
    '80000000-0000-4000-8000-0000000000b3',
    '80000000-0000-4000-8000-0000000000b4',
    '80000000-0000-4000-8000-0000000000b5',
  ],
  item: {
    rentis: '90000000-0000-4000-8000-0000000000b1',
    sel1: '90000000-0000-4000-8000-0000000000b2',
    sel2: '90000000-0000-4000-8000-0000000000b3',
    emergency: '90000000-0000-4000-8000-0000000000b4',
    out: '90000000-0000-4000-8000-0000000000b5',
  },
  defect: {
    rentis: 'a0000000-0000-4000-8000-0000000000b1',
    sel1: 'a0000000-0000-4000-8000-0000000000b2',
    sel2: 'a0000000-0000-4000-8000-0000000000b3',
    emergency: 'a0000000-0000-4000-8000-0000000000b4',
    out: 'a0000000-0000-4000-8000-0000000000b5',
  },
  email: { foreman: 'pkg.foreman@authz.test', engineer: 'pkg.engineer@authz.test' },
};

const ALL_DEFECTS = Object.values(P.defect);

describe('Authz · maintenance packages (TNB → company)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  const orgOf = async (defectId: string) =>
    (
      await prisma.defect.findUniqueOrThrow({
        where: { id: defectId },
        select: { maintenanceOrganizationId: true },
      })
    ).maintenanceOrganizationId;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const { passwordHash } = await prisma.user.findUniqueOrThrow({
      where: { id: IDS.user.mgrA },
      select: { passwordHash: true },
    });
    const t = IDS.tenant.t1;

    await prisma.organization.create({
      data: { id: P.tnb, tenantId: t, name: 'TNB (packages spec)', type: 'TNB', isActive: true },
    });
    await prisma.user.createMany({
      data: [
        { id: P.foreman, tenantId: t, email: P.email.foreman, name: 'TNB Foreman', passwordHash, role: 'CLIENT', clientRank: 'FOREMAN', organizationId: P.tnb },
        { id: P.engineer, tenantId: t, email: P.email.engineer, name: 'TNB Engineer', passwordHash, role: 'CLIENT', clientRank: 'ENGINEER', organizationId: P.tnb },
      ],
    });
    await prisma.operationalRegion.create({
      data: { id: P.region, tenantId: t, name: 'Pkg Region', code: 'PKR', isActive: true },
    });
    await prisma.mainhead.createMany({
      data: [
        // MaintCo is the Mainhead's registered default → the board's suggestion.
        { id: P.mh, name: 'PKG MH IN', isActive: true, operationalRegionId: P.region, maintenanceOrganizationId: IDS.org.maint },
        { id: P.mhOut, name: 'PKG MH OUT', isActive: true, operationalRegionId: P.region },
      ],
    });
    await prisma.organizationMainhead.create({
      data: { organizationId: P.tnb, mainheadId: P.mh, isActive: true },
    });
    await prisma.substation.createMany({
      data: [
        { id: P.sub, tenantId: t, name: 'Pkg Pencawang', code: 'PK-1', mainheadId: P.mh },
        { id: P.subOut, tenantId: t, name: 'Pkg Outside', code: 'PK-2', mainheadId: P.mhOut },
      ],
    });
    const visitBase = {
      tenantId: t,
      teamId: IDS.team.a,
      createdByUserId: IDS.user.mgrA,
      organizationId: IDS.org.a,
      status: 'ACTIVE' as const,
    };
    await prisma.siteVisit.createMany({
      data: [
        { ...visitBase, id: P.visit, substationId: P.sub, mainheadId: P.mh, lifecycleStatus: 'LAPORAN_SELESAI', laporanSelesaiAt: new Date() },
        { ...visitBase, id: P.visitField, substationId: P.sub, mainheadId: P.mh, lifecycleStatus: 'DALAM_RONDAAN' },
        { ...visitBase, id: P.visitOut, substationId: P.subOut, mainheadId: P.mhOut, lifecycleStatus: 'LAPORAN_SELESAI' },
      ],
    });
    const visitOfAsset = [P.visit, P.visit, P.visit, P.visitField, P.visitOut];
    await prisma.asset.createMany({
      data: P.asset.map((id, index) => ({
        id,
        tenantId: t,
        assetCode: `PK-POLE-${index + 1}`,
        substationId: index === 4 ? P.subOut : P.sub,
        assetTypeId: IDS.assetType.savr,
      })),
    });
    await prisma.inspection.createMany({
      data: P.inspection.map((id, index) => ({
        id,
        tenantId: t,
        assetId: P.asset[index],
        siteVisitId: visitOfAsset[index],
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED' as const,
        submittedAt: new Date(),
      })),
    });
    const items: Array<[string, number, string]> = [
      [P.item.rentis, 0, 'RENTIS'],
      [P.item.sel1, 1, 'SELENGGARAAN'],
      [P.item.sel2, 2, 'SELENGGARAAN'],
      [P.item.emergency, 3, 'SELENGGARAAN'],
      [P.item.out, 4, 'SELENGGARAAN'],
    ];
    await prisma.inspectionItemResult.createMany({
      data: items.map(([id, index]) => ({
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
        { id: P.defect.rentis, inspectionItemResultId: P.item.rentis, status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED', maintenanceCategory: 'RENTIS' },
        { id: P.defect.sel1, inspectionItemResultId: P.item.sel1, status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED', maintenanceCategory: 'SELENGGARAAN' },
        { id: P.defect.sel2, inspectionItemResultId: P.item.sel2, status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED' },
        { id: P.defect.emergency, inspectionItemResultId: P.item.emergency, status: 'OPEN', severity: 'CRITICAL', lifecycleStatus: 'VERIFIED', isEmergency: true },
        { id: P.defect.out, inspectionItemResultId: P.item.out, status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED' },
      ],
    });

    token.admin = await login(app, EMAILS.adminT1);
    token.mgrA = await login(app, EMAILS.mgrA);
    token.maintUser = await login(app, EMAILS.maintUser);
    token.foreman = await login(app, P.email.foreman);
    token.engineer = await login(app, P.email.engineer);
  });

  afterAll(async () => {
    await prisma.maintenancePackage.deleteMany({
      where: { siteVisitId: { in: [P.visit, P.visitField, P.visitOut] } },
    });
    await prisma.defectEvidenceImage.deleteMany({ where: { defectId: { in: ALL_DEFECTS } } });
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: ALL_DEFECTS } } });
    await prisma.defect.deleteMany({ where: { id: { in: ALL_DEFECTS } } });
    await prisma.inspectionItemResult.deleteMany({ where: { id: { in: Object.values(P.item) } } });
    await prisma.inspection.deleteMany({ where: { id: { in: P.inspection } } });
    await prisma.siteVisit.deleteMany({ where: { id: { in: [P.visit, P.visitField, P.visitOut] } } });
    await prisma.asset.deleteMany({ where: { id: { in: P.asset } } });
    await prisma.substation.deleteMany({ where: { id: { in: [P.sub, P.subOut] } } });
    await prisma.organizationMainhead.deleteMany({ where: { organizationId: P.tnb } });
    await prisma.mainhead.deleteMany({ where: { id: { in: [P.mh, P.mhOut] } } });
    await prisma.operationalRegion.deleteMany({ where: { id: P.region } });
    await prisma.user.deleteMany({ where: { id: { in: [P.foreman, P.engineer] } } });
    await prisma.organization.deleteMany({ where: { id: P.tnb } });
    await app?.close();
  });

  describe('board visibility', () => {
    it('TNB Engineer sees only final-report PEs on its Mainheads, view-only', async () => {
      const res = await http(app, token.engineer).get('/api/v1/maintenance-packages/board').expect(200);
      expect(res.body.canAssign).toBe(false);
      const ids = res.body.pencawangs.map((row: { siteVisitId: string }) => row.siteVisitId);
      expect(ids).toEqual([P.visit]);

      const row = res.body.pencawangs[0];
      expect(row.poleCount).toBe(3);
      expect(row.totals).toMatchObject({ total: 3, open: 3, unrouted: 3 });
      const lane = (category: string) =>
        row.lanes.find((candidate: { category: string }) => candidate.category === category);
      expect(lane('RENTIS').total).toBe(1);
      expect(lane('SELENGGARAAN').total).toBe(2);
      expect(row.suggestedOrganizationId).toBe(IDS.org.maint);

      // The field-stage PE's emergency is released instantly → unrouted queue.
      expect(res.body.emergencies.map((e: { defectId: string }) => e.defectId)).toEqual([
        P.defect.emergency,
      ]);
    });

    it('TNB Foreman may assign', async () => {
      const res = await http(app, token.foreman).get('/api/v1/maintenance-packages/board').expect(200);
      expect(res.body.canAssign).toBe(true);
    });

    it('a contractor cannot open the board (403)', () =>
      http(app, token.mgrA).get('/api/v1/maintenance-packages/board').expect(403));

    it('ADMIN sees every final-report PE in the tenant', async () => {
      const res = await http(app, token.admin).get('/api/v1/maintenance-packages/board').expect(200);
      const ids = res.body.pencawangs.map((row: { siteVisitId: string }) => row.siteVisitId);
      expect(ids).toEqual(expect.arrayContaining([P.visit, P.visitOut]));
      expect(ids).not.toContain(P.visitField);
    });
  });

  describe('assign rules', () => {
    it('TNB Engineer cannot assign (403)', () =>
      http(app, token.engineer)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visit, maintenanceOrganizationId: IDS.org.maint })
        .expect(403));

    it('a PE still in the field cannot be assigned (400)', () =>
      http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitField, maintenanceOrganizationId: IDS.org.maint })
        .expect(400));

    it("a PE outside TNB's Mainheads is not found (404)", () =>
      http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visitOut, maintenanceOrganizationId: IDS.org.maint })
        .expect(404));

    it('only a contractor company can receive a package (400 for TNB itself)', () =>
      http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visit, maintenanceOrganizationId: P.tnb })
        .expect(400));
  });

  describe('routing lifecycle', () => {
    it('whole-PE assign routes every Kejanggalan to the company', async () => {
      const res = await http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({
          siteVisitId: P.visit,
          maintenanceOrganizationId: IDS.org.maint,
          dueDate: '2026-12-31',
          notes: 'Pakej 1',
        })
        .expect(201);
      expect(res.body.routing).toEqual({ routed: 3, moved: 0, kept: 0 });
      for (const id of [P.defect.rentis, P.defect.sel1, P.defect.sel2]) {
        expect(await orgOf(id)).toBe(IDS.org.maint);
      }
      // The field-stage emergency is NOT part of this PE's package.
      expect(await orgOf(P.defect.emergency)).toBeNull();
    });

    it('the company now sees its routed Kejanggalan', () =>
      http(app, token.maintUser).get(`/api/v1/defects/${P.defect.rentis}`).expect(200));

    it('the assignment is idempotent', async () => {
      const res = await http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visit, maintenanceOrganizationId: IDS.org.maint, dueDate: '2026-12-31' })
        .expect(201);
      expect(res.body.routing).toEqual({ routed: 0, moved: 0, kept: 0 });
    });

    it('splitting off Rentis moves only that lane', async () => {
      const res = await http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visit, category: 'RENTIS', maintenanceOrganizationId: IDS.org.b })
        .expect(201);
      expect(res.body.routing).toEqual({ routed: 0, moved: 1, kept: 0 });
      expect(await orgOf(P.defect.rentis)).toBe(IDS.org.b);
      expect(await orgOf(P.defect.sel1)).toBe(IDS.org.maint);

      const packages = await prisma.maintenancePackage.findMany({
        where: { siteVisitId: P.visit },
        select: { category: true, maintenanceOrganizationId: true, dueDate: true },
      });
      expect(packages).toHaveLength(2);
      expect(packages.find((pkg) => pkg.category === null)).toBeUndefined();
      // The Selenggaraan lane inherited the whole package's target date.
      expect(
        packages.find((pkg) => pkg.category === 'SELENGGARAAN')?.dueDate?.toISOString(),
      ).toBe(new Date('2026-12-31').toISOString());
    });

    it('reassign moves only un-evidenced work, resetting its state', async () => {
      // sel1: MaintCo already assigned a team but took no photos → movable.
      await prisma.defect.update({
        where: { id: P.defect.sel1 },
        data: { lifecycleStatus: 'ASSIGNED', assignedToTeamId: IDS.team.a, actionRemark: 'x' },
      });
      // sel2: MaintCo has a BEFORE photo → stays credited to MaintCo.
      await prisma.defectEvidenceImage.create({
        data: { defectId: P.defect.sel2, evidenceType: 'BEFORE', fileName: 'b.jpg', storageKey: 'k/b.jpg' },
      });

      const res = await http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visit, category: 'SELENGGARAAN', maintenanceOrganizationId: IDS.org.a })
        .expect(201);
      expect(res.body.routing).toEqual({ routed: 0, moved: 1, kept: 1 });

      const moved = await prisma.defect.findUniqueOrThrow({ where: { id: P.defect.sel1 } });
      expect(moved.maintenanceOrganizationId).toBe(IDS.org.a);
      expect(moved.lifecycleStatus).toBe('VERIFIED');
      expect(moved.assignedToTeamId).toBeNull();
      expect(moved.actionRemark).toBeNull();
      expect(await orgOf(P.defect.sel2)).toBe(IDS.org.maint);
    });

    it("work delegated inside the new company's subtree stays put", async () => {
      // Company A delegated Rentis to its subcontractor S before TNB reassigns
      // the whole PE to Company A.
      await prisma.defect.update({
        where: { id: P.defect.rentis },
        data: { maintenanceOrganizationId: IDS.sub.org },
      });
      await http(app, token.foreman)
        .post('/api/v1/maintenance-packages')
        .send({ siteVisitId: P.visit, maintenanceOrganizationId: IDS.org.a })
        .expect(201);
      expect(await orgOf(P.defect.rentis)).toBe(IDS.sub.org);
      expect(await orgOf(P.defect.sel1)).toBe(IDS.org.a);
      expect(await orgOf(P.defect.sel2)).toBe(IDS.org.maint);
      expect(
        await prisma.maintenancePackage.count({ where: { siteVisitId: P.visit } }),
      ).toBe(1);
    });

    it('withdrawing returns not-started work to TNB, keeps evidenced work', async () => {
      const pkg = await prisma.maintenancePackage.findFirstOrThrow({
        where: { siteVisitId: P.visit },
      });
      await http(app, token.engineer).del(`/api/v1/maintenance-packages/${pkg.id}`).expect(403);
      const res = await http(app, token.foreman)
        .del(`/api/v1/maintenance-packages/${pkg.id}`)
        .expect(200);
      expect(res.body.routing).toEqual({ routed: 0, moved: 2, kept: 1 });
      expect(await orgOf(P.defect.rentis)).toBeNull();
      expect(await orgOf(P.defect.sel1)).toBeNull();
      expect(await orgOf(P.defect.sel2)).toBe(IDS.org.maint);
    });

    it('every routing change is on the Kejanggalan timeline', async () => {
      const entries = await prisma.defectTimelineEntry.count({
        where: { defectId: P.defect.sel1, type: 'ASSIGNMENT_CHANGED' },
      });
      expect(entries).toBeGreaterThanOrEqual(3);
    });
  });

  describe('unrouted emergencies', () => {
    const path = `/api/v1/maintenance-packages/emergencies/${P.defect.emergency}`;

    it('TNB Engineer cannot route an emergency (403)', () =>
      http(app, token.engineer).post(path).send({ maintenanceOrganizationId: IDS.org.maint }).expect(403));

    it('TNB Foreman routes it once; a second attempt conflicts (409)', async () => {
      await http(app, token.foreman).post(path).send({ maintenanceOrganizationId: IDS.org.maint }).expect(201);
      expect(await orgOf(P.defect.emergency)).toBe(IDS.org.maint);
      await http(app, token.foreman).post(path).send({ maintenanceOrganizationId: IDS.org.b }).expect(409);
    });

    it("an emergency outside TNB's Mainheads is not found (404)", () =>
      http(app, token.foreman)
        .post(`/api/v1/maintenance-packages/emergencies/${P.defect.out}`)
        .send({ maintenanceOrganizationId: IDS.org.maint })
        .expect(404));
  });
});

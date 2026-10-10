import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Plan §12.6 (2026-10-01) — several teams on one Pencawang, split by poles.
 *
 *  1. TNB gives selected poles (whole, or one work type) to another team — of
 *     ANY company; the rest of the PE stays with its package owner.
 *  2. A pole split wins over the PE package and survives a PE-level reassign.
 *  3. Evidenced work keeps its crew; "clear" returns poles to the PE owner.
 *  4. A Main Contractor sees a PE where it only holds split poles, may act on
 *     its own poles, never on another company's.
 */
const P = {
  tnb: '0e000000-0000-4000-8000-0000000c1301',
  foreman: '10000000-0000-4000-8000-0000000c1301',
  engineer: '10000000-0000-4000-8000-0000000c1302',
  region: 'd0000000-0000-4000-8000-0000000c1301',
  mh: 'e0000000-0000-4000-8000-0000000c1301',
  sub: '30000000-0000-4000-8000-0000000c1301',
  visit: '60000000-0000-4000-8000-0000000c1301',
  asset: [
    '70000000-0000-4000-8000-0000000c1301',
    '70000000-0000-4000-8000-0000000c1302',
    '70000000-0000-4000-8000-0000000c1303',
    '70000000-0000-4000-8000-0000000c1304',
    '70000000-0000-4000-8000-0000000c1305',
  ],
  inspection: [
    '80000000-0000-4000-8000-0000000c1301',
    '80000000-0000-4000-8000-0000000c1302',
    '80000000-0000-4000-8000-0000000c1303',
    '80000000-0000-4000-8000-0000000c1304',
    '80000000-0000-4000-8000-0000000c1305',
  ],
  item: {
    p1sel: '90000000-0000-4000-8000-0000000c1301',
    p1ren: '90000000-0000-4000-8000-0000000c1302',
    p2sel: '90000000-0000-4000-8000-0000000c1303',
    p3sel: '90000000-0000-4000-8000-0000000c1304',
    p4sel: '90000000-0000-4000-8000-0000000c1305',
  },
  defect: {
    p1sel: 'a0000000-0000-4000-8000-0000000c1301',
    p1ren: 'a0000000-0000-4000-8000-0000000c1302',
    p2sel: 'a0000000-0000-4000-8000-0000000c1303',
    p3sel: 'a0000000-0000-4000-8000-0000000c1304',
    p4sel: 'a0000000-0000-4000-8000-0000000c1305',
  },
  email: { foreman: 'split.foreman@authz.test', engineer: 'split.engineer@authz.test' },
};

const ALL_DEFECTS = Object.values(P.defect);
const [POLE1, POLE2, POLE3, POLE4, POLE_CLEAN] = P.asset;

describe('Authz · maintenance packages — split a Pencawang by poles (plan §12.6)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};
  const base = `/api/v1/maintenance-packages/${P.visit}/poles`;

  const owner = async (id: string) =>
    prisma.defect.findUniqueOrThrow({
      where: { id },
      select: { maintenanceOrganizationId: true, assignedToTeamId: true, lifecycleStatus: true },
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
      data: { id: P.tnb, tenantId: t, name: 'TNB (split spec)', type: 'TNB', isActive: true },
    });
    await prisma.user.createMany({
      data: [
        { id: P.foreman, tenantId: t, email: P.email.foreman, name: 'TNB Foreman S', passwordHash, role: 'CLIENT', clientRank: 'FOREMAN', organizationId: P.tnb },
        { id: P.engineer, tenantId: t, email: P.email.engineer, name: 'TNB Engineer S', passwordHash, role: 'CLIENT', clientRank: 'ENGINEER', organizationId: P.tnb },
      ],
    });
    await prisma.operationalRegion.create({
      data: { id: P.region, tenantId: t, name: 'Split Region', code: 'SPR', isActive: true },
    });
    await prisma.mainhead.create({
      data: { id: P.mh, name: 'SPLIT MH', isActive: true, operationalRegionId: P.region },
    });
    await prisma.organizationMainhead.create({
      data: { organizationId: P.tnb, mainheadId: P.mh, isActive: true },
    });
    await prisma.substation.create({
      data: { id: P.sub, tenantId: t, name: 'Split PE', code: 'SP-1', mainheadId: P.mh, latitude: 3.9, longitude: 103.3 },
    });
    await prisma.siteVisit.create({
      data: {
        id: P.visit,
        tenantId: t,
        teamId: IDS.team.a,
        createdByUserId: IDS.user.mgrA,
        organizationId: IDS.org.a,
        status: 'ACTIVE',
        lifecycleStatus: 'LAPORAN_SELESAI',
        laporanSelesaiAt: new Date(),
        substationId: P.sub,
        mainheadId: P.mh,
      },
    });
    await prisma.asset.createMany({
      data: P.asset.map((id, index) => ({
        id,
        tenantId: t,
        assetCode: `SP-POLE-${index + 1}`,
        substationId: P.sub,
        assetTypeId: IDS.assetType.savr,
        latitude: 3.9 + index * 0.001,
        longitude: 103.3,
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
    const items: Array<[string, number]> = [
      [P.item.p1sel, 0],
      [P.item.p1ren, 0],
      [P.item.p2sel, 1],
      [P.item.p3sel, 2],
      [P.item.p4sel, 3],
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
    const defect = (id: string, item: string, category: 'SELENGGARAAN' | 'RENTIS') => ({
      id,
      inspectionItemResultId: item,
      status: 'OPEN' as const,
      severity: 'MEDIUM' as const,
      lifecycleStatus: 'VERIFIED' as const,
      maintenanceCategory: category,
    });
    await prisma.defect.createMany({
      data: [
        defect(P.defect.p1sel, P.item.p1sel, 'SELENGGARAAN'),
        defect(P.defect.p1ren, P.item.p1ren, 'RENTIS'),
        defect(P.defect.p2sel, P.item.p2sel, 'SELENGGARAAN'),
        defect(P.defect.p3sel, P.item.p3sel, 'SELENGGARAAN'),
        defect(P.defect.p4sel, P.item.p4sel, 'SELENGGARAAN'),
      ],
    });

    token.foreman = await login(app, P.email.foreman);
    token.engineer = await login(app, P.email.engineer);
    token.mgrB = await login(app, EMAILS.mgrB);

    // Start: the whole PE with Team A (Company A).
    await http(app, token.foreman)
      .post('/api/v1/maintenance-packages')
      .send({ siteVisitId: P.visit, assignedTeamId: IDS.team.a })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.maintenancePoleAssignment.deleteMany({ where: { siteVisitId: P.visit } });
    await prisma.maintenancePackage.deleteMany({ where: { siteVisitId: P.visit } });
    await prisma.defectEvidenceImage.deleteMany({ where: { defectId: { in: ALL_DEFECTS } } });
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: ALL_DEFECTS } } });
    await prisma.defect.deleteMany({ where: { id: { in: ALL_DEFECTS } } });
    await prisma.inspectionItemResult.deleteMany({ where: { id: { in: Object.values(P.item) } } });
    await prisma.inspection.deleteMany({ where: { id: { in: P.inspection } } });
    await prisma.siteVisit.deleteMany({ where: { id: P.visit } });
    await prisma.asset.deleteMany({ where: { id: { in: P.asset } } });
    await prisma.substation.deleteMany({ where: { id: P.sub } });
    await prisma.organizationMainhead.deleteMany({ where: { mainheadId: P.mh } });
    await prisma.mainhead.deleteMany({ where: { id: P.mh } });
    await prisma.operationalRegion.deleteMany({ where: { id: P.region } });
    await prisma.user.deleteMany({ where: { id: { in: [P.foreman, P.engineer] } } });
    await prisma.organization.deleteMany({ where: { id: P.tnb } });
    await app?.close();
  });

  it('lists only poles carrying Kejanggalan, each with its owner', async () => {
    const res = await http(app, token.engineer).get(base).expect(200);
    expect(res.body.canAssign).toBe(false);
    expect(res.body.poles.map((pole: { assetId: string }) => pole.assetId)).toEqual([
      POLE1,
      POLE2,
      POLE3,
      POLE4,
    ]);
    const pole1 = res.body.poles[0];
    expect(pole1).toMatchObject({ assetCode: 'SP-POLE-1', open: 2, latitude: 3.9, split: false });
    expect(pole1.lanes).toEqual([
      expect.objectContaining({ category: 'RENTIS', organization: { id: IDS.org.a, name: 'Company A' }, team: { id: IDS.team.a, name: 'Team A' }, source: 'PACKAGE' }),
      expect.objectContaining({ category: 'SELENGGARAAN', source: 'PACKAGE' }),
    ]);
  });

  it('TNB Engineer cannot split (403)', () =>
    http(app, token.engineer).post(base).send({ assetIds: [POLE3], assignedTeamId: IDS.team.b }).expect(403));

  it('a pole without Kejanggalan on this survey is a 400', () =>
    http(app, token.foreman).post(base).send({ assetIds: [POLE_CLEAN], assignedTeamId: IDS.team.b }).expect(400));

  it('TNB gives poles 3–4 to a team of ANOTHER company; poles 1–2 stay', async () => {
    const res = await http(app, token.foreman)
      .post(base)
      .send({ assetIds: [POLE3, POLE4], assignedTeamId: IDS.team.b })
      .expect(201);
    expect(res.body.routing).toEqual({ routed: 0, moved: 2, kept: 0, teamAssigned: 2, teamCleared: 0 });
    for (const id of [P.defect.p3sel, P.defect.p4sel]) {
      expect(await owner(id)).toEqual({ maintenanceOrganizationId: IDS.org.b, assignedToTeamId: IDS.team.b, lifecycleStatus: 'ASSIGNED' });
    }
    expect(await owner(P.defect.p2sel)).toMatchObject({ maintenanceOrganizationId: IDS.org.a, assignedToTeamId: IDS.team.a });

    const board = await http(app, token.foreman).get('/api/v1/maintenance-packages/board').expect(200);
    const row = board.body.pencawangs.find((pe: { siteVisitId: string }) => pe.siteVisitId === P.visit);
    expect(row.poleSplits).toEqual([
      { category: null, organization: { id: IDS.org.b, name: 'Company B' }, team: { id: IDS.team.b, name: 'Team B' }, poles: 2 },
    ]);
  });

  // TNB feedback #4 (2026-10-10): a wrong team comes off split poles too.
  it('taking Team B off poles 3–4 leaves them with Company B, no team', async () => {
    const res = await http(app, token.foreman)
      .post(base)
      .send({ assetIds: [POLE3, POLE4], maintenanceOrganizationId: IDS.org.b })
      .expect(201);
    expect(res.body.routing).toEqual({ routed: 0, moved: 0, kept: 0, teamAssigned: 0, teamCleared: 2 });
    for (const id of [P.defect.p3sel, P.defect.p4sel]) {
      expect(await owner(id)).toEqual({ maintenanceOrganizationId: IDS.org.b, assignedToTeamId: null, lifecycleStatus: 'VERIFIED' });
    }
    // Poles 1–2 still follow the PE package and keep Team A.
    expect(await owner(P.defect.p2sel)).toMatchObject({ assignedToTeamId: IDS.team.a });

    // Back to Team B for the cases below.
    await http(app, token.foreman).post(base).send({ assetIds: [POLE3, POLE4], assignedTeamId: IDS.team.b }).expect(201);
  });

  it('one work type of a pole can go elsewhere (Rentis of pole 1 → subcontractor team)', async () => {
    await http(app, token.foreman)
      .post(base)
      .send({ assetIds: [POLE1], category: 'RENTIS', assignedTeamId: IDS.sub.team })
      .expect(201);
    expect(await owner(P.defect.p1ren)).toMatchObject({ maintenanceOrganizationId: IDS.sub.org, assignedToTeamId: IDS.sub.team });
    expect(await owner(P.defect.p1sel)).toMatchObject({ maintenanceOrganizationId: IDS.org.a, assignedToTeamId: IDS.team.a });
  });

  it('a Main Contractor holding only split poles sees the PE and acts only on its poles', async () => {
    const board = await http(app, token.mgrB).get('/api/v1/maintenance-packages/board').expect(200);
    expect(board.body.pencawangs.map((pe: { siteVisitId: string }) => pe.siteVisitId)).toContain(P.visit);

    const poles = await http(app, token.mgrB).get(base).expect(200);
    const can = Object.fromEntries(
      poles.body.poles.map((pole: { assetId: string; canAssign: boolean }) => [pole.assetId, pole.canAssign]),
    );
    expect(can).toEqual({ [POLE1]: false, [POLE2]: false, [POLE3]: true, [POLE4]: true });

    await http(app, token.mgrB).post(base).send({ assetIds: [POLE2], assignedTeamId: IDS.team.b }).expect(403);
    await http(app, token.mgrB).post(base).send({ assetIds: [POLE3], assignedTeamId: IDS.team.a }).expect(403);
    // Returning pole 4 would hand it to Company A (the PE owner) — not B's call.
    await http(app, token.mgrB).post(`${base}/clear`).send({ assetIds: [POLE4] }).expect(403);
  });

  it('a PE-level reassign moves the rest; split poles keep their team', async () => {
    const res = await http(app, token.foreman)
      .post('/api/v1/maintenance-packages')
      .send({ siteVisitId: P.visit, maintenanceOrganizationId: IDS.org.maint })
      .expect(201);
    expect(res.body.routing).toMatchObject({ moved: 2 });
    expect(await owner(P.defect.p1sel)).toMatchObject({ maintenanceOrganizationId: IDS.org.maint, assignedToTeamId: null });
    expect(await owner(P.defect.p2sel)).toMatchObject({ maintenanceOrganizationId: IDS.org.maint });
    expect(await owner(P.defect.p1ren)).toMatchObject({ maintenanceOrganizationId: IDS.sub.org, assignedToTeamId: IDS.sub.team });
    expect(await owner(P.defect.p3sel)).toMatchObject({ maintenanceOrganizationId: IDS.org.b, assignedToTeamId: IDS.team.b });
  });

  it('work already photographed stays with its crew when its pole is split off', async () => {
    await prisma.defectEvidenceImage.create({
      data: { defectId: P.defect.p2sel, evidenceType: 'BEFORE', fileName: 'b.jpg', storageKey: 'k/b.jpg' },
    });
    const res = await http(app, token.foreman)
      .post(base)
      .send({ assetIds: [POLE2], assignedTeamId: IDS.team.b })
      .expect(201);
    expect(res.body.routing).toEqual({ routed: 0, moved: 0, kept: 1, teamAssigned: 0, teamCleared: 0 });
    expect(await owner(P.defect.p2sel)).toMatchObject({ maintenanceOrganizationId: IDS.org.maint });
  });

  it('clear returns poles to the Pencawang owner', async () => {
    const res = await http(app, token.foreman)
      .post(`${base}/clear`)
      .send({ assetIds: [POLE3, POLE1] })
      .expect(201);
    expect(res.body.routing.moved).toBe(2);
    expect(await owner(P.defect.p3sel)).toMatchObject({ maintenanceOrganizationId: IDS.org.maint, assignedToTeamId: null, lifecycleStatus: 'VERIFIED' });
    expect(await owner(P.defect.p1ren)).toMatchObject({ maintenanceOrganizationId: IDS.org.maint });
    expect(await owner(P.defect.p4sel)).toMatchObject({ maintenanceOrganizationId: IDS.org.b });

    const rows = await prisma.maintenancePoleAssignment.findMany({
      where: { siteVisitId: P.visit },
      select: { assetId: true },
    });
    expect(rows.map((row) => row.assetId).sort()).toEqual([POLE2, POLE4].sort());
  });

  it('crews of the split team see the PE with only their poles', async () => {
    const tokenB = await login(app, EMAILS.techB);
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: IDS.team.b, userId: IDS.user.techB } },
      update: { isActive: true },
      create: { teamId: IDS.team.b, userId: IDS.user.techB },
    });
    const res = await http(app, tokenB).get(`/api/v1/maintenance-work/${P.visit}`).expect(200);
    const poleIds = JSON.stringify(res.body);
    expect(poleIds).toContain(POLE4);
    expect(poleIds).not.toContain(POLE1);
  });
});

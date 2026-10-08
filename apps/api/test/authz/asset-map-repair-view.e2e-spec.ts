import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Asset Map repair view (2026-10-08) — a maintenance company surveyed nothing,
 * so the survey-based map showed it nothing. Its Manager / Supervisor now sees
 * every pole of each Pencawang carrying work routed to its company: its own
 * poles carry a `repair` tally (to do / in progress / awaiting / closed), the
 * rest `repair: null` (grey, route context). Survey answers stay read-only for
 * poles it only reaches through repair work (`surveyAccess: false`).
 *
 * Fixture: Company A surveys a PE; TNB (admin here) gives Rentis → subcontractor
 * S, Selenggaraan → Company B.
 */
const P = {
  sub: '30000000-0000-4000-8000-0000000c1601',
  visit: '60000000-0000-4000-8000-0000000c1601',
  asset: ['70000000-0000-4000-8000-0000000c1601', '70000000-0000-4000-8000-0000000c1602'],
  inspection: ['80000000-0000-4000-8000-0000000c1601', '80000000-0000-4000-8000-0000000c1602'],
  item: ['90000000-0000-4000-8000-0000000c1601', '90000000-0000-4000-8000-0000000c1602'],
  defect: {
    rentis: 'a0000000-0000-4000-8000-0000000c1601',
    sel: 'a0000000-0000-4000-8000-0000000c1602',
  },
};
const ALL_DEFECTS = Object.values(P.defect);

type MapPole = {
  id: string;
  repair?: { total: number; todo: number; closed: number; categories: string[] } | null;
  surveyAccess?: boolean;
};
type Bubble = { id: string; repair?: { poles: number; total: number; done: number } };

describe('Authz · Asset Map repair view (maintenance company)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  const points = async (who: string, extra = '') => {
    const res = await http(app, token[who])
      .get(`/api/v1/assets/map?level=points&pencawangId=${P.sub}${extra}`)
      .expect(200);
    return (res.body as { poles: MapPole[] }).poles;
  };
  const pole = (poles: MapPole[], index: number) => poles.find((row) => row.id === P.asset[index]);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const t = IDS.tenant.t1;

    await prisma.substation.create({
      data: { id: P.sub, tenantId: t, name: 'Repair Map PE', code: 'RM-1', latitude: 3.8, longitude: 103.3 },
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
        assetCode: `RM-POLE-${index + 1}`,
        substationId: P.sub,
        assetTypeId: IDS.assetType.savr,
        latitude: 3.8 + index * 0.001,
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
    await prisma.inspectionItemResult.createMany({
      data: P.item.map((id, index) => ({
        id,
        inspectionId: P.inspection[index],
        label: index === 0 ? 'Rentis' : 'Selenggaraan',
        result: 'FAIL' as const,
        isDefect: true,
        severity: 'MEDIUM' as const,
      })),
    });
    await prisma.defect.createMany({
      data: [
        { id: P.defect.rentis, inspectionItemResultId: P.item[0], status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED', maintenanceCategory: 'RENTIS' },
        { id: P.defect.sel, inspectionItemResultId: P.item[1], status: 'OPEN', severity: 'MEDIUM', lifecycleStatus: 'VERIFIED', maintenanceCategory: 'SELENGGARAAN' },
      ],
    });

    token.admin = await login(app, EMAILS.adminT1);
    token.subMgr = await login(app, EMAILS.subMgr);
    token.mgrA = await login(app, EMAILS.mgrA);
    token.mgrB = await login(app, EMAILS.mgrB);
    token.techA = await login(app, EMAILS.techA);

    await http(app, token.admin)
      .post('/api/v1/maintenance-packages')
      .send({ siteVisitId: P.visit, category: 'RENTIS', maintenanceOrganizationId: IDS.sub.org })
      .expect(201);
    await http(app, token.admin)
      .post('/api/v1/maintenance-packages')
      .send({ siteVisitId: P.visit, category: 'SELENGGARAAN', maintenanceOrganizationId: IDS.org.b })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.maintenancePackage.deleteMany({ where: { siteVisitId: P.visit } });
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: ALL_DEFECTS } } });
    await prisma.defect.deleteMany({ where: { id: { in: ALL_DEFECTS } } });
    await prisma.inspectionItemResult.deleteMany({ where: { id: { in: P.item } } });
    await prisma.inspection.deleteMany({ where: { id: { in: P.inspection } } });
    await prisma.siteVisit.deleteMany({ where: { id: P.visit } });
    await prisma.asset.deleteMany({ where: { id: { in: P.asset } } });
    await prisma.substation.deleteMany({ where: { id: P.sub } });
    await app?.close();
  });

  it('a subcontractor manager sees the whole PE, its own Rentis pole tallied, the other grey', async () => {
    const options = await http(app, token.subMgr).get('/api/v1/assets/map/filter-options').expect(200);
    expect(options.body.repairView).toBe(true);
    expect(options.body.pencawang.map((row: { id: string }) => row.id)).toContain(P.sub);

    const poles = await points('subMgr');
    expect(poles.map((row) => row.id).sort()).toEqual([...P.asset].sort());
    expect(pole(poles, 0)).toMatchObject({
      repair: { total: 1, todo: 1, closed: 0, categories: ['RENTIS'] },
      surveyAccess: false,
    });
    expect(pole(poles, 1)).toMatchObject({ repair: null, surveyAccess: false });
  });

  it('bubbles carry the company’s own Kejanggalan tally', async () => {
    const res = await http(app, token.subMgr).get('/api/v1/assets/map?level=pencawang').expect(200);
    const bubble = (res.body as Bubble[]).find((row) => row.id === P.sub);
    expect(bubble?.repair).toEqual({ poles: 1, total: 1, done: 0, emergency: 0 });
  });

  it('another maintenance company sees only its own lane as its work', async () => {
    const poles = await points('mgrB');
    expect(pole(poles, 0)?.repair).toBeNull();
    expect(pole(poles, 1)?.repair).toMatchObject({ total: 1, categories: ['SELENGGARAAN'] });
  });

  it('the surveying main contractor keeps survey access (and oversees its subcontractor’s repairs)', async () => {
    const poles = await points('mgrA');
    expect(pole(poles, 0)).toMatchObject({ surveyAccess: true, repair: { total: 1 } });
    expect(pole(poles, 1)).toMatchObject({ surveyAccess: true, repair: null });
  });

  it('admin and technicians get the plain map (no repair fields)', async () => {
    const admin = await points('admin');
    expect(pole(admin, 0)).not.toHaveProperty('repair');
    const options = await http(app, token.admin).get('/api/v1/assets/map/filter-options').expect(200);
    expect(options.body.repairView).toBe(false);
    const tech = await http(app, token.techA).get('/api/v1/assets/map/filter-options').expect(200);
    expect(tech.body.repairView).toBe(false);
  });

  it('pole repairs: own Kejanggalan only', async () => {
    const own = await http(app, token.subMgr).get(`/api/v1/assets/${P.asset[0]}/repairs`).expect(200);
    expect(own.body).toEqual([
      expect.objectContaining({ id: P.defect.rentis, category: 'RENTIS', stage: 'todo', photos: [] }),
    ]);
    const other = await http(app, token.subMgr).get(`/api/v1/assets/${P.asset[1]}/repairs`).expect(200);
    expect(other.body).toEqual([]);
    const admin = await http(app, token.admin).get(`/api/v1/assets/${P.asset[1]}/repairs`).expect(200);
    expect(admin.body).toHaveLength(1);
  });

  it('a work-type filter keeps the company’s finished work on its map', async () => {
    await prisma.defect.update({
      where: { id: P.defect.rentis },
      data: { lifecycleStatus: 'CLOSED', status: 'CLOSED' },
    });
    const rentis = await points('subMgr', '&categories=RENTIS');
    expect(rentis.map((row) => row.id)).toEqual([P.asset[0]]);
    expect(pole(rentis, 0)?.repair).toMatchObject({ total: 1, closed: 1, todo: 0 });

    // A finished Rentis is no OPEN defect, so the plain map drops it.
    const admin = await points('admin', '&categories=RENTIS');
    expect(admin).toHaveLength(0);
  });
});

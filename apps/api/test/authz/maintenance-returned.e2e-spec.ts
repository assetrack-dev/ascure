import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Repair Verification "Returned" tab (TNB ask, 2026-11-16): a repair TNB sent
 * back used to drop off the page (it goes back to IN_PROGRESS). The tab lists
 * every routed Kejanggalan returned at least once, with the latest return's
 * reason / who / when and where it stands now:
 *   WITH_CONTRACTOR (default) · RESUBMITTED · CLOSED · ALL.
 * Same scope as the other tabs.
 *
 * Self-contained: builds and removes its own TNB org / Mainhead / PE chain.
 */
const C = {
  tnb: '0e000000-0000-4000-8000-0000000000e6',
  foreman: '10000000-0000-4000-8000-0000000000e6',
  region: 'd0000000-0000-4000-8000-0000000000e6',
  mh: 'e0000000-0000-4000-8000-0000000000e6',
  sub: '30000000-0000-4000-8000-0000000000e6',
  visit: '60000000-0000-4000-8000-0000000000e6',
  asset: '70000000-0000-4000-8000-0000000000e6',
  inspection: '80000000-0000-4000-8000-0000000000e6',
  email: { foreman: 'returned.foreman@authz.test' },
};

const KEYS = ['back', 'resubmit', 'closed', 'never'] as const;
type Key = (typeof KEYS)[number];
const itemId = (key: Key) => `90000000-0000-4000-8000-0000000000e${KEYS.indexOf(key) + 6}`;
const defectId = (key: Key) => `a0000000-0000-4000-8000-0000000000e${KEYS.indexOf(key) + 6}`;

type Item = {
  id: string;
  returnState: string | null;
  lastReturn: { reason: string | null; kind: string; count: number; by: { name: string } | null; at: string } | null;
  team: { id: string } | null;
};

describe('Authz · repair verification Returned tab', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};
  const base = '/api/v1/maintenance-verification';
  const ids = (items: Item[]) => items.map((item) => item.id).sort();

  /** What the crew's re-completion leaves (the gate itself is covered elsewhere). */
  const resubmit = (key: Key) =>
    prisma.defect.update({
      where: { id: defectId(key) },
      data: { lifecycleStatus: 'COMPLETED', status: 'RESOLVED', resolutionOutcome: 'RESOLVED', maintainedAt: new Date() },
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
      data: { id: C.tnb, tenantId: t, name: 'TNB (returned spec)', type: 'TNB', isActive: true },
    });
    await prisma.user.create({
      data: { id: C.foreman, tenantId: t, email: C.email.foreman, name: 'TNB Foreman R', passwordHash, role: 'CLIENT', clientRank: 'FOREMAN', organizationId: C.tnb },
    });
    await prisma.operationalRegion.create({
      data: { id: C.region, tenantId: t, name: 'Returned Region', code: 'RTN', isActive: true },
    });
    await prisma.mainhead.create({
      data: { id: C.mh, name: 'RETURNED MH', isActive: true, operationalRegionId: C.region },
    });
    await prisma.organizationMainhead.create({
      data: { organizationId: C.tnb, mainheadId: C.mh, isActive: true },
    });
    await prisma.substation.create({
      data: { id: C.sub, tenantId: t, name: 'Returned Pencawang', code: 'RT-6', mainheadId: C.mh },
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
      data: { id: C.asset, tenantId: t, assetCode: 'RT-POLE-6', substationId: C.sub, assetTypeId: IDS.assetType.savr },
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
      data: KEYS.map((key) => ({
        id: itemId(key),
        inspectionId: C.inspection,
        label: `Kejanggalan ${key}`,
        result: 'FAIL' as const,
        isDefect: true,
        severity: 'MEDIUM' as const,
      })),
    });
    const now = new Date();
    await prisma.defect.createMany({
      data: KEYS.map((key) => ({
        id: defectId(key),
        inspectionItemResultId: itemId(key),
        severity: 'MEDIUM' as const,
        status: 'RESOLVED' as const,
        lifecycleStatus: 'COMPLETED' as const,
        resolutionOutcome: 'RESOLVED' as const,
        maintenanceOrganizationId: IDS.org.a,
        assignedToTeamId: IDS.team.a,
        maintainedAt: now,
        resolvedAt: now,
      })),
    });

    token.foreman = await login(app, C.email.foreman);
    token.mgrA = await login(app, EMAILS.mgrA);
    token.mgrB = await login(app, EMAILS.mgrB);
  });

  afterAll(async () => {
    const all = KEYS.map(defectId);
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: all } } });
    await prisma.defect.deleteMany({ where: { id: { in: all } } });
    await prisma.inspectionItemResult.deleteMany({ where: { inspectionId: C.inspection } });
    await prisma.inspection.deleteMany({ where: { id: C.inspection } });
    await prisma.siteVisit.deleteMany({ where: { id: C.visit } });
    await prisma.asset.deleteMany({ where: { id: C.asset } });
    await prisma.substation.deleteMany({ where: { id: C.sub } });
    await prisma.organizationMainhead.deleteMany({ where: { organizationId: C.tnb } });
    await prisma.mainhead.deleteMany({ where: { id: C.mh } });
    await prisma.operationalRegion.deleteMany({ where: { id: C.region } });
    await prisma.user.deleteMany({ where: { id: C.foreman } });
    await prisma.organization.deleteMany({ where: { id: C.tnb } });
    await app?.close();
  });

  it('nothing is returned yet', async () => {
    const res = await http(app, token.foreman).get(`${base}?tab=RETURNED`).expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.counts).toEqual({ pending: 4, cannotRepair: 0, returned: 0 });
    expect(res.body.returnedState).toBe('WITH_CONTRACTOR');
  });

  it('TNB returns three repairs; one is re-submitted, one re-submitted and verified', async () => {
    for (const key of ['back', 'resubmit', 'closed'] as const) {
      await http(app, token.foreman)
        .post(`${base}/${defectId(key)}/reject`)
        .send({ reason: `Fix ${key} again` })
        .expect(201);
    }
    await resubmit('resubmit');
    await resubmit('closed');
    await http(app, token.foreman).post(`${base}/${defectId('closed')}/verify`).send({}).expect(201);
  });

  it('default chip = still with the contractor, with reason / who / when / team', async () => {
    const res = await http(app, token.foreman).get(`${base}?tab=RETURNED`).expect(200);
    const items = res.body.items as Item[];
    expect(ids(items)).toEqual([defectId('back')]);
    expect(items[0]).toMatchObject({
      returnState: 'WITH_CONTRACTOR',
      team: { id: IDS.team.a },
      lastReturn: { reason: 'Fix back again', kind: 'SENT_BACK', count: 1, by: { name: 'TNB Foreman R' } },
    });
    expect(Number.isNaN(Date.parse(items[0].lastReturn!.at))).toBe(false);
    expect(res.body.counts).toMatchObject({ returned: 1 });
    expect(res.body.returnedStates).toEqual({ WITH_CONTRACTOR: 1, RESUBMITTED: 1, CLOSED: 1 });
  });

  it('state chips: re-submitted, closed, all', async () => {
    const get = (state: string) =>
      http(app, token.foreman).get(`${base}?tab=RETURNED&returnedState=${state}`).expect(200);
    expect(ids((await get('RESUBMITTED')).body.items)).toEqual([defectId('resubmit')]);
    expect(ids((await get('CLOSED')).body.items)).toEqual([defectId('closed')]);
    const all = (await get('ALL')).body.items as Item[];
    expect(ids(all)).toEqual([defectId('back'), defectId('resubmit'), defectId('closed')].sort());
    expect(Object.fromEntries(all.map((item) => [item.id, item.returnState]))).toEqual({
      [defectId('back')]: 'WITH_CONTRACTOR',
      [defectId('resubmit')]: 'RESUBMITTED',
      [defectId('closed')]: 'CLOSED',
    });
  });

  it('Pending still holds the re-submitted repair, flagged with its earlier return', async () => {
    const res = await http(app, token.foreman).get(base).expect(200);
    const items = res.body.items as Item[];
    expect(ids(items)).toEqual([defectId('never'), defectId('resubmit')].sort());
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    expect(byId[defectId('resubmit')].lastReturn).toMatchObject({ reason: 'Fix resubmit again' });
    expect(byId[defectId('never')].lastReturn).toBeNull();
    expect(byId[defectId('never')].returnState).toBeNull();
  });

  it('groups: returned per Pencawang + company, per chip and date range', async () => {
    const one = await http(app, token.foreman).get(`${base}/groups?tab=RETURNED`).expect(200);
    expect(one.body.totalGroups).toBe(1);
    expect(one.body.groups[0]).toMatchObject({ siteVisitId: C.visit, company: { id: IDS.org.a }, count: 1 });
    expect(one.body.returnedStates).toEqual({ WITH_CONTRACTOR: 1, RESUBMITTED: 1, CLOSED: 1 });

    const all = await http(app, token.foreman).get(`${base}/groups?tab=RETURNED&returnedState=ALL`).expect(200);
    expect(all.body.groups[0].count).toBe(3);

    const old = await http(app, token.foreman)
      .get(`${base}/groups?tab=RETURNED&returnedState=ALL&from=2000-01-01&to=2000-01-02`)
      .expect(200);
    expect(old.body.totalGroups).toBe(0);
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const hit = await http(app, token.foreman)
      .get(`${base}/groups?tab=RETURNED&returnedState=ALL&from=${today}&to=${today}`)
      .expect(200);
    expect(hit.body.groups[0].count).toBe(3);
  });

  it('scope: the main contractor sees its returns, another company sees none', async () => {
    const own = await http(app, token.mgrA).get(`${base}?tab=RETURNED&siteVisitId=${C.visit}`).expect(200);
    expect(ids(own.body.items)).toEqual([defectId('back')]);
    const other = await http(app, token.mgrB).get(`${base}?tab=RETURNED&returnedState=ALL`).expect(200);
    expect((other.body.items as Item[]).filter((item) => KEYS.map(defectId).includes(item.id))).toEqual([]);
  });

  it('an unknown chip is refused (400)', () =>
    http(app, token.foreman).get(`${base}?tab=RETURNED&returnedState=NOPE`).expect(400));
});

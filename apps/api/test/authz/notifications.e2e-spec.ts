import { INestApplication } from '@nestjs/common';
import { rm } from 'fs/promises';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';
import { buildDefectEvidenceImagesDirectory } from '../../src/common/uploads.constants';

/**
 * Console 🔔 + Web Push (docs/PLAN-maintenance-flow.md §19, N56).
 *
 *  1. A routed repair submitted for verification notifies the company's TNB
 *     Supervisors (TNB org owning the survey's Mainhead); with no Supervisor for
 *     that company, the Mainhead's TNB Foreman / Technician instead.
 *  2. One bell row per Pencawang + company: further submissions bump `count`.
 *  3. Re-submitting an already-submitted repair (offline replay / outcome edit)
 *     never notifies again.
 *  4. Read / read-all are per user; another user's row is 404.
 *  5. Push endpoints: config (off without VAPID keys), https-only subscribe,
 *     unsubscribe.
 *  6. The deep link's Pencawang filter narrows Repair Verification groups.
 */
const N = {
  tnb: '0e000000-0000-4000-8000-000000000051',
  supervisor: '10000000-0000-4000-8000-000000000051',
  foreman: '10000000-0000-4000-8000-000000000052',
  region: 'd0000000-0000-4000-8000-000000000051',
  mh: 'e0000000-0000-4000-8000-000000000051',
  sub: '30000000-0000-4000-8000-000000000051',
  visit: '60000000-0000-4000-8000-000000000051',
  asset: '70000000-0000-4000-8000-000000000051',
  inspection: '80000000-0000-4000-8000-000000000051',
  email: { supervisor: 'notif.supervisor@authz.test', foreman: 'notif.foreman@authz.test' },
};
const CASES = ['a1', 'a2', 'a3', 'b1'] as const;
type Case = (typeof CASES)[number];
const itemId = (key: Case) => `90000000-0000-4000-8000-00000000005${CASES.indexOf(key) + 1}`;
const defectId = (key: Case) => `a0000000-0000-4000-8000-00000000005${CASES.indexOf(key) + 1}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

type Bell = {
  unread: number;
  items: Array<{ id: string; title: string; body: string; url: string; count: number; readAt: string | null }>;
};

describe('Notifications · repairs submitted → TNB 🔔', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  const crewFor = (key: Case) => (key === 'b1' ? 'techB' : 'techA');
  const submit = async (key: Case, body: Record<string, unknown> = {}) => {
    const crew = token[crewFor(key)];
    for (const evidenceType of ['BEFORE', 'AFTER']) {
      await http(app, crew)
        .post(`/api/v1/defects/${defectId(key)}/evidence-images`)
        .attach('file', JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' })
        .field('evidenceType', evidenceType)
        .expect(201);
    }
    await http(app, crew)
      .patch(`/api/v1/defects/${defectId(key)}/maintenance-completion`)
      .send(body)
      .expect(200);
  };
  const bell = async (who: string) =>
    (await http(app, token[who]).get('/api/v1/notifications').expect(200)).body as Bell;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const { passwordHash } = await prisma.user.findUniqueOrThrow({
      where: { id: IDS.user.mgrA },
      select: { passwordHash: true },
    });
    const t = IDS.tenant.t1;

    await prisma.organization.create({
      data: { id: N.tnb, tenantId: t, name: 'TNB (notifications spec)', type: 'TNB', isActive: true },
    });
    await prisma.user.createMany({
      data: [
        { id: N.supervisor, tenantId: t, email: N.email.supervisor, name: 'Notif Supervisor', passwordHash, role: 'CLIENT', clientRank: 'SUPERVISOR', organizationId: N.tnb },
        { id: N.foreman, tenantId: t, email: N.email.foreman, name: 'Notif Foreman', passwordHash, role: 'CLIENT', clientRank: 'FOREMAN', organizationId: N.tnb },
      ],
    });
    // The Supervisor handles Company A only — Company B falls back to the Foreman.
    await prisma.clientCompanyAccess.create({ data: { userId: N.supervisor, organizationId: IDS.org.a } });
    await prisma.operationalRegion.create({
      data: { id: N.region, tenantId: t, name: 'Notif Region', code: 'NTF', isActive: true },
    });
    await prisma.mainhead.create({
      data: { id: N.mh, name: 'NOTIF MH', isActive: true, operationalRegionId: N.region },
    });
    await prisma.organizationMainhead.create({
      data: { organizationId: N.tnb, mainheadId: N.mh, isActive: true },
    });
    await prisma.substation.create({
      data: { id: N.sub, tenantId: t, name: 'Notif Pencawang', code: 'NTF-1', mainheadId: N.mh },
    });
    await prisma.siteVisit.create({
      data: {
        id: N.visit,
        tenantId: t,
        teamId: IDS.team.a,
        createdByUserId: IDS.user.mgrA,
        organizationId: IDS.org.a,
        status: 'ACTIVE',
        substationId: N.sub,
        mainheadId: N.mh,
        lifecycleStatus: 'LAPORAN_SELESAI',
      },
    });
    await prisma.asset.create({
      data: { id: N.asset, tenantId: t, assetCode: 'NTF-POLE-1', substationId: N.sub, assetTypeId: IDS.assetType.savr },
    });
    await prisma.inspection.create({
      data: {
        id: N.inspection,
        tenantId: t,
        assetId: N.asset,
        siteVisitId: N.visit,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
    await prisma.inspectionItemResult.createMany({
      data: CASES.map((key) => ({
        id: itemId(key),
        inspectionId: N.inspection,
        label: `Notif ${key}`,
        result: 'FAIL' as const,
        isDefect: true,
        severity: 'MEDIUM' as const,
      })),
    });
    await prisma.defect.createMany({
      data: CASES.map((key) => ({
        id: defectId(key),
        inspectionItemResultId: itemId(key),
        severity: 'MEDIUM' as const,
        status: 'OPEN' as const,
        lifecycleStatus: 'ASSIGNED' as const,
        maintenanceCategory: 'SELENGGARAAN' as const,
        assignedToTeamId: key === 'b1' ? IDS.team.b : IDS.team.a,
        maintenanceOrganizationId: key === 'b1' ? IDS.org.b : IDS.org.a,
      })),
    });

    token.techA = await login(app, EMAILS.techA);
    token.techB = await login(app, EMAILS.techB);
    token.supervisor = await login(app, N.email.supervisor);
    token.foreman = await login(app, N.email.foreman);
  });

  afterAll(async () => {
    const ids = CASES.map(defectId);
    await prisma.notification.deleteMany({ where: { userId: { in: [N.supervisor, N.foreman] } } });
    await prisma.pushSubscription.deleteMany({ where: { userId: { in: [N.supervisor, N.foreman] } } });
    await prisma.defectEvidenceImage.deleteMany({ where: { defectId: { in: ids } } });
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: ids } } });
    await prisma.defect.deleteMany({ where: { id: { in: ids } } });
    await prisma.inspectionItemResult.deleteMany({ where: { inspectionId: N.inspection } });
    await prisma.inspection.deleteMany({ where: { id: N.inspection } });
    await prisma.siteVisit.deleteMany({ where: { id: N.visit } });
    await prisma.asset.deleteMany({ where: { id: N.asset } });
    await prisma.substation.deleteMany({ where: { id: N.sub } });
    await prisma.organizationMainhead.deleteMany({ where: { organizationId: N.tnb } });
    await prisma.mainhead.deleteMany({ where: { id: N.mh } });
    await prisma.operationalRegion.deleteMany({ where: { id: N.region } });
    await prisma.clientCompanyAccess.deleteMany({ where: { userId: N.supervisor } });
    await prisma.user.deleteMany({ where: { id: { in: [N.supervisor, N.foreman] } } });
    await prisma.organization.deleteMany({ where: { id: N.tnb } });
    await Promise.all(
      ids.map((id) => rm(buildDefectEvidenceImagesDirectory(id), { recursive: true, force: true })),
    );
    await app?.close();
  });

  it('starts empty', async () => {
    expect(await bell('supervisor')).toEqual({ unread: 0, items: [] });
  });

  it("Company A's repair → its Supervisor is told (not the Foreman), with a deep link", async () => {
    await submit('a1');
    const sup = await bell('supervisor');
    expect(sup.unread).toBe(1);
    expect(sup.items).toHaveLength(1);
    expect(sup.items[0]).toMatchObject({ count: 1, readAt: null, body: 'Notif Pencawang · waiting for verification' });
    expect(sup.items[0].title).toMatch(/submitted 1 repair$/);
    expect(sup.items[0].url).toBe(
      `/maintenance-verification?siteVisitId=${N.visit}&organizationId=${IDS.org.a}`,
    );
    expect((await bell('foreman')).items).toHaveLength(0);
  });

  it('more repairs at the same Pencawang fold into the same row', async () => {
    await submit('a2');
    const sup = await bell('supervisor');
    expect(sup.items).toHaveLength(1);
    expect(sup.items[0].count).toBe(2);
    expect(sup.items[0].title).toMatch(/submitted 2 repairs$/);
  });

  it('re-submitting an already-submitted repair does not notify again', async () => {
    await http(app, token.techA)
      .patch(`/api/v1/defects/${defectId('a1')}/maintenance-completion`)
      .send({ resolutionOutcome: 'TEMPORARY_FIX' })
      .expect(200);
    expect((await bell('supervisor')).items[0].count).toBe(2);
  });

  it('mark read, then a new repair re-opens the row as unread', async () => {
    const { items } = await bell('supervisor');
    const read = await http(app, token.supervisor)
      .post(`/api/v1/notifications/${items[0].id}/read`)
      .expect(200);
    expect(read.body).toEqual({ unread: 0 });
    // Another user cannot touch it.
    await http(app, token.foreman).post(`/api/v1/notifications/${items[0].id}/read`).expect(404);

    await submit('a3');
    const sup = await bell('supervisor');
    expect(sup).toMatchObject({ unread: 1 });
    expect(sup.items[0]).toMatchObject({ count: 3, readAt: null });
    const count = await http(app, token.supervisor).get('/api/v1/notifications/unread-count').expect(200);
    expect(count.body).toEqual({ unread: 1 });
  });

  it('a company with no Supervisor falls back to the Mainhead Foreman', async () => {
    await submit('b1');
    const foreman = await bell('foreman');
    expect(foreman.items).toHaveLength(1);
    expect(foreman.items[0].url).toContain(`organizationId=${IDS.org.b}`);
    // The Supervisor does not handle Company B.
    expect((await bell('supervisor')).items).toHaveLength(1);
  });

  it('read-all clears the count', async () => {
    await http(app, token.foreman).post('/api/v1/notifications/read-all').expect(200);
    expect((await bell('foreman')).unread).toBe(0);
  });

  it('push: off without VAPID keys; https-only subscribe; unsubscribe', async () => {
    const config = await http(app, token.supervisor).get('/api/v1/notifications/push/config').expect(200);
    expect(config.body).toEqual({ enabled: false, publicKey: null });

    const keys = { p256dh: 'BPub-key', auth: 'auth-secret' };
    await http(app, token.supervisor)
      .post('/api/v1/notifications/push/subscribe')
      .send({ endpoint: 'http://push.example.com/abc', keys })
      .expect(400);
    const endpoint = 'https://fcm.googleapis.com/fcm/send/notif-spec';
    await http(app, token.supervisor)
      .post('/api/v1/notifications/push/subscribe')
      .send({ endpoint, keys, userAgent: 'jest' })
      .expect(200);
    // The same device signing in as someone else moves the subscription.
    await http(app, token.foreman)
      .post('/api/v1/notifications/push/subscribe')
      .send({ endpoint, keys })
      .expect(200);
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    expect(row.userId).toBe(N.foreman);
    await http(app, token.foreman).post('/api/v1/notifications/push/unsubscribe').send({ endpoint }).expect(200);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
  });

  it("the deep link's Pencawang filter narrows Repair Verification groups", async () => {
    const res = await http(app, token.supervisor)
      .get(`/api/v1/maintenance-verification/groups?siteVisitId=${N.visit}&organizationId=${IDS.org.a}`)
      .expect(200);
    expect(res.body.totalGroups).toBe(1);
    expect(res.body.groups[0]).toMatchObject({ siteVisitId: N.visit, company: { id: IDS.org.a } });
    const other = await http(app, token.supervisor)
      .get(`/api/v1/maintenance-verification/groups?siteVisitId=${IDS.visit.a}`)
      .expect(200);
    expect(other.body.totalGroups).toBe(0);
  });
});

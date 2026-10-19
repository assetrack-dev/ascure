import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * "My tasks" (docs/PLAN-maintenance-flow.md §21.2 #4): every routed Kejanggalan
 * of the company, grouped by Pencawang + team, with a status derived from stored
 * data — to do · in progress · sent back (+ TNB's reason) · completed on site ·
 * cannot repair · verified. Sent-back work comes first.
 *
 * Scope: MANAGER / SUPERVISOR = the company; TECHNICIAN = own team; another
 * company sees nothing; VIEWER / TNB are refused; legacy (unrouted) work never shows.
 */
const K = {
  sub: '30000000-0000-4000-8000-000000000071',
  otherTeam: '20000000-0000-4000-8000-000000000071',
  visit: '60000000-0000-4000-8000-000000000071',
  asset: '70000000-0000-4000-8000-000000000071',
  inspection: '80000000-0000-4000-8000-000000000071',
  timeline: 'c0000000-0000-4000-8000-000000000071',
  photo: 'd0000000-0000-4000-8000-000000000071',
  // TNB (plan §21.2 #1–#2): an org owning the visit's Mainhead, a Foreman and a
  // Supervisor who handles company B only.
  region: 'e0000000-0000-4000-8000-000000000071',
  mainhead: 'e0000000-0000-4000-8000-000000000072',
  tnb: '0e000000-0000-4000-8000-000000000071',
  foreman: '10000000-0000-4000-8000-000000000071',
  supervisor: '10000000-0000-4000-8000-000000000072',
};
const TNB_EMAIL = { foreman: 'foreman.tasks@authz.test', supervisor: 'supervisor.tasks@authz.test' };
const STARTED_AT = new Date('2026-10-03T03:00:00Z');
const TARGET = new Date('2026-10-08T00:00:00Z');
const SEARCH = 'Tasks Pencawang';
const DONE_AT = new Date('2026-10-05T03:00:00Z');
const VERIFIED_AT = new Date('2026-10-12T03:00:00Z');

// [key, team, lifecycle, extra]
const ROWS = [
  ['todo', IDS.team.a, 'ASSIGNED', {}],
  ['inProgress', IDS.team.a, 'IN_PROGRESS', {}],
  ['sentBack', IDS.team.a, 'IN_PROGRESS', { maintainedAt: DONE_AT }],
  ['completed', IDS.team.a, 'COMPLETED', { maintainedAt: DONE_AT }],
  ['cannotRepair', K.otherTeam, 'COMPLETED', { maintainedAt: DONE_AT, resolutionOutcome: 'EXTERNAL_CONSTRAINT' }],
  ['verified', null, 'CLOSED', { status: 'CLOSED', maintainedAt: DONE_AT, closureVerifiedAt: VERIFIED_AT, closedAt: VERIFIED_AT }],
  ['legacy', IDS.team.a, 'ASSIGNED', { unrouted: true }],
] as const;
type Key = (typeof ROWS)[number][0];
const itemId = (key: Key) => `90000000-0000-4000-8000-00000000007${ROWS.findIndex((r) => r[0] === key) + 1}`;
const defectId = (key: Key) => `a0000000-0000-4000-8000-00000000007${ROWS.findIndex((r) => r[0] === key) + 1}`;

type Group = {
  siteVisitId: string;
  team: { id: string } | null;
  counts: Record<string, number>;
};

describe('Authz · maintenance tasks (My tasks)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  const groups = async (who: string, query = '') =>
    (
      await http(app, token[who])
        .get(`/api/v1/maintenance-tasks/groups?search=${encodeURIComponent(SEARCH)}${query}`)
        .expect(200)
    ).body as { groups: Group[]; counts: Record<string, number>; teams: Array<{ id: string }>; hasNoTeam: boolean };
  const items = async (who: string, query: string) =>
    (
      await http(app, token[who])
        .get(`/api/v1/maintenance-tasks/items?siteVisitId=${K.visit}${query}`)
        .expect(200)
    ).body as { items: Array<{ id: string; status: string; sentBack: { reason: string | null } | null }> };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const t = IDS.tenant.t1;

    await prisma.team.create({
      data: { id: K.otherTeam, tenantId: t, name: 'Tasks Team A2', code: 'TA2', organizationId: IDS.org.a },
    });
    await prisma.substation.create({ data: { id: K.sub, tenantId: t, name: SEARCH, code: 'TK-1' } });
    await prisma.siteVisit.create({
      data: {
        id: K.visit,
        tenantId: t,
        teamId: IDS.team.b,
        substationId: K.sub,
        createdByUserId: IDS.user.mgrB,
        organizationId: IDS.org.b,
        status: 'ACTIVE',
        lifecycleStatus: 'LAPORAN_SELESAI',
      },
    });
    await prisma.asset.create({
      data: { id: K.asset, tenantId: t, assetCode: 'TK-POLE-1', substationId: K.sub, assetTypeId: IDS.assetType.savr },
    });
    await prisma.inspection.create({
      data: {
        id: K.inspection,
        tenantId: t,
        assetId: K.asset,
        siteVisitId: K.visit,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techB,
        completionStatus: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
    await prisma.inspectionItemResult.createMany({
      data: ROWS.map(([key]) => ({
        id: itemId(key),
        inspectionId: K.inspection,
        label: `Task ${key}`,
        result: 'FAIL' as const,
        isDefect: true,
        severity: 'HIGH' as const,
      })),
    });
    for (const [key, team, lifecycle, extra] of ROWS) {
      const { unrouted, ...fields } = { unrouted: false, ...extra } as Record<string, unknown> & { unrouted: boolean };
      await prisma.defect.create({
        data: {
          id: defectId(key),
          inspectionItemResultId: itemId(key),
          severity: 'HIGH',
          status: 'OPEN',
          lifecycleStatus: lifecycle,
          assignedToTeamId: team,
          assignedAt: new Date('2026-10-01T03:00:00Z'),
          maintenanceOrganizationId: unrouted ? null : IDS.org.a,
          maintenanceCategory: 'RENTIS',
          ...fields,
        },
      });
    }
    // TNB sent it back with a reason the crew must act on.
    await prisma.defectTimelineEntry.create({
      data: {
        id: K.timeline,
        defectId: defectId('sentBack'),
        type: 'STATUS_CHANGED',
        fromLifecycleStatus: 'COMPLETED',
        toLifecycleStatus: 'IN_PROGRESS',
        comment: 'Repair rejected by TNB: Fix the stay wire',
        createdAt: new Date('2026-10-06T03:00:00Z'),
      },
    });

    // Overview (§21.2 #3): the first repair photo = started; the package's target
    // makes open work overdue.
    await prisma.defectEvidenceImage.create({
      data: {
        id: K.photo,
        defectId: defectId('inProgress'),
        evidenceType: 'BEFORE',
        fileName: 'before.jpg',
        storageKey: 'k',
        url: '/uploads/defects/x/before.jpg',
        createdAt: STARTED_AT,
      },
    });
    await prisma.maintenancePackage.create({
      data: { tenantId: t, siteVisitId: K.visit, maintenanceOrganizationId: IDS.org.a, dueDate: TARGET },
    });

    const { passwordHash } = await prisma.user.findUniqueOrThrow({
      where: { id: IDS.user.mgrA },
      select: { passwordHash: true },
    });
    await prisma.operationalRegion.create({
      data: { id: K.region, tenantId: t, name: 'Tasks Region', code: 'TKR', isActive: true },
    });
    await prisma.mainhead.create({
      data: { id: K.mainhead, name: 'TASKS MH', isActive: true, operationalRegionId: K.region },
    });
    await prisma.organization.create({
      data: { id: K.tnb, tenantId: t, name: 'TNB (tasks spec)', type: 'TNB', isActive: true },
    });
    await prisma.organizationMainhead.create({ data: { organizationId: K.tnb, mainheadId: K.mainhead, isActive: true } });
    await prisma.siteVisit.update({ where: { id: K.visit }, data: { mainheadId: K.mainhead } });
    await prisma.user.createMany({
      data: [
        { id: K.foreman, tenantId: t, email: TNB_EMAIL.foreman, name: 'TNB Foreman', passwordHash, role: 'CLIENT', clientRank: 'FOREMAN', organizationId: K.tnb },
        { id: K.supervisor, tenantId: t, email: TNB_EMAIL.supervisor, name: 'TNB Supervisor', passwordHash, role: 'CLIENT', clientRank: 'SUPERVISOR', organizationId: K.tnb },
      ],
    });
    await prisma.clientCompanyAccess.create({ data: { userId: K.supervisor, organizationId: IDS.org.b } });

    token.foreman = await login(app, TNB_EMAIL.foreman);
    token.supervisor = await login(app, TNB_EMAIL.supervisor);
    token.mgrA = await login(app, EMAILS.mgrA);
    token.supA = await login(app, EMAILS.supA);
    token.techA = await login(app, EMAILS.techA);
    token.viewerA = await login(app, EMAILS.viewerA);
    token.mgrB = await login(app, EMAILS.mgrB);
    token.admin = await login(app, EMAILS.adminT1);
  });

  afterAll(async () => {
    const ids = ROWS.map(([key]) => defectId(key));
    await prisma.maintenancePackage.deleteMany({ where: { siteVisitId: K.visit } });
    await prisma.defectEvidenceImage.deleteMany({ where: { id: K.photo } });
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: ids } } });
    await prisma.defect.deleteMany({ where: { id: { in: ids } } });
    await prisma.inspectionItemResult.deleteMany({ where: { inspectionId: K.inspection } });
    await prisma.inspection.deleteMany({ where: { id: K.inspection } });
    await prisma.siteVisit.deleteMany({ where: { id: K.visit } });
    await prisma.asset.deleteMany({ where: { id: K.asset } });
    await prisma.substation.deleteMany({ where: { id: K.sub } });
    await prisma.team.deleteMany({ where: { id: K.otherTeam } });
    await prisma.clientCompanyAccess.deleteMany({ where: { userId: K.supervisor } });
    await prisma.user.deleteMany({ where: { id: { in: [K.foreman, K.supervisor] } } });
    await prisma.organizationMainhead.deleteMany({ where: { organizationId: K.tnb } });
    await prisma.organization.deleteMany({ where: { id: K.tnb } });
    await prisma.mainhead.deleteMany({ where: { id: K.mainhead } });
    await prisma.operationalRegion.deleteMany({ where: { id: K.region } });
    await app?.close();
  });

  it('manager: one group per team, sent-back work first, legacy never shows', async () => {
    const body = await groups('mgrA');
    expect(body.counts).toEqual({
      TODO: 1,
      IN_PROGRESS: 1,
      SENT_BACK: 1,
      COMPLETED: 1,
      CANNOT_REPAIR: 1,
      VERIFIED: 1,
    });
    expect(body.groups).toHaveLength(3);
    expect(body.groups[0].team?.id).toBe(IDS.team.a);
    expect(body.groups[0].counts).toMatchObject({ TODO: 1, IN_PROGRESS: 1, SENT_BACK: 1, COMPLETED: 1 });
    const byTeam = new Map(body.groups.map((group) => [group.team?.id ?? 'NONE', group.counts]));
    expect(byTeam.get(K.otherTeam)).toMatchObject({ CANNOT_REPAIR: 1 });
    expect(byTeam.get('NONE')).toMatchObject({ VERIFIED: 1 });
    expect(body.hasNoTeam).toBe(true);
  });

  it('a group opens sent back first, with TNB’s reason', async () => {
    const body = await items('mgrA', `&organizationId=${IDS.org.a}&teamId=${IDS.team.a}`);
    expect(body.items.map((item) => item.status)).toEqual(['SENT_BACK', 'IN_PROGRESS', 'TODO', 'COMPLETED']);
    expect(body.items[0].sentBack?.reason).toBe('Fix the stay wire');
    expect(body.items.map((item) => item.id)).not.toContain(defectId('legacy'));

    const none = await items('mgrA', '&teamId=NONE');
    expect(none.items.map((item) => [item.id, item.status])).toEqual([[defectId('verified'), 'VERIFIED']]);
  });

  it('status and date filters', async () => {
    const sentBack = await groups('mgrA', '&status=SENT_BACK');
    expect(sentBack.groups.map((group) => group.team?.id)).toEqual([IDS.team.a]);
    // Status narrows the groups, not the chip counts.
    expect(sentBack.counts.VERIFIED).toBe(1);

    // Marked done or verified in the range: only the verification on 12 Oct.
    const ranged = await groups('mgrA', '&from=2026-10-10&to=2026-10-31');
    expect(ranged.counts).toMatchObject({ VERIFIED: 1, COMPLETED: 0, TODO: 0 });
  });

  it('supervisor: the whole company; technician: own team only', async () => {
    expect((await groups('supA')).groups).toHaveLength(3);

    const tech = await groups('techA');
    expect(tech.groups.map((group) => group.team?.id)).toEqual([IDS.team.a]);
    const techItems = await items('techA', '');
    expect(techItems.items.map((item) => item.status).sort()).toEqual(
      ['COMPLETED', 'IN_PROGRESS', 'SENT_BACK', 'TODO'].sort(),
    );
  });

  it('another company sees none of it; viewers are refused', async () => {
    expect((await groups('mgrB')).groups).toHaveLength(0);
    expect((await items('mgrB', '')).items).toHaveLength(0);
    await http(app, token.viewerA).get('/api/v1/maintenance-tasks/groups').expect(403);
  });

  it('admin sees every company and can narrow to one', async () => {
    const body = await groups('admin', `&organizationId=${IDS.org.a}`);
    expect(body.groups).toHaveLength(3);
  });

  it('overview: the day’s three events, 30 days of them, work types and teams', async () => {
    // Every Kejanggalan in this spec is Rentis, so the work-type row is the visit's.
    const body = (
      await http(app, token.mgrA)
        .get(`/api/v1/maintenance-tasks/overview?date=2026-10-12&organizationId=${IDS.org.a}`)
        .expect(200)
    ).body as {
      date: string;
      today: Record<string, number>;
      series: Array<{ date: string; started: number; completed: number; verified: number }>;
      totals: Record<string, number>;
      teams: Array<{ team: { id: string } | null; overdue: number; openPencawang: number; week: Record<string, number> }>;
    };
    expect(body.date).toBe('2026-10-12');
    expect(body.series).toHaveLength(30);
    expect(body.series[29].date).toBe('2026-10-12');
    // Verified on 12 Oct (11:00 Malaysia time).
    expect(body.today).toEqual({ started: 0, completed: 0, verified: 1 });
    const day = (date: string) => body.series.find((point) => point.date === date);
    expect(day('2026-10-03')).toMatchObject({ started: 1 });
    // Marked done on 5 Oct: sent back, completed, cannot repair, verified.
    expect(day('2026-10-05')).toMatchObject({ completed: 4 });

    // Target 8 Oct, open work on 12 Oct: to do, in progress, sent back.
    const teamA = body.teams.find((row) => row.team?.id === IDS.team.a);
    expect(teamA).toMatchObject({ overdue: 3, openPencawang: 1 });
    expect(body.totals.overdue).toBeGreaterThanOrEqual(3);
  });

  it('overview follows the same scope (viewer refused, other company empty)', async () => {
    await http(app, token.viewerA).get('/api/v1/maintenance-tasks/overview').expect(403);
    const other = await http(app, token.mgrB).get('/api/v1/maintenance-tasks/overview?date=2026-10-12').expect(200);
    expect(other.body.teams.some((row: { team: { id: string } | null }) => row.team?.id === IDS.team.a)).toBe(false);
  });

  it('reports by date: the status picks which date counts', async () => {
    const period = async (query: string) =>
      (
        await http(app, token.mgrA)
          .get(`/api/v1/maintenance-tasks/report-period?organizationId=${IDS.org.a}&${query}`)
          .expect(200)
      ).body as { pencawang: number; kejanggalan: number; targets: Array<{ siteVisitId: string }> };
    const mine = (body: { targets: Array<{ siteVisitId: string; count?: number }> }) =>
      body.targets.filter((target) => target.siteVisitId === K.visit);

    // Verified on 12 Oct → claimable.
    const verified = await period('from=2026-10-10&to=2026-10-31&status=VERIFIED');
    expect(mine(verified)).toEqual([expect.objectContaining({ count: 1 })]);
    // Marked done on 5 Oct and not verified: completed + cannot repair (sent back is back at work).
    const completed = await period('from=2026-10-01&to=2026-10-31&status=COMPLETED');
    expect(mine(completed)).toEqual([expect.objectContaining({ count: 2 })]);
    const both = await period('from=2026-10-01&to=2026-10-31&status=BOTH');
    expect(mine(both)).toEqual([expect.objectContaining({ count: 3 })]);
    // Verified is the default; nothing verified in early October.
    expect(mine(await period('from=2026-10-01&to=2026-10-09'))).toEqual([]);

    await http(app, token.mgrA)
      .get('/api/v1/maintenance-tasks/report-period?from=2026-10-31&to=2026-10-01')
      .expect(400);
  });

  it('reports by date: one Pencawang PDF and the ZIP with ringkasan.xlsx', async () => {
    await http(app, token.mgrA)
      .get(
        `/api/v1/maintenance-packages/${K.visit}/repair-report.pdf?organizationId=${IDS.org.a}&from=2026-10-01&to=2026-10-31&status=BOTH`,
      )
      .expect(200)
      .expect('Content-Type', /pdf/);
    // A period with nothing in it says so instead of an empty report.
    await http(app, token.mgrA)
      .get(
        `/api/v1/maintenance-packages/${K.visit}/repair-report.pdf?organizationId=${IDS.org.a}&from=2026-01-01&to=2026-01-31`,
      )
      .expect(400);

    const started = await http(app, token.mgrA)
      .post('/api/v1/maintenance-packages/repair-reports/jobs')
      .send({ from: '2026-10-01', to: '2026-10-31', status: 'BOTH', organizationId: IDS.org.a, category: 'RENTIS' })
      .expect(201);
    expect(started.body.total).toBeGreaterThanOrEqual(1);
    let status = 'RUNNING';
    for (let attempt = 0; attempt < 60 && status === 'RUNNING'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const polled = await http(app, token.mgrA)
        .get(`/api/v1/maintenance-packages/repair-reports/jobs/${started.body.jobId}`)
        .expect(200);
      status = polled.body.status;
    }
    expect(status).toBe('COMPLETED');
    const zip = await http(app, token.mgrA)
      .get(`/api/v1/maintenance-packages/repair-reports/jobs/${started.body.jobId}/download.zip`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    // Stored (uncompressed) ZIP: entry names are plain text in the archive.
    expect((zip.body as Buffer).toString('latin1')).toContain('ringkasan.xlsx');

    // No dates and no Pencawang = nothing to build.
    await http(app, token.mgrA).post('/api/v1/maintenance-packages/repair-reports/jobs').send({}).expect(400);
  });

  it('TNB Today: each company’s day by work type, on TNB’s Mainheads only', async () => {
    const body = (
      await http(app, token.foreman).get('/api/v1/maintenance-tasks/tnb/today?date=2026-10-12').expect(200)
    ).body as {
      today: Record<string, number>;
      series: unknown[];
      companies: Array<{
        company: { id: string };
        total: number;
        verified: number;
        lanes: Array<{ category: string; today: Record<string, number> }>;
      }>;
    };
    expect(body.series).toHaveLength(30);
    expect(body.today).toEqual({ started: 0, completed: 0, verified: 1 });
    const companyA = body.companies.find((row) => row.company.id === IDS.org.a);
    expect(companyA).toMatchObject({ total: 6, verified: 1 });
    expect(companyA?.lanes).toEqual([
      expect.objectContaining({ category: 'RENTIS', today: { started: 0, completed: 0, verified: 1 } }),
    ]);

    // A TNB Supervisor sees only its companies (B here) — none of A's work.
    const supervised = await http(app, token.supervisor).get('/api/v1/maintenance-tasks/tnb/today?date=2026-10-12').expect(200);
    expect(supervised.body.companies.map((row: { company: { id: string } }) => row.company.id)).not.toContain(IDS.org.a);
    // Contractors use their own Overview.
    await http(app, token.mgrA).get('/api/v1/maintenance-tasks/tnb/today').expect(403);
  });

  it('TNB Performance: company × work type over a period, totals and Excel', async () => {
    const body = (
      await http(app, token.foreman)
        .get(`/api/v1/maintenance-tasks/tnb/performance?from=2026-10-01&to=2026-10-31&organizationId=${IDS.org.a}`)
        .expect(200)
    ).body as {
      companies: Array<{ company: { id: string }; lanes: Array<Record<string, unknown>>; total: Record<string, unknown> }>;
    };
    expect(body.companies).toHaveLength(1);
    const [company] = body.companies;
    expect(company.lanes).toEqual([
      expect.objectContaining({
        category: 'RENTIS',
        assigned: 6,
        // Marked done 5 Oct: sent back, completed, cannot repair, verified.
        completed: 4,
        verified: 1,
        cannotRepair: 1,
        sentBack: 1,
        sentBackRate: 0.5,
        daysToDone: 4,
        daysToVerify: 7,
        open: 3,
        overduePencawang: 1,
      }),
    ]);
    expect(company.total).toMatchObject({ category: 'ALL', assigned: 6, verified: 1, overduePencawang: 1 });

    await http(app, token.foreman)
      .get('/api/v1/maintenance-tasks/tnb/performance.xlsx?from=2026-10-01&to=2026-10-31')
      .expect(200)
      .expect('Content-Type', /spreadsheetml/);
    await http(app, token.foreman).get('/api/v1/maintenance-tasks/tnb/performance?from=2026-10-31&to=2026-10-01').expect(400);
  });

  it('rejects a bad team filter', () =>
    http(app, token.mgrA).get('/api/v1/maintenance-tasks/groups?teamId=everyone').expect(400));
});

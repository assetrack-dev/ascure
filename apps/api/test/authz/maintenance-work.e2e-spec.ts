import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Contractor "my work" for the mobile maintenance mode
 * (docs/PLAN-maintenance-flow.md §7.1, M2). Owner decision D10:
 *  - MANAGER sees the company's whole routed pool (incl. unassigned);
 *  - SUPERVISOR sees work of the teams they supervise / belong to;
 *  - TECHNICIAN sees only their own team's work;
 *  - another company, TNB, and legacy (unrouted) Kejanggalan never appear.
 */
const W = {
  sub: '30000000-0000-4000-8000-0000000000e1',
  otherTeam: '20000000-0000-4000-8000-0000000000e1',
  visit: '60000000-0000-4000-8000-0000000000e1',
  asset: ['70000000-0000-4000-8000-0000000000e1', '70000000-0000-4000-8000-0000000000e2'],
  inspection: ['80000000-0000-4000-8000-0000000000e1', '80000000-0000-4000-8000-0000000000e2'],
  surveyImage: 'b0000000-0000-4000-8000-0000000000e1',
};
// [key, pole index, assigned team, routed?]
const ROWS = [
  ['teamA', 0, IDS.team.a, true],
  ['pool', 0, null, true],
  ['otherTeam', 1, W.otherTeam, true],
  ['legacy', 1, IDS.team.a, false],
] as const;
type Row = (typeof ROWS)[number][0];
const itemId = (key: Row) => `90000000-0000-4000-8000-0000000000e${ROWS.findIndex((r) => r[0] === key) + 1}`;
const defectId = (key: Row) => `a0000000-0000-4000-8000-0000000000e${ROWS.findIndex((r) => r[0] === key) + 1}`;

describe('Authz · maintenance work (mobile crew scope)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  const idsIn = (body: { poles: Array<{ kejanggalan: Array<{ id: string }> }> }) =>
    body.poles.flatMap((pole) => pole.kejanggalan.map((item) => item.id)).sort();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const t = IDS.tenant.t1;

    await prisma.team.create({
      data: { id: W.otherTeam, tenantId: t, name: 'Other Team A2', code: 'OA2', organizationId: IDS.org.a },
    });
    await prisma.substation.create({
      data: { id: W.sub, tenantId: t, name: 'Work Pencawang', code: 'WK-1' },
    });
    await prisma.siteVisit.create({
      data: {
        id: W.visit,
        tenantId: t,
        teamId: IDS.team.b,
        substationId: W.sub,
        createdByUserId: IDS.user.mgrB,
        organizationId: IDS.org.b,
        status: 'ACTIVE',
        lifecycleStatus: 'LAPORAN_SELESAI',
      },
    });
    await prisma.asset.createMany({
      data: W.asset.map((id, index) => ({
        id,
        tenantId: t,
        assetCode: `WK-POLE-${index + 1}`,
        substationId: W.sub,
        assetTypeId: IDS.assetType.savr,
        latitude: 3.8 + index / 1000,
        longitude: 103.3,
      })),
    });
    await prisma.inspection.createMany({
      data: W.inspection.map((id, index) => ({
        id,
        tenantId: t,
        assetId: W.asset[index],
        siteVisitId: W.visit,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techB,
        completionStatus: 'SUBMITTED' as const,
        submittedAt: new Date(),
      })),
    });
    await prisma.inspectionItemResult.createMany({
      data: ROWS.map(([key, pole]) => ({
        id: itemId(key),
        inspectionId: W.inspection[pole],
        // The first Kejanggalan is tied to the template item its survey photo carries.
        checklistItemId: key === 'teamA' ? IDS.template.item : null,
        label: `Work ${key}`,
        result: 'FAIL' as const,
        isDefect: true,
        severity: 'HIGH' as const,
      })),
    });
    await prisma.inspectionImage.create({
      data: {
        id: W.surveyImage,
        inspectionId: W.inspection[0],
        templateItemId: IDS.template.item,
        url: '/uploads/inspections/x/survey.jpg',
        filename: 'survey.jpg',
      },
    });
    await prisma.defect.createMany({
      data: ROWS.map(([key, , team, routed]) => ({
        id: defectId(key),
        inspectionItemResultId: itemId(key),
        severity: 'HIGH' as const,
        status: 'OPEN' as const,
        lifecycleStatus: team ? ('ASSIGNED' as const) : ('VERIFIED' as const),
        assignedToTeamId: team,
        maintenanceOrganizationId: routed ? IDS.org.a : null,
        maintenanceCategory: 'SELENGGARAAN' as const,
      })),
    });
    await prisma.maintenancePackage.create({
      data: {
        tenantId: t,
        siteVisitId: W.visit,
        maintenanceOrganizationId: IDS.org.a,
        dueDate: new Date('2026-12-31'),
      },
    });

    token.mgrA = await login(app, EMAILS.mgrA);
    token.supA = await login(app, EMAILS.supA);
    token.techA = await login(app, EMAILS.techA);
    token.mgrB = await login(app, EMAILS.mgrB);
  });

  afterAll(async () => {
    const ids = ROWS.map(([key]) => defectId(key));
    await prisma.maintenancePackage.deleteMany({ where: { siteVisitId: W.visit } });
    await prisma.defect.deleteMany({ where: { id: { in: ids } } });
    await prisma.inspectionImage.deleteMany({ where: { id: W.surveyImage } });
    await prisma.inspectionItemResult.deleteMany({ where: { inspectionId: { in: W.inspection } } });
    await prisma.inspection.deleteMany({ where: { id: { in: W.inspection } } });
    await prisma.siteVisit.deleteMany({ where: { id: W.visit } });
    await prisma.asset.deleteMany({ where: { id: { in: W.asset } } });
    await prisma.substation.deleteMany({ where: { id: W.sub } });
    await prisma.team.deleteMany({ where: { id: W.otherTeam } });
    await app?.close();
  });

  it('manager: the whole routed pool, never legacy work', async () => {
    const list = await http(app, token.mgrA).get('/api/v1/maintenance-work').expect(200);
    const pkg = list.body.packages.find((p: { siteVisitId: string }) => p.siteVisitId === W.visit);
    expect(list.body.role).toBe('MANAGER');
    expect(pkg).toMatchObject({ poleCount: 2, counts: { TODO: 3 } });
    expect(pkg.dueDate).toBe(new Date('2026-12-31').toISOString());

    const detail = await http(app, token.mgrA).get(`/api/v1/maintenance-work/${W.visit}`).expect(200);
    expect(idsIn(detail.body)).toEqual(
      [defectId('teamA'), defectId('pool'), defectId('otherTeam')].sort(),
    );
  });

  it('technician: only their own team', async () => {
    const detail = await http(app, token.techA).get(`/api/v1/maintenance-work/${W.visit}`).expect(200);
    expect(detail.body.role).toBe('TECHNICIAN');
    expect(idsIn(detail.body)).toEqual([defectId('teamA')]);

    const item = detail.body.poles[0].kejanggalan[0];
    expect(item.surveyPhotos).toEqual([{ id: W.surveyImage, url: '/uploads/inspections/x/survey.jpg' }]);
    expect(item.photos).toEqual({ BEFORE: [], DURING: [], AFTER: [] });
    expect(item.state).toBe('TODO');
  });

  it('supervisor: the teams they supervise', async () => {
    const detail = await http(app, token.supA).get(`/api/v1/maintenance-work/${W.visit}`).expect(200);
    expect(detail.body.role).toBe('SUPERVISOR');
    expect(idsIn(detail.body)).toEqual([defectId('teamA')]);
  });

  it('another company sees nothing (404, no existence leak)', async () => {
    await http(app, token.mgrB).get(`/api/v1/maintenance-work/${W.visit}`).expect(404);
    const list = await http(app, token.mgrB).get('/api/v1/maintenance-work').expect(200);
    expect(list.body.packages.map((p: { siteVisitId: string }) => p.siteVisitId)).not.toContain(W.visit);
  });

  it('a repair photo shows up on the work pack', async () => {
    await prisma.defectEvidenceImage.create({
      data: { defectId: defectId('teamA'), evidenceType: 'BEFORE', fileName: 'b.jpg', storageKey: 'k', url: '/uploads/defects/x/b.jpg' },
    });
    try {
      const detail = await http(app, token.techA).get(`/api/v1/maintenance-work/${W.visit}`).expect(200);
      expect(detail.body.poles[0].kejanggalan[0].photos.BEFORE).toHaveLength(1);
    } finally {
      await prisma.defectEvidenceImage.deleteMany({ where: { defectId: defectId('teamA') } });
    }
  });
});

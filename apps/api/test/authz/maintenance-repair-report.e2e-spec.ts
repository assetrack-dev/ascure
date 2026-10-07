import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Plan §16 (M4) — the per-Pencawang, per-company repair report.
 *
 *   PE with: subcontractor S → closed Rentis + cannot-repair Selenggaraan +
 *   a new finding; Company B → one open Kejanggalan.
 *
 * A contractor Manager gets its own company's PDF; another company's is 403; a
 * technician is 403; with two companies in reach the caller must choose (400);
 * a work type with nothing → 400; the ZIP job builds in the background.
 */
const P = {
  sub: '30000000-0000-4000-8000-0000000c1701',
  visit: '60000000-0000-4000-8000-0000000c1701',
  asset: ['70000000-0000-4000-8000-0000000c1701', '70000000-0000-4000-8000-0000000c1702'],
  inspection: ['80000000-0000-4000-8000-0000000c1701', '80000000-0000-4000-8000-0000000c1702'],
  item: [
    '90000000-0000-4000-8000-0000000c1701',
    '90000000-0000-4000-8000-0000000c1702',
    '90000000-0000-4000-8000-0000000c1703',
    '90000000-0000-4000-8000-0000000c1704',
  ],
  defect: {
    closed: 'a0000000-0000-4000-8000-0000000c1701',
    cannot: 'a0000000-0000-4000-8000-0000000c1702',
    finding: 'a0000000-0000-4000-8000-0000000c1703',
    other: 'a0000000-0000-4000-8000-0000000c1704',
  },
};
const ALL_DEFECTS = Object.values(P.defect);
const PDF = `/api/v1/maintenance-packages/${P.visit}/repair-report.pdf`;

describe('Authz · maintenance packages — repair report (plan §16)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const t = IDS.tenant.t1;

    await prisma.substation.create({
      data: { id: P.sub, tenantId: t, name: 'Repair Report PE', code: 'RR-1', latitude: 3.9, longitude: 103.4 },
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
        assetCode: `RR-POLE-${index + 1}`,
        substationId: P.sub,
        assetTypeId: IDS.assetType.savr,
        latitude: 3.9,
        longitude: 103.4,
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
    const inspectionOf = [P.inspection[0], P.inspection[0], P.inspection[1], P.inspection[1]];
    await prisma.inspectionItemResult.createMany({
      data: P.item.map((id, index) => ({
        id,
        inspectionId: inspectionOf[index],
        label: `Kejanggalan ${index + 1} → test`,
        result: 'FAIL' as const,
        isDefect: true,
        severity: 'MEDIUM' as const,
        source: index === 2 ? ('MAINTENANCE_FINDING' as const) : ('SURVEY' as const),
      })),
    });
    const now = new Date();
    await prisma.defect.createMany({
      data: [
        {
          id: P.defect.closed,
          inspectionItemResultId: P.item[0],
          status: 'CLOSED',
          severity: 'HIGH',
          lifecycleStatus: 'CLOSED',
          maintenanceCategory: 'RENTIS',
          maintenanceOrganizationId: IDS.sub.org,
          assignedToTeamId: IDS.sub.team,
          maintainedAt: now,
          maintainedByUserId: IDS.sub.tech,
          closureVerifiedAt: now,
          closureVerifiedByUserId: IDS.user.mgrA,
        },
        {
          id: P.defect.cannot,
          inspectionItemResultId: P.item[1],
          status: 'OPEN',
          severity: 'MEDIUM',
          lifecycleStatus: 'COMPLETED',
          resolutionOutcome: 'EXTERNAL_CONSTRAINT',
          maintenanceNotes: 'Landowner refused access',
          maintenanceCategory: 'SELENGGARAAN',
          maintenanceOrganizationId: IDS.sub.org,
          assignedToTeamId: IDS.sub.team,
          maintainedAt: now,
        },
        {
          id: P.defect.finding,
          inspectionItemResultId: P.item[2],
          status: 'OPEN',
          severity: 'LOW',
          lifecycleStatus: 'IN_PROGRESS',
          maintenanceCategory: 'SELENGGARAAN',
          maintenanceOrganizationId: IDS.sub.org,
          assignedToTeamId: IDS.sub.team,
        },
        {
          id: P.defect.other,
          inspectionItemResultId: P.item[3],
          status: 'OPEN',
          severity: 'MEDIUM',
          lifecycleStatus: 'VERIFIED',
          maintenanceCategory: 'CAT_TIANG',
          maintenanceOrganizationId: IDS.org.b,
        },
      ],
    });
    // The packages that put those Kejanggalan with each company (routing source).
    await prisma.maintenancePackage.createMany({
      data: [
        { tenantId: t, siteVisitId: P.visit, category: 'RENTIS', maintenanceOrganizationId: IDS.sub.org, assignedTeamId: IDS.sub.team },
        { tenantId: t, siteVisitId: P.visit, category: 'SELENGGARAAN', maintenanceOrganizationId: IDS.sub.org, assignedTeamId: IDS.sub.team },
        { tenantId: t, siteVisitId: P.visit, category: 'CAT_TIANG', maintenanceOrganizationId: IDS.org.b },
      ],
    });
    // A photo row whose file is missing must not break the report.
    await prisma.defectEvidenceImage.create({
      data: {
        defectId: P.defect.closed,
        evidenceType: 'BEFORE',
        fileName: 'missing.jpg',
        storageKey: 'defects/none/missing.jpg',
        url: '/uploads/defects/none/missing.jpg',
      },
    });

    token.admin = await login(app, EMAILS.adminT1);
    token.subMgr = await login(app, EMAILS.subMgr);
    token.mgrB = await login(app, EMAILS.mgrB);
    token.techA = await login(app, EMAILS.techA);
  });

  afterAll(async () => {
    await prisma.maintenancePackage.deleteMany({ where: { siteVisitId: P.visit } });
    await prisma.defectEvidenceImage.deleteMany({ where: { defectId: { in: ALL_DEFECTS } } });
    await prisma.defect.deleteMany({ where: { id: { in: ALL_DEFECTS } } });
    await prisma.inspectionItemResult.deleteMany({ where: { id: { in: P.item } } });
    await prisma.inspection.deleteMany({ where: { id: { in: P.inspection } } });
    await prisma.siteVisit.deleteMany({ where: { id: P.visit } });
    await prisma.asset.deleteMany({ where: { id: { in: P.asset } } });
    await prisma.substation.deleteMany({ where: { id: P.sub } });
    await app?.close();
  });

  const pdf = (who: string, query = '') =>
    http(app, token[who])
      .get(`${PDF}${query}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

  it("a subcontractor manager downloads its own company's report", async () => {
    const res = await pdf('subMgr').expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('laporan-pembaikan-Repair_Report_PE');
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it("another company's report is refused; a technician is refused", async () => {
    await pdf('subMgr', `?organizationId=${IDS.org.b}`).expect(403);
    await pdf('techA').expect(403);
  });

  it('a Main Contractor outside the group sees only its own company', async () => {
    const res = await pdf('mgrB').expect(200);
    expect(res.headers['content-disposition']).toContain('laporan-pembaikan-Repair_Report_PE');
    await pdf('mgrB', `?organizationId=${IDS.sub.org}`).expect(403);
  });

  it('with two companies in reach the caller chooses; a work type with nothing is a 400', async () => {
    await pdf('admin').expect(400);
    await pdf('admin', `?organizationId=${IDS.sub.org}`).expect(200);
    await pdf('admin', `?organizationId=${IDS.sub.org}&category=RENTIS`).expect(200);
    await pdf('admin', `?organizationId=${IDS.sub.org}&category=CAT_TIANG`).expect(400);
  });

  it('builds a ZIP of several Pencawang in the background', async () => {
    const start = await http(app, token.subMgr)
      .post('/api/v1/maintenance-packages/repair-reports/jobs')
      .send({ siteVisitIds: [P.visit] })
      .expect(201);
    const { jobId } = start.body as { jobId: string };

    let status = 'RUNNING';
    for (let attempt = 0; attempt < 50 && status === 'RUNNING'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const poll = await http(app, token.subMgr)
        .get(`/api/v1/maintenance-packages/repair-reports/jobs/${jobId}`)
        .expect(200);
      status = poll.body.status;
    }
    expect(status).toBe('COMPLETED');

    // Only the user who started it may fetch it.
    await http(app, token.admin)
      .get(`/api/v1/maintenance-packages/repair-reports/jobs/${jobId}`)
      .expect(404);
    const zip = await http(app, token.subMgr)
      .get(`/api/v1/maintenance-packages/repair-reports/jobs/${jobId}/download.zip`)
      .expect(200);
    expect(zip.headers['content-type']).toContain('application/zip');
  });
});

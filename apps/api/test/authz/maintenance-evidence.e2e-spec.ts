import { INestApplication } from '@nestjs/common';
import { rm } from 'fs/promises';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';
import { buildDefectEvidenceImagesDirectory } from '../../src/common/uploads.constants';

/**
 * Repair evidence (docs/PLAN-maintenance-flow.md §6, M1 step 4).
 *
 *  - Evidence types are an allow-list: BEFORE / DURING / AFTER, plus the legacy
 *    MAINTENANCE_PROOF / EMERGENCY that released APKs still send.
 *  - On a ROUTED Kejanggalan the crew cannot mark it done without ≥1 BEFORE and
 *    ≥1 AFTER photo; a cannot-repair outcome needs only the BEFORE.
 *  - The first repair photo on an ASSIGNED routed Kejanggalan starts the work.
 *  - An unrouted (legacy) Kejanggalan keeps its old, gate-free completion.
 *  - A closed Kejanggalan takes no more repair photos.
 */
const E = {
  sub: '30000000-0000-4000-8000-0000000000d1',
  visit: '60000000-0000-4000-8000-0000000000d1',
  asset: '70000000-0000-4000-8000-0000000000d1',
  inspection: '80000000-0000-4000-8000-0000000000d1',
};
const CASES = ['repair', 'cannot', 'legacy', 'closed'] as const;
type Case = (typeof CASES)[number];
const itemId = (key: Case) => `90000000-0000-4000-8000-0000000000d${CASES.indexOf(key) + 1}`;
const defectId = (key: Case) => `a0000000-0000-4000-8000-0000000000d${CASES.indexOf(key) + 1}`;

// Smallest valid-enough JPEG payload; the API stores bytes, it doesn't decode.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

describe('Authz · maintenance repair evidence (before / after gate)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tech: string;

  const upload = (key: Case, evidenceType?: string) => {
    const req = http(app, tech)
      .post(`/api/v1/defects/${defectId(key)}/evidence-images`)
      .attach('file', JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    return evidenceType ? req.field('evidenceType', evidenceType) : req;
  };
  const complete = (key: Case, body: Record<string, unknown> = {}) =>
    http(app, tech).patch(`/api/v1/defects/${defectId(key)}/maintenance-completion`).send(body);
  const lifecycle = async (key: Case) =>
    (
      await prisma.defect.findUniqueOrThrow({
        where: { id: defectId(key) },
        select: { lifecycleStatus: true },
      })
    ).lifecycleStatus;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const t = IDS.tenant.t1;

    // prod's schema requires a Pencawang on every survey (only dev relaxed it).
    await prisma.substation.create({
      data: { id: E.sub, tenantId: t, name: 'Evidence Pencawang', code: 'EV-1' },
    });
    await prisma.siteVisit.create({
      data: {
        id: E.visit,
        substationId: E.sub,
        tenantId: t,
        teamId: IDS.team.a,
        createdByUserId: IDS.user.mgrA,
        organizationId: IDS.org.a,
        status: 'ACTIVE',
        lifecycleStatus: 'LAPORAN_SELESAI',
      },
    });
    await prisma.asset.create({
      data: { id: E.asset, tenantId: t, assetCode: 'EV-POLE-1', substationId: E.sub, assetTypeId: IDS.assetType.savr },
    });
    await prisma.inspection.create({
      data: {
        id: E.inspection,
        tenantId: t,
        assetId: E.asset,
        siteVisitId: E.visit,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
    await prisma.inspectionItemResult.createMany({
      data: CASES.map((key) => ({
        id: itemId(key),
        inspectionId: E.inspection,
        label: `Evidence ${key}`,
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
        status: key === 'closed' ? ('CLOSED' as const) : ('OPEN' as const),
        lifecycleStatus: key === 'closed' ? ('CLOSED' as const) : ('ASSIGNED' as const),
        assignedToTeamId: IDS.team.a,
        maintenanceOrganizationId: key === 'legacy' ? null : IDS.org.a,
      })),
    });

    tech = await login(app, EMAILS.techA);
  });

  afterAll(async () => {
    const ids = CASES.map(defectId);
    await prisma.defectEvidenceImage.deleteMany({ where: { defectId: { in: ids } } });
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: ids } } });
    await prisma.defect.deleteMany({ where: { id: { in: ids } } });
    await prisma.inspectionItemResult.deleteMany({ where: { inspectionId: E.inspection } });
    await prisma.inspection.deleteMany({ where: { id: E.inspection } });
    await prisma.siteVisit.deleteMany({ where: { id: E.visit } });
    await prisma.asset.deleteMany({ where: { id: E.asset } });
    await prisma.substation.deleteMany({ where: { id: E.sub } });
    await Promise.all(
      ids.map((id) => rm(buildDefectEvidenceImagesDirectory(id), { recursive: true, force: true })),
    );
    await app?.close();
  });

  it('rejects an unknown evidence type (400)', () => upload('repair', 'SELFIE').expect(400));

  it('cannot mark a routed repair done without photos (400)', async () => {
    const res = await complete('repair').expect(400);
    expect(res.body.message).toMatch(/BEFORE photo and an AFTER photo/);
  });

  it('the first BEFORE photo starts the work', async () => {
    const res = await upload('repair', 'before').expect(201);
    expect(res.body.evidenceType).toBe('BEFORE');
    expect(await lifecycle('repair')).toBe('IN_PROGRESS');
    const started = await prisma.defectTimelineEntry.count({
      where: { defectId: defectId('repair'), type: 'MAINTENANCE_STARTED' },
    });
    expect(started).toBe(1);
  });

  it('still needs the AFTER photo (400)', async () => {
    const res = await complete('repair').expect(400);
    expect(res.body.message).toMatch(/AFTER photo/);
    expect(res.body.message).not.toMatch(/BEFORE/);
  });

  it('with BEFORE + AFTER the repair is submitted', async () => {
    await upload('repair', 'DURING').expect(201);
    await upload('repair', 'AFTER').expect(201);
    await complete('repair').expect(200);
    expect(await lifecycle('repair')).toBe('COMPLETED');
  });

  it('a cannot-repair outcome needs only the BEFORE photo', async () => {
    await complete('cannot', { resolutionOutcome: 'EXTERNAL_CONSTRAINT' }).expect(400);
    await upload('cannot', 'BEFORE').expect(201);
    await complete('cannot', { resolutionOutcome: 'EXTERNAL_CONSTRAINT' }).expect(200);
    expect(await lifecycle('cannot')).toBe('COMPLETED');
  });

  it('released APKs: MAINTENANCE_PROOF / no type are still accepted', async () => {
    const typed = await upload('legacy', 'MAINTENANCE_PROOF').expect(201);
    expect(typed.body.evidenceType).toBe('MAINTENANCE_PROOF');
    const untyped = await upload('legacy').expect(201);
    expect(untyped.body.evidenceType).toBe('MAINTENANCE_PROOF');
    // …and they don't start routed work: legacy stays as it was.
    expect(await lifecycle('legacy')).toBe('ASSIGNED');
  });

  it('an unrouted (legacy) Kejanggalan completes without the gate', async () => {
    await complete('legacy').expect(200);
    expect(await lifecycle('legacy')).toBe('COMPLETED');
  });

  it('a closed Kejanggalan takes no more repair photos (400)', () =>
    upload('closed', 'AFTER').expect(400));
});

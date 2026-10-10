import { INestApplication } from '@nestjs/common';
import { rm } from 'fs/promises';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';
import { buildDefectEvidenceImagesDirectory } from '../../src/common/uploads.constants';

/**
 * New finding during maintenance (docs/PLAN-maintenance-flow.md §13).
 *
 *  - A crew (or the office) adds a Kejanggalan that was not in the survey, on
 *    any surveyed pole of the package — even one with no Kejanggalan yet.
 *  - It is routed like any other (company + team), opens ready to work, and
 *    runs the normal BEFORE / AFTER → done → verify flow, tagged isNewFinding.
 *  - One open Kejanggalan per pole + checklist item; offline retries are
 *    idempotent by clientRef; another company cannot add.
 *  - It never changes the survey: the inspection's own items and the visit's
 *    survey defect count stay as recorded.
 */
const F = {
  sub: '30000000-0000-4000-8000-0000000000f1',
  visit: '60000000-0000-4000-8000-0000000000f1',
  asset: ['70000000-0000-4000-8000-0000000000f1', '70000000-0000-4000-8000-0000000000f2'],
  inspection: ['80000000-0000-4000-8000-0000000000f1', '80000000-0000-4000-8000-0000000000f2'],
  surveyItem: '90000000-0000-4000-8000-0000000000f1',
  surveyDefect: 'a0000000-0000-4000-8000-0000000000f1',
  template: '50000000-0000-4000-8000-0000000000f1',
  section: '50000000-0000-4000-8000-0000000000f2',
  rentisItem: '50000000-0000-4000-8000-0000000000f3',
  poleItem: '50000000-0000-4000-8000-0000000000f4',
  textItem: '50000000-0000-4000-8000-0000000000f5',
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

describe('Authz · maintenance new finding (§13)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};
  const createdDefects: string[] = [];

  const add = (who: string, body: Record<string, unknown>) =>
    http(app, token[who]).post(`/api/v1/maintenance-work/${F.visit}/findings`).send(body);
  const pack = async (who: string) =>
    (await http(app, token[who]).get(`/api/v1/maintenance-work/${F.visit}`).expect(200)).body;
  const findingOn = (body: { poles: Array<{ assetId: string; kejanggalan: Array<{ id: string }> }> }, defectId: string) =>
    body.poles.flatMap((pole) => pole.kejanggalan).find((item) => item.id === defectId) as Record<string, unknown> | undefined;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const t = IDS.tenant.t1;

    await prisma.inspectionTemplate.create({
      data: {
        id: F.template,
        tenantId: t,
        assetTypeId: IDS.assetType.savr,
        version: 99,
        name: 'Finding Checklist',
        status: 'ARCHIVED',
        isActive: false,
        scopeLevel: 'GLOBAL',
        sections: { create: [{ id: F.section, title: 'Rentis', sortOrder: 0 }] },
      },
    });
    await prisma.inspectionTemplateItem.createMany({
      data: [
        {
          id: F.rentisItem,
          templateId: F.template,
          sectionId: F.section,
          key: 'rentis',
          label: 'RENTIS',
          inputType: 'SELECT',
          isDefectTrigger: true,
          severity: 'MEDIUM',
          maintenanceCategory: 'RENTIS',
          sortOrder: 0,
          optionsJson: [
            { label: 'Bersih', value: 'BERSIH' },
            { label: 'Perlu rentis', value: 'PERLU', isDefect: true, severity: 'HIGH' },
          ],
        },
        {
          id: F.poleItem,
          templateId: F.template,
          sectionId: F.section,
          key: 'condong',
          label: 'TIANG CONDONG',
          inputType: 'BOOLEAN',
          isDefectTrigger: true,
          severity: 'LOW',
          sortOrder: 1,
        },
        {
          id: F.textItem,
          templateId: F.template,
          sectionId: F.section,
          key: 'catitan',
          label: 'CATITAN',
          inputType: 'TEXT',
          isDefectTrigger: true,
          severity: 'LOW',
          sortOrder: 2,
        },
      ],
    });
    await prisma.substation.create({ data: { id: F.sub, tenantId: t, name: 'Finding Pencawang', code: 'FN-1' } });
    await prisma.siteVisit.create({
      data: {
        id: F.visit,
        tenantId: t,
        teamId: IDS.team.b,
        substationId: F.sub,
        createdByUserId: IDS.user.mgrB,
        organizationId: IDS.org.b,
        status: 'COMPLETED',
        lifecycleStatus: 'LAPORAN_SELESAI',
      },
    });
    await prisma.asset.createMany({
      data: F.asset.map((id, index) => ({
        id,
        tenantId: t,
        assetCode: `FN-POLE-${index + 1}`,
        substationId: F.sub,
        assetTypeId: IDS.assetType.savr,
        latitude: 3.9 + index / 1000,
        longitude: 103.3,
      })),
    });
    await prisma.inspection.createMany({
      data: F.inspection.map((id, index) => ({
        id,
        tenantId: t,
        assetId: F.asset[index],
        siteVisitId: F.visit,
        templateId: F.template,
        createdByUserId: IDS.user.techB,
        completionStatus: 'SUBMITTED' as const,
        submittedAt: new Date(),
      })),
    });
    // Pole 1 had one survey Kejanggalan (leaning); pole 2 had none.
    await prisma.inspectionItemResult.createMany({
      data: [
        { id: F.surveyItem, inspectionId: F.inspection[0], checklistItemId: F.poleItem, label: 'TIANG CONDONG', result: 'FAIL', isDefect: true, severity: 'LOW' },
        { inspectionId: F.inspection[0], checklistItemId: F.rentisItem, label: 'RENTIS', result: 'PASS', isDefect: false },
        { inspectionId: F.inspection[1], checklistItemId: F.rentisItem, label: 'RENTIS', result: 'PASS', isDefect: false },
      ],
    });
    await prisma.defect.create({
      data: {
        id: F.surveyDefect,
        inspectionItemResultId: F.surveyItem,
        severity: 'LOW',
        status: 'OPEN',
        lifecycleStatus: 'ASSIGNED',
        assignedToTeamId: IDS.team.a,
        assignedTeamId: IDS.team.a,
        maintenanceOrganizationId: IDS.org.a,
        maintenanceCategory: 'SELENGGARAAN',
      },
    });
    // TNB gave the whole PE to company A, team A.
    await prisma.maintenancePackage.create({
      data: { tenantId: t, siteVisitId: F.visit, maintenanceOrganizationId: IDS.org.a, assignedTeamId: IDS.team.a },
    });

    token.techA = await login(app, EMAILS.techA);
    token.mgrB = await login(app, EMAILS.mgrB);
    token.adminT1 = await login(app, EMAILS.adminT1);
  });

  afterAll(async () => {
    const defects = await prisma.defect.findMany({
      where: { inspectionItemResult: { inspectionId: { in: F.inspection } } },
      select: { id: true },
    });
    for (const { id } of defects) {
      await rm(buildDefectEvidenceImagesDirectory(id), { recursive: true, force: true });
    }
    await prisma.maintenancePackage.deleteMany({ where: { siteVisitId: F.visit } });
    await prisma.defect.deleteMany({ where: { id: { in: defects.map((d) => d.id) } } });
    await prisma.inspectionItemResult.deleteMany({ where: { inspectionId: { in: F.inspection } } });
    await prisma.inspection.deleteMany({ where: { id: { in: F.inspection } } });
    await prisma.siteVisit.deleteMany({ where: { id: F.visit } });
    await prisma.asset.deleteMany({ where: { id: { in: F.asset } } });
    await prisma.substation.deleteMany({ where: { id: F.sub } });
    await prisma.inspectionTemplate.deleteMany({ where: { id: F.template } });
    await app?.close();
  });

  it('the work pack offers every surveyed pole and the defect-capable items (offline-ready)', async () => {
    const body = await pack('techA');
    expect(body.surveyedPoles.map((pole: { assetId: string }) => pole.assetId)).toEqual(F.asset);
    const template = body.findingTemplates.find((row: { templateId: string }) => row.templateId === F.template);
    const items = template.items as Array<{ templateItemId: string; category: string; options: Array<{ value: string; severity: string }> }>;
    // TEXT can't carry a defect; the select offers only its defect option.
    expect(items.map((item) => item.templateItemId)).toEqual([F.rentisItem, F.poleItem]);
    expect(items[0]).toMatchObject({ category: 'RENTIS', options: [{ value: 'PERLU', severity: 'HIGH' }] });
    expect(items[1].options).toEqual([]);
  });

  it('a crew adds Rentis on a pole that had no Kejanggalan — routed to its team, ready to work', async () => {
    const res = await add('techA', {
      assetId: F.asset[1],
      templateItemId: F.rentisItem,
      optionValue: 'PERLU',
      note: 'Pokok tumbuh rapat',
      clientRef: 'finding-1',
    }).expect(201);
    expect(res.body.created).toBe(true);
    createdDefects.push(res.body.defectId);

    const defect = await prisma.defect.findUniqueOrThrow({
      where: { id: res.body.defectId },
      include: { inspectionItemResult: true },
    });
    expect(defect).toMatchObject({
      severity: 'HIGH',
      maintenanceCategory: 'RENTIS',
      maintenanceOrganizationId: IDS.org.a,
      assignedToTeamId: IDS.team.a,
      lifecycleStatus: 'ASSIGNED',
    });
    expect(defect.inspectionItemResult).toMatchObject({
      inspectionId: F.inspection[1],
      source: 'MAINTENANCE_FINDING',
      createdByUserId: IDS.user.techA,
      remark: 'Perlu rentis — Pokok tumbuh rapat',
    });

    const item = findingOn(await pack('techA'), res.body.defectId);
    expect(item).toMatchObject({ isNewFinding: true, state: 'TODO', category: 'RENTIS', team: { id: IDS.team.a } });
  });

  it('an offline retry with the same clientRef returns the same Kejanggalan', async () => {
    const res = await add('techA', {
      assetId: F.asset[1],
      templateItemId: F.rentisItem,
      optionValue: 'PERLU',
      clientRef: 'finding-1',
    }).expect(201);
    expect(res.body).toMatchObject({ defectId: createdDefects[0], created: false });
  });

  it('one open Kejanggalan per pole + item: a duplicate is refused with the existing id', async () => {
    const dup = await add('techA', {
      assetId: F.asset[1],
      templateItemId: F.rentisItem,
      optionValue: 'PERLU',
      clientRef: 'finding-dup',
    }).expect(409);
    expect(dup.body.defectId).toBe(createdDefects[0]);

    // The survey's own open Kejanggalan blocks it too.
    await add('techA', { assetId: F.asset[0], templateItemId: F.poleItem, clientRef: 'finding-dup2' }).expect(409);
  });

  it('rejects a non-defect option, a missing option and an item that cannot carry a defect', async () => {
    await add('techA', { assetId: F.asset[0], templateItemId: F.rentisItem, optionValue: 'BERSIH' }).expect(400);
    await add('techA', { assetId: F.asset[0], templateItemId: F.rentisItem }).expect(400);
    await add('techA', { assetId: F.asset[0], templateItemId: F.textItem }).expect(400);
  });

  it('another company cannot add (rolled back, nothing created)', async () => {
    await add('mgrB', {
      assetId: F.asset[0],
      templateItemId: F.rentisItem,
      optionValue: 'PERLU',
      clientRef: 'finding-other-company',
    }).expect(403);
    expect(await prisma.inspectionItemResult.count({ where: { clientRef: 'finding-other-company' } })).toBe(0);
  });

  it('a PE not yet at LAPORAN SELESAI takes no findings', async () => {
    await prisma.siteVisit.update({ where: { id: F.visit }, data: { lifecycleStatus: 'RONDAAN_SELESAI' } });
    try {
      await add('techA', { assetId: F.asset[0], templateItemId: F.rentisItem, optionValue: 'PERLU' }).expect(400);
    } finally {
      await prisma.siteVisit.update({ where: { id: F.visit }, data: { lifecycleStatus: 'LAPORAN_SELESAI' } });
    }
  });

  it('runs the normal repair flow and reaches verification tagged as a new finding', async () => {
    const defectId = createdDefects[0];
    for (const stage of ['BEFORE', 'AFTER']) {
      await http(app, token.techA)
        .post(`/api/v1/defects/${defectId}/evidence-images`)
        .attach('file', JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' })
        .field('evidenceType', stage)
        .expect(201);
    }
    await http(app, token.techA).patch(`/api/v1/defects/${defectId}/maintenance-completion`).send({}).expect(200);

    const queue = await http(app, token.adminT1).get('/api/v1/maintenance-verification').expect(200);
    const item = queue.body.items.find((row: { id: string }) => row.id === defectId);
    expect(item).toMatchObject({ isNewFinding: true, addedBy: { id: IDS.user.techA } });

    const detail = await http(app, token.adminT1).get(`/api/v1/defects/${defectId}`).expect(200);
    expect(detail.body.isNewFinding).toBe(true);
  });

  it('never changes the survey: inspection items and the survey defect count stay as recorded', async () => {
    const inspection = await http(app, token.adminT1).get(`/api/v1/inspections/${F.inspection[1]}`).expect(200);
    expect(inspection.body.items.map((item: { label: string }) => item.label)).toEqual(['RENTIS']);
    expect(inspection.body.totalDefects).toBe(0);

    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM "InspectionItemResult" r
      JOIN "Inspection" i ON i."id" = r."inspectionId"
      WHERE r."isDefect" = TRUE AND r."source" = 'SURVEY' AND i."siteVisitId" = ${F.visit}::uuid`;
    expect(rows[0].count).toBe(1);
  });

  // TNB feedback #2 (2026-10-10): work the checklist does not list.
  describe('free text ("Lain-lain")', () => {
    it('a crew adds its own wording with a work type — kept on the pole, routed, ready to work', async () => {
      const res = await add('techA', {
        assetId: F.asset[0],
        customLabel: '  Talian servis   tergantung rendah  ',
        category: 'SELENGGARAAN',
        note: 'Depan rumah no. 12',
        clientRef: 'finding-custom-1',
      }).expect(201);
      createdDefects.push(res.body.defectId);
      const defect = await prisma.defect.findUniqueOrThrow({
        where: { id: res.body.defectId },
        include: { inspectionItemResult: true },
      });
      expect(defect).toMatchObject({
        severity: 'MEDIUM',
        maintenanceCategory: 'SELENGGARAAN',
        maintenanceOrganizationId: IDS.org.a,
        assignedToTeamId: IDS.team.a,
        lifecycleStatus: 'ASSIGNED',
      });
      expect(defect.inspectionItemResult).toMatchObject({
        inspectionId: F.inspection[0],
        checklistItemId: null,
        label: 'Talian servis tergantung rendah',
        remark: 'Depan rumah no. 12',
        source: 'MAINTENANCE_FINDING',
      });
      expect(findingOn(await pack('techA'), res.body.defectId)).toMatchObject({ isNewFinding: true, state: 'TODO' });
    });

    it('the same wording on the same pole is a duplicate (case-insensitive)', async () => {
      const dup = await add('techA', {
        assetId: F.asset[0],
        customLabel: 'TALIAN SERVIS TERGANTUNG RENDAH',
        category: 'SELENGGARAAN',
        clientRef: 'finding-custom-dup',
      }).expect(409);
      expect(dup.body.defectId).toBe(createdDefects[createdDefects.length - 1]);
    });

    it('needs a work type, and is either an item or free text — not both, not neither', async () => {
      await add('techA', { assetId: F.asset[0], customLabel: 'Something else' }).expect(400);
      await add('techA', {
        assetId: F.asset[0],
        templateItemId: F.rentisItem,
        optionValue: 'PERLU',
        customLabel: 'Both',
        category: 'RENTIS',
      }).expect(400);
      await add('techA', { assetId: F.asset[0] }).expect(400);
      await add('techA', { assetId: F.asset[0], customLabel: 'X', category: 'RENTIS' }).expect(400);
    });

    it('another company cannot add free text either', async () => {
      await add('mgrB', {
        assetId: F.asset[0],
        customLabel: 'Kotak fius rosak',
        category: 'SELENGGARAAN',
        clientRef: 'finding-custom-other',
      }).expect(403);
      expect(await prisma.inspectionItemResult.count({ where: { clientRef: 'finding-custom-other' } })).toBe(0);
    });
  });

  describe('office (web)', () => {
    it('admin sees the surveyed poles and items', async () => {
      const res = await http(app, token.adminT1)
        .get(`/api/v1/maintenance-packages/${F.visit}/finding-options`)
        .expect(200);
      expect(res.body.canAdd).toBe(true);
      expect(res.body.poles.map((pole: { assetId: string }) => pole.assetId)).toEqual(F.asset);
    });

    it('admin adds a finding with the condition photo; it is routed and the photo is kept as FINDING', async () => {
      await http(app, token.adminT1)
        .post(`/api/v1/maintenance-packages/${F.visit}/findings`)
        .field('assetId', F.asset[0])
        .field('templateItemId', F.rentisItem)
        .field('optionValue', 'PERLU')
        .expect(400); // the photo is required

      const res = await http(app, token.adminT1)
        .post(`/api/v1/maintenance-packages/${F.visit}/findings`)
        .field('assetId', F.asset[0])
        .field('templateItemId', F.rentisItem)
        .field('optionValue', 'PERLU')
        .field('note', 'Gambar dari krew')
        .attach('file', JPEG, { filename: 'condition.jpg', contentType: 'image/jpeg' })
        .expect(201);
      const defect = await prisma.defect.findUniqueOrThrow({
        where: { id: res.body.defectId },
        include: { evidenceImages: true },
      });
      expect(defect).toMatchObject({ maintenanceOrganizationId: IDS.org.a, assignedToTeamId: IDS.team.a, lifecycleStatus: 'ASSIGNED' });
      expect(defect.evidenceImages.map((image) => image.evidenceType)).toEqual(['FINDING']);

      // The office photo is not the crew's BEFORE — the work has not started.
      const item = findingOn(await pack('techA'), res.body.defectId);
      expect(item).toMatchObject({ isNewFinding: true, state: 'TODO', photos: { BEFORE: [], DURING: [], AFTER: [] } });
    });

    it('a contractor manager outside TNB / MC scope cannot use the office endpoint for another group', async () => {
      await http(app, token.mgrB)
        .post(`/api/v1/maintenance-packages/${F.visit}/findings`)
        .field('assetId', F.asset[1])
        .field('templateItemId', F.poleItem)
        .attach('file', JPEG, { filename: 'condition.jpg', contentType: 'image/jpeg' })
        .expect((res) => expect([403, 404]).toContain(res.status));
    });
  });
});

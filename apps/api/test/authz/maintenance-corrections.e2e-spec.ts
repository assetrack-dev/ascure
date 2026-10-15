import { INestApplication } from '@nestjs/common';
import { rm } from 'fs/promises';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';
import { buildDefectEvidenceImagesDirectory } from '../../src/common/uploads.constants';

/**
 * Crew / office corrections (docs/PLAN-maintenance-flow.md §20).
 *
 *  P1 repair photos: delete (archived, never lost) + fix Before / After — by the
 *     crew whose work it is (or its company), until TNB verifies; a change after
 *     submission is flagged on Repair Verification.
 *  P2 kind of repair (Rentis types): validated on "Mark done" (Lain-lain needs a
 *     note, wrong work type refused), correctable later, shown on Verification;
 *     the list is ADMIN-managed.
 *  P3 No Tiang Lama: the crew corrects it on a pole with unverified work; logged
 *     old → new (the old value read like the reports do: noTiangLama, else name).
 */
const C = {
  sub: '30000000-0000-4000-8000-000000000061',
  visit: '60000000-0000-4000-8000-000000000061',
  asset: '70000000-0000-4000-8000-000000000061',
  inspection: '80000000-0000-4000-8000-000000000061',
};
const CASES = ['rentis', 'closed', 'other'] as const;
type Case = (typeof CASES)[number];
const itemId = (key: Case) => `90000000-0000-4000-8000-00000000006${CASES.indexOf(key) + 1}`;
const defectId = (key: Case) => `a0000000-0000-4000-8000-00000000006${CASES.indexOf(key) + 1}`;
const closedPhoto = 'b0000000-0000-4000-8000-000000000061';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const METHODS = [
  { code: 'RENTIS_KAEDAH_LAZIM', label: 'KAEDAH LAZIM', requiresNote: false, sortOrder: 10 },
  { code: 'RENTIS_KAEDAH_ABC', label: 'KAEDAH A.B.C', requiresNote: false, sortOrder: 20 },
  { code: 'RENTIS_ULAN_CREEPERS', label: 'ULAN/CREEPERS', requiresNote: false, sortOrder: 30 },
  { code: 'RENTIS_TEBANG_POKOK', label: 'TEBANG POKOK', requiresNote: false, sortOrder: 40 },
  { code: 'RENTIS_LAIN_LAIN', label: 'Lain-lain (nyatakan)', requiresNote: true, sortOrder: 90 },
];

type Method = { id: string; code: string; label: string; requiresNote: boolean };

describe('Maintenance corrections · photos, repair type, No Tiang Lama (§20)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};
  const methods: Record<string, Method> = {};

  const upload = (key: Case, evidenceType: string, who = 'techA') =>
    http(app, token[who])
      .post(`/api/v1/defects/${defectId(key)}/evidence-images`)
      .attach('file', JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .field('evidenceType', evidenceType);
  const photos = (key: Case) =>
    prisma.defectEvidenceImage.findMany({
      where: { defectId: defectId(key) },
      orderBy: { createdAt: 'asc' },
      select: { id: true, evidenceType: true },
    });
  const queueItem = async () => {
    const res = await http(app, token.admin)
      .get(`/api/v1/maintenance-verification?siteVisitId=${C.visit}`)
      .expect(200);
    return (res.body.items as Array<Record<string, unknown>>).find((item) => item.id === defectId('rentis'));
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const t = IDS.tenant.t1;

    // The e2e DB is built with `db push`, not the migrations — seed the list here.
    for (const method of METHODS) {
      await prisma.repairMethod.upsert({
        where: { code: method.code },
        create: { ...method, category: 'RENTIS' },
        update: { ...method, isActive: true },
      });
    }

    await prisma.substation.create({
      data: { id: C.sub, tenantId: t, name: 'Corrections Pencawang', code: 'CR-1' },
    });
    await prisma.siteVisit.create({
      data: {
        id: C.visit,
        substationId: C.sub,
        tenantId: t,
        teamId: IDS.team.a,
        createdByUserId: IDS.user.mgrA,
        organizationId: IDS.org.a,
        status: 'ACTIVE',
        lifecycleStatus: 'LAPORAN_SELESAI',
      },
    });
    // NO TIANG LAMA lives in `name` for an app-created pole (noTiangLama null).
    await prisma.asset.create({
      data: { id: C.asset, tenantId: t, assetCode: 'CR-POLE-1', name: 'JAP 8', substationId: C.sub, assetTypeId: IDS.assetType.savr },
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
      data: CASES.map((key) => ({
        id: itemId(key),
        inspectionId: C.inspection,
        label: `Corrections ${key}`,
        result: 'FAIL' as const,
        isDefect: true,
        severity: 'MEDIUM' as const,
      })),
    });
    await prisma.defect.createMany({
      data: [
        { id: defectId('rentis'), category: 'RENTIS', team: IDS.team.a, org: IDS.org.a, closed: false },
        { id: defectId('closed'), category: 'RENTIS', team: IDS.team.a, org: IDS.org.a, closed: true },
        { id: defectId('other'), category: 'SELENGGARAAN', team: IDS.team.b, org: IDS.org.b, closed: false },
      ].map((row) => ({
        id: row.id,
        inspectionItemResultId: itemId(CASES[[defectId('rentis'), defectId('closed'), defectId('other')].indexOf(row.id)]),
        severity: 'MEDIUM' as const,
        maintenanceCategory: row.category as 'RENTIS' | 'SELENGGARAAN',
        status: row.closed ? ('CLOSED' as const) : ('OPEN' as const),
        lifecycleStatus: row.closed ? ('CLOSED' as const) : ('ASSIGNED' as const),
        assignedToTeamId: row.team,
        maintenanceOrganizationId: row.org,
      })),
    });
    await prisma.defectEvidenceImage.create({
      data: {
        id: closedPhoto,
        defectId: defectId('closed'),
        evidenceType: 'AFTER',
        fileName: 'closed.jpg',
        storageKey: 'closed.jpg',
      },
    });

    token.admin = await login(app, EMAILS.adminT1);
    token.mgrA = await login(app, EMAILS.mgrA);
    token.techA = await login(app, EMAILS.techA);
    token.techB = await login(app, EMAILS.techB);
    token.subTech = await login(app, EMAILS.subTech);

    const list = await http(app, token.techA)
      .get('/api/v1/maintenance-work/repair-methods?category=RENTIS')
      .expect(200);
    for (const method of list.body as Method[]) methods[method.code] = method;
  });

  afterAll(async () => {
    const ids = CASES.map(defectId);
    await prisma.defectEvidenceImageArchive.deleteMany({ where: { defectId: { in: ids } } });
    await prisma.defectEvidenceImage.deleteMany({ where: { defectId: { in: ids } } });
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: ids } } });
    await prisma.defect.deleteMany({ where: { id: { in: ids } } });
    await prisma.inspectionItemResult.deleteMany({ where: { inspectionId: C.inspection } });
    await prisma.inspection.deleteMany({ where: { id: C.inspection } });
    await prisma.siteVisit.deleteMany({ where: { id: C.visit } });
    await prisma.assetChangeLog.deleteMany({ where: { assetId: C.asset } });
    await prisma.asset.deleteMany({ where: { id: C.asset } });
    await prisma.substation.deleteMany({ where: { id: C.sub } });
    await prisma.repairMethod.deleteMany({ where: { code: { startsWith: 'RENTIS_POTONG_DAHAN' } } });
    await Promise.all(
      ids.map((id) => rm(buildDefectEvidenceImagesDirectory(id), { recursive: true, force: true })),
    );
    await app?.close();
  });

  it('the crew gets the active Rentis types (Lain-lain needs a note)', () => {
    expect(Object.keys(methods).sort()).toEqual(METHODS.map((method) => method.code).sort());
    expect(methods.RENTIS_LAIN_LAIN.requiresNote).toBe(true);
  });

  it('P1: fix a wrong label and delete a photo — archived, logged, gone from reads', async () => {
    await upload('rentis', 'BEFORE').expect(201);
    await upload('rentis', 'BEFORE').expect(201); // meant to be the AFTER
    const [, wrong] = await photos('rentis');

    // Another company's crew cannot touch it.
    await http(app, token.techB).patch(`/api/v1/maintenance-work/evidence/${wrong.id}`).send({ evidenceType: 'AFTER' }).expect(404);
    await http(app, token.techA).patch(`/api/v1/maintenance-work/evidence/${wrong.id}`).send({ evidenceType: 'SELFIE' }).expect(400);
    await http(app, token.techA).patch(`/api/v1/maintenance-work/evidence/${wrong.id}`).send({ evidenceType: 'after' }).expect(200);
    expect((await photos('rentis')).map((photo) => photo.evidenceType)).toEqual(['BEFORE', 'AFTER']);

    await upload('rentis', 'AFTER').expect(201); // a blurry one
    const blurry = (await photos('rentis'))[2];
    await http(app, token.techB).del(`/api/v1/maintenance-work/evidence/${blurry.id}`).expect(404);
    await http(app, token.techA).del(`/api/v1/maintenance-work/evidence/${blurry.id}`).expect(200);
    expect((await photos('rentis')).map((photo) => photo.id)).not.toContain(blurry.id);
    const archived = await prisma.defectEvidenceImageArchive.findUniqueOrThrow({ where: { id: blurry.id } });
    expect(archived).toMatchObject({ defectId: defectId('rentis'), evidenceType: 'AFTER', deletedByUserId: IDS.user.techA });
    const log = await prisma.defectTimelineEntry.findMany({
      where: { defectId: defectId('rentis'), comment: { contains: 'deleted' } },
    });
    expect(log).toHaveLength(1);
  });

  it('P2: "Mark done" validates the Rentis type', async () => {
    const done = (body: Record<string, unknown>) =>
      http(app, token.techA).patch(`/api/v1/defects/${defectId('rentis')}/maintenance-completion`).send(body);
    await done({ repairMethodId: methods.RENTIS_LAIN_LAIN.id }).expect(400);
    await done({ repairMethodId: methods.RENTIS_LAIN_LAIN.id, repairMethodNote: '  potong   dahan  ' }).expect(200);
    const row = await prisma.defect.findUniqueOrThrow({
      where: { id: defectId('rentis') },
      select: { repairMethodId: true, repairMethodNote: true, lifecycleStatus: true },
    });
    expect(row).toEqual({
      repairMethodId: methods.RENTIS_LAIN_LAIN.id,
      repairMethodNote: 'potong dahan',
      lifecycleStatus: 'COMPLETED',
    });
  });

  it('P2: a Rentis type on another work type is refused', async () => {
    for (const evidenceType of ['BEFORE', 'AFTER']) await upload('other', evidenceType, 'techB').expect(201);
    await http(app, token.techB)
      .patch(`/api/v1/defects/${defectId('other')}/maintenance-completion`)
      .send({ repairMethodId: methods.RENTIS_KAEDAH_LAZIM.id })
      .expect(400);
  });

  it('Verification shows the type; a photo change after submission is flagged', async () => {
    const before = await queueItem();
    expect(before).toMatchObject({
      repairMethod: { label: 'Lain-lain (nyatakan)', note: 'potong dahan' },
      photosChangedAfterSubmission: false,
    });
    await upload('rentis', 'AFTER').expect(201);
    expect(await queueItem()).toMatchObject({ photosChangedAfterSubmission: true });
  });

  it('P2: the office corrects the type later; another company cannot', async () => {
    await http(app, token.techB)
      .patch(`/api/v1/maintenance-work/defects/${defectId('rentis')}/repair-method`)
      .send({ repairMethodId: methods.RENTIS_KAEDAH_ABC.id })
      .expect(404);
    const res = await http(app, token.mgrA)
      .patch(`/api/v1/maintenance-work/defects/${defectId('rentis')}/repair-method`)
      .send({ repairMethodId: methods.RENTIS_KAEDAH_ABC.id })
      .expect(200);
    expect(res.body.repairMethod).toMatchObject({ label: 'KAEDAH A.B.C', note: null });
  });

  it('P3: the crew corrects No Tiang Lama — logged, shown both ways', async () => {
    const path = `/api/v1/maintenance-work/poles/${C.asset}/no-tiang-lama`;
    // A crew with no unverified work on this pole cannot. (Company B CAN — its
    // repair on this same pole is still unverified.)
    await http(app, token.subTech).patch(path).send({ noTiangLama: 'JAP 9' }).expect(404);
    const res = await http(app, token.techA).patch(path).send({ noTiangLama: ' JAP  9 ' }).expect(200);
    expect(res.body).toMatchObject({ noTiangLama: 'JAP 9', previous: 'JAP 8', changed: true });
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: C.asset }, select: { noTiangLama: true, name: true } });
    expect(asset).toEqual({ noTiangLama: 'JAP 9', name: 'JAP 9' });
    const again = await http(app, token.techA).patch(path).send({ noTiangLama: 'JAP 9' }).expect(200);
    expect(again.body.changed).toBe(false);
    const log = await prisma.assetChangeLog.findMany({ where: { assetId: C.asset } });
    expect(log).toEqual([
      expect.objectContaining({ field: 'noTiangLama', oldValue: 'JAP 8', newValue: 'JAP 9', source: 'MAINTENANCE', changedByUserId: IDS.user.techA }),
    ]);
    expect(await queueItem()).toMatchObject({ asset: { noTiangLama: 'JAP 9' }, noTiangLamaPrevious: 'JAP 8' });

    const pack = await http(app, token.techA).get(`/api/v1/maintenance-work/${C.visit}`).expect(200);
    const pole = pack.body.poles.find((row: { assetId: string }) => row.assetId === C.asset);
    expect(pole).toMatchObject({ noTiangLama: 'JAP 9', canEditNoTiangLama: true });
    expect(pole.kejanggalan.find((row: { id: string }) => row.id === defectId('rentis'))).toMatchObject({
      repairMethod: { label: 'KAEDAH A.B.C' },
      canCorrect: true,
    });
    expect(pack.body.repairMethods.length).toBeGreaterThanOrEqual(5);
  });

  it('nothing changes once TNB has verified (CLOSED)', async () => {
    await http(app, token.techA).del(`/api/v1/maintenance-work/evidence/${closedPhoto}`).expect(400);
    await http(app, token.techA).patch(`/api/v1/maintenance-work/evidence/${closedPhoto}`).send({ evidenceType: 'BEFORE' }).expect(400);
    await http(app, token.techA)
      .patch(`/api/v1/maintenance-work/defects/${defectId('closed')}/repair-method`)
      .send({ repairMethodId: methods.RENTIS_KAEDAH_LAZIM.id })
      .expect(400);
  });

  it('ADMIN manages the list; a retired type leaves the crew list', async () => {
    await http(app, token.mgrA).get('/api/v1/repair-methods').expect(403);
    const created = await http(app, token.admin)
      .post('/api/v1/repair-methods')
      .send({ category: 'RENTIS', label: 'Potong dahan' })
      .expect(201);
    expect(created.body).toMatchObject({ code: 'RENTIS_POTONG_DAHAN', label: 'Potong dahan', isActive: true, usedCount: 0 });
    await http(app, token.admin).patch(`/api/v1/repair-methods/${created.body.id}`).send({ isActive: false }).expect(200);
    const crew = await http(app, token.techA).get('/api/v1/maintenance-work/repair-methods').expect(200);
    expect((crew.body as Method[]).map((method) => method.code)).not.toContain('RENTIS_POTONG_DAHAN');
    const all = await http(app, token.admin).get('/api/v1/repair-methods').expect(200);
    expect(all.body.find((row: { code: string }) => row.code === 'RENTIS_LAIN_LAIN').usedCount).toBe(0);
  });
});

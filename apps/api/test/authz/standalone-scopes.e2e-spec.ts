import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * STANDALONE operational scopes (PENCAWANG / FEEDER_PILLAR / LINK_BOX /
 * CABLE_BRIDGE): equipment surveys with NO Pencawang check-in — the crew just
 * adds the equipment and inspects it.
 *
 * The properties that matter:
 *
 *  1. A standalone visit is created from scope alone — no substation, no
 *     KOD/NAMA PENCAWANG; the server derives sessionKind STANDALONE and
 *     requiresQAQC false.
 *  2. IDENTITY — each standalone asset gets a server-assigned tenant-wide
 *     refCode (LB-0001, LB-0002, …), the stable handle for re-inspection. It
 *     doubles as the assetCode when the crew typed none, and TNB's printed ID
 *     rides along as externalRef.
 *  3. The Pencawang rules still hold everywhere else: an asset with no
 *     substation is rejected unless its scope is standalone, and a standalone
 *     asset can only be born in a standalone visit.
 *  4. The inspection + completion paths work without a Pencawang (the
 *     same-substation guard passes on null === null; completion skips the
 *     KOD/NAMA PENCAWANG requirements).
 */
const S = {
  assetType: '40000000-0000-4000-8000-00000000005b',
  template: '50000000-0000-4000-8000-00000000005b',
  section: '50000000-0000-4000-8000-00000000005c',
};

describe('Standalone scopes · add-and-inspect without a Pencawang', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};
  let visitId: string;
  let firstAssetId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    // The owner-created "Link Box" asset type, bound to its scope, with an
    // active checklist template — the same setup admin does for SAVT.
    await prisma.assetType.create({
      data: {
        id: S.assetType,
        tenantId: IDS.tenant.t1,
        code: 'LINK-BOX',
        name: 'Link Box',
        operationalScope: 'LINK_BOX',
      },
    });
    await prisma.inspectionTemplate.create({
      data: {
        id: S.template,
        tenantId: IDS.tenant.t1,
        assetTypeId: S.assetType,
        version: 1,
        name: 'Link Box Checklist',
        status: 'ACTIVE',
        isActive: true,
        scopeLevel: 'GLOBAL',
        sections: {
          create: [{ id: S.section, title: 'General', sortOrder: 0 }],
        },
      },
    });

    token.techA = await login(app, EMAILS.techA);
    token.adminT1 = await login(app, EMAILS.adminT1);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a technician starts a LINK_BOX survey with no Pencawang at all', async () => {
    const res = await http(app, token.techA)
      .post('/api/v1/site-visits')
      .send({ teamId: IDS.team.a, operationalScope: 'LINK_BOX' })
      .expect(201);

    visitId = res.body.id;
    expect(res.body.substationId).toBeNull();
    expect(res.body.operationalScope).toBe('LINK_BOX');
    expect(res.body.sessionKind).toBe('STANDALONE');
    expect(res.body.requiresQAQC).toBe(false);
    expect(res.body.lifecycleStatus).toBe('DALAM_RONDAAN');
    expect(res.body.pencawangCode).toBeNull();
    expect(res.body.pencawangName).toBeNull();
  });

  it('the first Link Box gets refCode LB-0001, doubling as its assetCode', async () => {
    const res = await http(app, token.techA)
      .post('/api/v1/assets')
      .send({
        assetTypeId: S.assetType,
        createdDuringVisitId: visitId,
        name: 'Link Box at Jalan Besar',
        externalRef: 'CKTN/LB/00123',
        latitude: 3.15,
        longitude: 101.7,
      })
      .expect(201);

    firstAssetId = res.body.id;
    expect(res.body.refCode).toBe('LB-0001');
    expect(res.body.assetCode).toBe('LB-0001');
    expect(res.body.externalRef).toBe('CKTN/LB/00123');
    expect(res.body.substationId).toBeNull();
  });

  it('the second gets LB-0002 — numbering is per scope prefix, tenant-wide', async () => {
    const res = await http(app, token.techA)
      .post('/api/v1/assets')
      .send({
        assetTypeId: S.assetType,
        createdDuringVisitId: visitId,
        latitude: 3.16,
        longitude: 101.71,
      })
      .expect(201);

    expect(res.body.refCode).toBe('LB-0002');
    expect(res.body.assetCode).toBe('LB-0002');
  });

  it('inspecting it inside the standalone visit binds the Link Box checklist', async () => {
    const res = await http(app, token.techA)
      .post('/api/v1/inspections')
      .send({ siteVisitId: visitId, assetId: firstAssetId })
      .expect(201);

    expect(res.body.templateId).toBe(S.template);
    expect(res.body.operationalScope).toBe('LINK_BOX');
  });

  it('a SAVR-typed asset with no Pencawang is still rejected', async () => {
    await http(app, token.techA)
      .post('/api/v1/assets')
      .send({ assetTypeId: IDS.assetType.savr, assetCode: 'A 99' })
      .expect(400);
  });

  it('a standalone asset cannot be born into a Pencawang visit', async () => {
    // visit.a is a SAVR Pencawang visit — substationId null ≠ its Pencawang.
    await http(app, token.techA)
      .post('/api/v1/assets')
      .send({ assetTypeId: S.assetType, createdDuringVisitId: IDS.visit.a })
      .expect(404);
  });

  it('the visit completes without KOD/NAMA PENCAWANG', async () => {
    const res = await http(app, token.techA)
      .post(`/api/v1/site-visits/${visitId}/complete`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('COMPLETED');
  });
});

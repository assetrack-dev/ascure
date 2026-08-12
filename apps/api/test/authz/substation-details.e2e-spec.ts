import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * PATCH /substations/:id — edit a Pencawang's name, functional location, and
 * its OWN map coordinate (the office fix for a mis-pointed check-in).
 *
 * Semantics under test:
 *  - a manual coordinate pair WINS over the check-in-derived position;
 *    clearing the pair (null,null) reverts to check-in-derived,
 *  - coordinates only travel as a pair (400 otherwise),
 *  - a rename must not collide with another Pencawang's name/code (the mobile
 *    check-in flow matches an "existing" Pencawang by either, insensitive),
 *  - ADMIN edits anywhere; a MANAGER only where every survey is their own
 *    company's (the cascade-delete own-company rule); TECHNICIAN never.
 */
describe('Authz · Pencawang details edit', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  // Spec-local Pencawang wholly owned by Company A, with one check-in-carrying
  // visit — the manager-allowed case and the derived-coordinate fallback.
  const OWNED_SUB = '30000000-0000-4000-8000-00000000e001';
  const OWNED_VISIT = '40000000-0000-4000-8000-00000000e001';
  const CHECK_IN = { lat: 5.4272, lng: 101.1298 };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    token.admin = await login(app, EMAILS.adminT1);
    token.mgrA = await login(app, EMAILS.mgrA);
    token.techA = await login(app, EMAILS.techA);

    await prisma.substation.upsert({
      where: { id: OWNED_SUB },
      create: {
        id: OWNED_SUB,
        tenantId: IDS.tenant.t1,
        name: 'PENCAWANG EDIT OWNED',
        code: 'PMU-EDIT-A',
      },
      update: { latitude: null, longitude: null, locationSetAt: null, locationSetByEmail: null },
    });
    await prisma.siteVisit.upsert({
      where: { id: OWNED_VISIT },
      create: {
        id: OWNED_VISIT,
        tenantId: IDS.tenant.t1,
        teamId: IDS.team.a,
        substationId: OWNED_SUB,
        createdByUserId: IDS.user.techA,
        organizationId: IDS.org.a,
        status: 'ACTIVE',
        checkInLatitude: CHECK_IN.lat,
        checkInLongitude: CHECK_IN.lng,
      },
      update: {},
    });
  });

  afterAll(async () => {
    await prisma.siteVisit.deleteMany({ where: { id: OWNED_VISIT } });
    await prisma.substation.deleteMany({ where: { id: OWNED_SUB } });
    await app?.close();
  });

  it('ADMIN pins a manual coordinate and it wins over the check-in', async () => {
    const res = await http(app, token.admin)
      .patch(`/api/v1/substations/${OWNED_SUB}`)
      .send({ latitude: 5.483033, longitude: 101.125401 });
    expect(res.status).toBe(200);
    expect(res.body.locationSource).toBe('MANUAL');
    expect(res.body.latitude).toBeCloseTo(5.483033);
    expect(res.body.effectiveLatitude).toBeCloseTo(5.483033);
    expect(res.body.locationSetByEmail).toBe(EMAILS.adminT1);
    expect(res.body.locationSetAt).toBeTruthy();
  });

  it('clearing the pair reverts to the check-in-derived position', async () => {
    const res = await http(app, token.admin)
      .patch(`/api/v1/substations/${OWNED_SUB}`)
      .send({ latitude: null, longitude: null });
    expect(res.status).toBe(200);
    expect(res.body.locationSource).toBe('CHECK_IN');
    expect(res.body.latitude).toBeNull();
    expect(res.body.locationSetAt).toBeNull();
    expect(res.body.effectiveLatitude).toBeCloseTo(CHECK_IN.lat);
    expect(res.body.effectiveLongitude).toBeCloseTo(CHECK_IN.lng);
  });

  it('rejects a half-set coordinate pair (400)', async () => {
    const res = await http(app, token.admin)
      .patch(`/api/v1/substations/${OWNED_SUB}`)
      .send({ latitude: 5.5 });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range coordinate (400)', async () => {
    const res = await http(app, token.admin)
      .patch(`/api/v1/substations/${OWNED_SUB}`)
      .send({ latitude: 95, longitude: 101 });
    expect(res.status).toBe(400);
  });

  it('rejects an empty body (400)', async () => {
    const res = await http(app, token.admin)
      .patch(`/api/v1/substations/${OWNED_SUB}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('edits name + functional location (operational-text normalized)', async () => {
    const res = await http(app, token.admin)
      .patch(`/api/v1/substations/${OWNED_SUB}`)
      .send({ name: 'Pencawang Edit Owned', location: 'jalan besar gerik' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('PENCAWANG EDIT OWNED');
    expect(res.body.location).toBe('JALAN BESAR GERIK');
  });

  it('rejects a rename that collides with another Pencawang (409)', async () => {
    const res = await http(app, token.admin)
      .patch(`/api/v1/substations/${OWNED_SUB}`)
      .send({ name: 'substation 1' });
    expect(res.status).toBe(409);
  });

  it('edits the Kod Pencawang (operational-text normalized)', async () => {
    const res = await http(app, token.admin)
      .patch(`/api/v1/substations/${OWNED_SUB}`)
      .send({ code: 'pmu-edit-a2' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('PMU-EDIT-A2');

    // Restore so the other tests keep matching the fixture code.
    const restore = await http(app, token.admin)
      .patch(`/api/v1/substations/${OWNED_SUB}`)
      .send({ code: 'PMU-EDIT-A' });
    expect(restore.status).toBe(200);
  });

  it('rejects a Kod Pencawang that collides with another Pencawang (409)', async () => {
    // PMU-1 is fixture substation s1's code.
    const res = await http(app, token.admin)
      .patch(`/api/v1/substations/${OWNED_SUB}`)
      .send({ code: 'pmu-1' });
    expect(res.status).toBe(409);
  });

  it('MANAGER edits a Pencawang wholly owned by their company', async () => {
    const res = await http(app, token.mgrA)
      .patch(`/api/v1/substations/${OWNED_SUB}`)
      .send({ latitude: 5.4, longitude: 101.1 });
    expect(res.status).toBe(200);
    expect(res.body.locationSource).toBe('MANUAL');
    expect(res.body.locationSetByEmail).toBe(EMAILS.mgrA);
  });

  it("MANAGER cannot edit a Pencawang holding another company's surveys (403)", async () => {
    const res = await http(app, token.mgrA)
      .patch(`/api/v1/substations/${IDS.substation.s1}`)
      .send({ latitude: 5.4, longitude: 101.1 });
    expect(res.status).toBe(403);
  });

  it('TECHNICIAN cannot edit at all (403)', async () => {
    const res = await http(app, token.techA)
      .patch(`/api/v1/substations/${OWNED_SUB}`)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  // Owner decision 2026-08-11: managers EDIT but never DELETE — the cascade
  // path (which used to allow an own-company MANAGER) is ADMIN-only now.
  it('MANAGER cannot preview a Pencawang delete (403)', async () => {
    const res = await http(app, token.mgrA).get(
      `/api/v1/substations/${OWNED_SUB}/delete-preview`,
    );
    expect(res.status).toBe(403);
  });

  it('MANAGER cannot cascade-delete even a wholly-owned Pencawang (403)', async () => {
    const res = await http(app, token.mgrA).del(
      `/api/v1/substations/${OWNED_SUB}/cascade`,
    );
    expect(res.status).toBe(403);
  });
});

import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * The crown-jewel regression net: Company A must never reach Company B's WORK &
 * FINDINGS (site-visits, inspections, defects), and a tenant can never reach
 * another tenant's data. Detail reads of another company's resource return 404
 * (the row is filtered out of `findFirst`, then NotFound is thrown); list/feed
 * endpoints simply exclude it.
 */
describe('Authz · cross-company isolation (work & findings are org-private)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    token.techA = await login(app, EMAILS.techA);
    token.techB = await login(app, EMAILS.techB);
    token.adminT1 = await login(app, EMAILS.adminT1);
    token.adminT2 = await login(app, EMAILS.adminT2);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('site-visits', () => {
    it('list is scoped: techA sees its own visit, never company B', async () => {
      const res = await http(app, token.techA).get('/api/v1/site-visits');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.visit.a);
      expect(body).not.toContain(IDS.visit.b);
    });

    it('detail: techA can read its own visit (200)', () =>
      http(app, token.techA).get(`/api/v1/site-visits/${IDS.visit.a}`).expect(200));

    it('detail: techA cannot read company B visit (404)', () =>
      http(app, token.techA).get(`/api/v1/site-visits/${IDS.visit.b}`).expect(404));

    it('admin sees both companies', async () => {
      const res = await http(app, token.adminT1).get('/api/v1/site-visits');
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.visit.a);
      expect(body).toContain(IDS.visit.b);
    });

    it('cross-tenant: admin of tenant 2 cannot read tenant 1 visit (404)', () =>
      http(app, token.adminT2).get(`/api/v1/site-visits/${IDS.visit.a}`).expect(404));

    it('cross-tenant: admin of tenant 2 sees none of tenant 1 visits', async () => {
      const res = await http(app, token.adminT2).get('/api/v1/site-visits');
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(IDS.visit.a);
    });
  });

  describe('defects', () => {
    it('list is scoped to company A for techA', async () => {
      const res = await http(app, token.techA).get('/api/v1/defects');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.defect.a);
      expect(body).not.toContain(IDS.defect.b);
    });

    it('detail: techA can read its own defect (200)', () =>
      http(app, token.techA).get(`/api/v1/defects/${IDS.defect.a}`).expect(200));

    it('detail: techA cannot read company B defect (404)', () =>
      http(app, token.techA).get(`/api/v1/defects/${IDS.defect.b}`).expect(404));
  });

  describe('inspections', () => {
    it('detail: techA can read its own inspection (200)', () =>
      http(app, token.techA).get(`/api/v1/inspections/${IDS.inspection.a}`).expect(200));

    it('detail: techA cannot read company B inspection (404)', () =>
      http(app, token.techA).get(`/api/v1/inspections/${IDS.inspection.b}`).expect(404));

    it('form: techA cannot read company B inspection form (404)', () =>
      http(app, token.techA).get(`/api/v1/inspections/${IDS.inspection.b}/form`).expect(404));
  });

  describe('assets/map feed', () => {
    it('map is scoped: techA sees its own asset, not company B', async () => {
      const res = await http(app, token.techA).get('/api/v1/assets/map');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.asset.a);
      expect(body).not.toContain(IDS.asset.b);
    });
  });

  describe('dashboard', () => {
    it('does not leak company B identifiers to techA', async () => {
      const res = await http(app, token.techA).get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(IDS.visit.b);
      expect(body).not.toContain(IDS.defect.b);
      expect(body).not.toContain(IDS.asset.b);
    });
  });

  // DECISION (owner, 2026-07-06): the bare GET /assets register — the admin-web
  // Assets table — is now scoped to the caller's own company. techA (company A)
  // must not see company B's asset in the list. The substation-filtered
  // GET /assets?substation_id + the /assets/map read stay tenant-wide by design,
  // so mobile crews still see shared poles to avoid double-inspecting one.
  it('scopes the bare GET /assets register to the caller company', async () => {
    const res = await http(app, token.techA).get('/api/v1/assets');
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain(IDS.asset.a);
    expect(body).not.toContain(IDS.asset.b);
  });

  /**
   * Minting a share link PUBLISHES a pole to an unauthenticated public URL, so
   * it is the sharpest edge of cross-company isolation. This was tenant-scoped
   * only until 2026-08-10 — any authenticated non-admin could publish ANY pole
   * in the tenant by id, company B's included. The rule now: you may share what
   * you may already SEE.
   */
  describe('share links are scoped to what the caller can see', () => {
    it('techA can share its own company pole', () =>
      http(app, token.techA)
        .post(`/api/v1/share/asset/${IDS.asset.a}`)
        .send({ expiresInDays: 7 })
        .expect(201));

    it('techA CANNOT share company B pole', () =>
      http(app, token.techA)
        .post(`/api/v1/share/asset/${IDS.asset.b}`)
        .send({ expiresInDays: 7 })
        .expect(404));

    it('a MANAGER cannot share another company pole either', async () => {
      const mgrA = await login(app, EMAILS.mgrA);
      await http(app, mgrA)
        .post(`/api/v1/share/asset/${IDS.asset.b}`)
        .send({ expiresInDays: 30 })
        .expect(404);
    });

    it('ADMIN still shares tenant-wide', () =>
      http(app, token.adminT1)
        .post(`/api/v1/share/asset/${IDS.asset.b}`)
        .send({ expiresInDays: 30 })
        .expect(201));

    it('a cross-TENANT admin cannot reach it at all', () =>
      http(app, token.adminT2)
        .post(`/api/v1/share/asset/${IDS.asset.a}`)
        .send({ expiresInDays: 30 })
        .expect(404));
  });
});

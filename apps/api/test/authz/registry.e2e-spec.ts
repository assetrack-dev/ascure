import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * The lazy Assets/Defects drill-down feeds (GET /assets/registry and
 * GET /defects/registry) must carry EXACTLY the same visibility as the legacy
 * full lists they replace: company A never counts or lists company B's poles or
 * findings, cross-tenant sees nothing, and the leaf/search levels behave.
 */
describe('Authz · registry drill-down feeds (assets + defects)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    token.techA = await login(app, EMAILS.techA);
    token.adminT1 = await login(app, EMAILS.adminT1);
    token.adminT2 = await login(app, EMAILS.adminT2);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('assets registry', () => {
    it('rollup is scoped: techA counts fewer assets than the tenant admin', async () => {
      const [techRes, adminRes] = await Promise.all([
        http(app, token.techA).get('/api/v1/assets/registry?level=region'),
        http(app, token.adminT1).get('/api/v1/assets/registry?level=region'),
      ]);
      expect(techRes.status).toBe(200);
      expect(adminRes.status).toBe(200);
      expect(techRes.body.totals.assetCount).toBeGreaterThan(0);
      expect(adminRes.body.totals.assetCount).toBeGreaterThan(
        techRes.body.totals.assetCount,
      );
    });

    it('leaf lists only company A poles for techA', async () => {
      const res = await http(app, token.techA).get(
        `/api/v1/assets/registry?level=assets&pencawangId=${IDS.substation.s1}`,
      );
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.asset.a);
      expect(body).not.toContain(IDS.asset.b);
    });

    it('leaf lists both companies for the tenant admin', async () => {
      const res = await http(app, token.adminT1).get(
        `/api/v1/assets/registry?level=assets&pencawangId=${IDS.substation.s1}`,
      );
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.asset.a);
      expect(body).toContain(IDS.asset.b);
    });

    it('leaf without a pencawangId is rejected (400)', () =>
      http(app, token.adminT1)
        .get('/api/v1/assets/registry?level=assets')
        .expect(400));

    it('search is scoped: techA cannot find company B poles by code', async () => {
      const [techRes, adminRes] = await Promise.all([
        http(app, token.techA).get('/api/v1/assets/registry?search=B-1'),
        http(app, token.adminT1).get('/api/v1/assets/registry?search=B-1'),
      ]);
      expect(techRes.status).toBe(200);
      expect(JSON.stringify(techRes.body)).not.toContain(IDS.asset.b);
      expect(JSON.stringify(adminRes.body)).toContain(IDS.asset.b);
    });

    it('cross-tenant: tenant 2 admin counts none of tenant 1', async () => {
      const res = await http(app, token.adminT2).get(
        '/api/v1/assets/registry?level=region',
      );
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(IDS.asset.a);
    });
  });

  describe('defects registry', () => {
    it('rollup counts only reachable defects for techA', async () => {
      const res = await http(app, token.techA).get(
        '/api/v1/defects/registry?level=region',
      );
      expect(res.status).toBe(200);
      expect(res.body.totals.defectCount).toBeGreaterThan(0);
    });

    it('leaf lists only company A defects for techA', async () => {
      const res = await http(app, token.techA).get(
        `/api/v1/defects/registry?level=defects&pencawangId=${IDS.substation.s1}`,
      );
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.defect.a);
      expect(body).not.toContain(IDS.defect.b);
    });

    it('leaf lists both companies for the tenant admin', async () => {
      const res = await http(app, token.adminT1).get(
        `/api/v1/defects/registry?level=defects&pencawangId=${IDS.substation.s1}`,
      );
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.defect.a);
      expect(body).toContain(IDS.defect.b);
    });

    it('leaf without a pencawangId is rejected (400)', () =>
      http(app, token.adminT1)
        .get('/api/v1/defects/registry?level=defects')
        .expect(400));

    it('search is scoped: techA cannot find company B defects by pole code', async () => {
      const [techRes, adminRes] = await Promise.all([
        http(app, token.techA).get('/api/v1/defects/registry?search=B-1'),
        http(app, token.adminT1).get('/api/v1/defects/registry?search=B-1'),
      ]);
      expect(techRes.status).toBe(200);
      expect(JSON.stringify(techRes.body)).not.toContain(IDS.defect.b);
      expect(JSON.stringify(adminRes.body)).toContain(IDS.defect.b);
    });
  });
});

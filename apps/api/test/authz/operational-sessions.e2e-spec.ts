import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * OperationalSession has its OWN access scope, distinct from the team-membership
 * matrix that governs site-visits/inspections/defects: a session is visible iff
 * the caller is its assigned QA reviewer (assignedQaUserId) OR the session is
 * assigned to one of the caller's organizations (assignedCompanyId ∈ user's
 * orgs) — always AND'd with workspaceId = the caller's tenant. This pins both OR
 * branches plus the tenant boundary.
 *
 * Seed: session A → company A; session B → company B but with supA (a company-A
 * user) as its QA, so supA reaches B via the QA branch while techA cannot.
 */
describe('Authz · operational-sessions (company + QA assignment scope)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    token.techA = await login(app, EMAILS.techA);
    token.supA = await login(app, EMAILS.supA);
    token.adminT1 = await login(app, EMAILS.adminT1);
    token.adminT2 = await login(app, EMAILS.adminT2);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('list scoping', () => {
    it('a company-A user sees company A\'s session, never company B\'s', async () => {
      const res = await http(app, token.techA).get('/api/v1/operational-sessions');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.session.a);
      expect(body).not.toContain(IDS.session.b);
    });

    it('a user named as QA on company B\'s session reaches it via the QA branch (plus their own company\'s)', async () => {
      const res = await http(app, token.supA).get('/api/v1/operational-sessions');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.session.a); // own company A
      expect(body).toContain(IDS.session.b); // assigned as QA on B
    });

    it('admin sees both companies\' sessions', async () => {
      const res = await http(app, token.adminT1).get('/api/v1/operational-sessions');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.session.a);
      expect(body).toContain(IDS.session.b);
    });
  });

  describe('detail scoping', () => {
    it('a company-A user can read company A\'s session (200)', () =>
      http(app, token.techA).get(`/api/v1/operational-sessions/${IDS.session.a}`).expect(200));

    it('a company-A user cannot read company B\'s session (404)', () =>
      http(app, token.techA).get(`/api/v1/operational-sessions/${IDS.session.b}`).expect(404));

    it('cross-tenant: admin of tenant 2 cannot read tenant 1\'s session (404)', () =>
      http(app, token.adminT2).get(`/api/v1/operational-sessions/${IDS.session.a}`).expect(404));
  });
});

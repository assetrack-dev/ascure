import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * Management-list scoping: a MANAGER administering users/teams must only see
 * their OWN company's rows (the org filter is hardcoded in the services, not
 * query-overridable), while an ADMIN sees the whole tenant. This complements the
 * mutation gates in roles.e2e-spec.ts (a manager can't create an ADMIN, can't
 * touch another company's team).
 */
describe('Authz · management list scoping (manager = own company only)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    token.mgrA = await login(app, EMAILS.mgrA);
    token.adminT1 = await login(app, EMAILS.adminT1);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /users', () => {
    it('manager A sees company A users, never company B', async () => {
      const res = await http(app, token.mgrA).get('/api/v1/users');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.user.techA);
      expect(body).not.toContain(IDS.user.techB);
      expect(body).not.toContain(IDS.user.mgrB);
    });

    it('admin sees users from both companies', async () => {
      const res = await http(app, token.adminT1).get('/api/v1/users');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.user.techA);
      expect(body).toContain(IDS.user.techB);
    });

    it("shows each phone's last unsent-items report to its manager", async () => {
      const techToken = await login(app, EMAILS.techA);
      await http(app, techToken)
        .post('/api/v1/sync/heartbeat')
        .send({ pendingMutationCount: 3 })
        .expect((res) => expect(res.status).toBeLessThan(300));

      const res = await http(app, token.mgrA).get('/api/v1/users');
      expect(res.status).toBe(200);
      const techA = (res.body as Array<{ id: string; syncPendingCount: number; syncReportedAt: string | null }>)
        .find((row) => row.id === IDS.user.techA);
      expect(techA?.syncPendingCount).toBe(3);
      expect(techA?.syncReportedAt).toBeTruthy();

      // Back to 0 — a non-zero count gates team reassignment in other suites.
      await http(app, techToken).post('/api/v1/sync/heartbeat').send({ pendingMutationCount: 0 });
    });
  });

  describe('GET /teams', () => {
    it('manager A sees company A teams, never company B', async () => {
      const res = await http(app, token.mgrA).get('/api/v1/teams');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.team.a);
      expect(body).not.toContain(IDS.team.b);
    });

    it('admin sees teams from both companies', async () => {
      const res = await http(app, token.adminT1).get('/api/v1/teams');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.team.a);
      expect(body).toContain(IDS.team.b);
    });
  });
});

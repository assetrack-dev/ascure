import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { getTestPrisma } from '../utils/prisma';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * Role / privilege gates: the state machine and role allow-lists that keep a
 * lower role (or a manager in the wrong company) from escalating. Includes the
 * regression lock for the Deploy-44 fix (a manager could orphan/move a team into
 * another company via `organizationId: null`).
 */
describe('Authz · roles & privilege gates', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    token.techA = await login(app, EMAILS.techA);
    token.mgrA = await login(app, EMAILS.mgrA);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects unauthenticated access to a protected route (401)', () =>
    request(app.getHttpServer()).get('/api/v1/site-visits').expect(401));

  it('technician cannot create a team (403)', () =>
    http(app, token.techA)
      .post('/api/v1/teams')
      .send({ name: 'Rogue Team', code: 'RG1' })
      .expect(403));

  it('technician cannot create a user (403)', () =>
    http(app, token.techA)
      .post('/api/v1/users')
      .send({ name: 'Rogue User', email: 'rogue@authz.test', role: 'TECHNICIAN' })
      .expect(403));

  it('manager cannot create an ADMIN account (403)', () =>
    http(app, token.mgrA)
      .post('/api/v1/users')
      .send({ name: 'Sneaky Admin', email: 'sneaky-admin@authz.test', role: 'ADMIN' })
      .expect(403));

  it('manager CAN create a technician in their own company (201)', () =>
    http(app, token.mgrA)
      .post('/api/v1/users')
      .send({ name: 'New Tech A', email: 'new-tech-a@authz.test', role: 'TECHNICIAN' })
      .expect(201));

  describe('Deploy-44 regression lock — team org-scope', () => {
    it('manager cannot edit another company\'s team (403)', () =>
      http(app, token.mgrA)
        .patch(`/api/v1/teams/${IDS.team.b}`)
        .send({ name: 'Hijacked' })
        .expect(403));

    it('manager cannot MOVE their own team into another company (403)', () =>
      http(app, token.mgrA)
        .patch(`/api/v1/teams/${IDS.team.a}`)
        .send({ organizationId: IDS.org.b })
        .expect(403));

    it('organizationId:null is clamped to the manager\'s own org, never orphaned', async () => {
      await http(app, token.mgrA)
        .patch(`/api/v1/teams/${IDS.team.a}`)
        .send({ organizationId: null })
        .expect(200);
      const team = await getTestPrisma().team.findUnique({ where: { id: IDS.team.a } });
      expect(team?.organizationId).toBe(IDS.org.a);
    });
  });
});

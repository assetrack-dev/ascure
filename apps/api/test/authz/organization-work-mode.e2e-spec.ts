import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS, TEST_PASSWORD } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Per-company web view (docs/PLAN-maintenance-flow.md §17, L38–L39).
 *
 *  1. ADMIN sets / clears `Organization.workMode`; anyone else is 403; bad values 400.
 *  2. login + /auth/me surface the company's mode to its users.
 *  3. Only an active contractor company carries a mode — ADMIN users and
 *     non-contractor orgs (TNB) always get null (full console / client view).
 *
 * Restores Company B's mode and removes its own TNB org + user.
 */
const T = {
  tnbOrg: '0e000000-0000-4000-8000-0000000000c1',
  tnbUser: '0e000000-0000-4000-8000-0000000000c2',
  tnbEmail: 'client.workmode@authz.test',
};

describe('Authz · organization work mode', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    token.admin = await login(app, EMAILS.adminT1);
    token.mgrA = await login(app, EMAILS.mgrA);

    const seed = await prisma.user.findUniqueOrThrow({
      where: { id: IDS.user.mgrA },
      select: { passwordHash: true },
    });
    await prisma.organization.create({
      data: {
        id: T.tnbOrg,
        tenantId: IDS.tenant.t1,
        name: 'TNB (work mode spec)',
        type: 'TNB',
        isActive: true,
        workMode: 'MAINTENANCE',
      },
    });
    await prisma.user.create({
      data: {
        id: T.tnbUser,
        tenantId: IDS.tenant.t1,
        email: T.tnbEmail,
        name: 'TNB viewer',
        passwordHash: seed.passwordHash,
        role: 'CLIENT',
        organizationId: T.tnbOrg,
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.update({ where: { id: IDS.org.b }, data: { workMode: null } });
    await prisma.user.deleteMany({ where: { id: T.tnbUser } });
    await prisma.organization.deleteMany({ where: { id: T.tnbOrg } });
    await app?.close();
  });

  it('unset by default: a contractor manager gets null (full console)', async () => {
    const me = await http(app, token.mgrA).get('/api/v1/auth/me').expect(200);
    expect(me.body.workMode).toBeNull();
  });

  it('admin sets MAINTENANCE; login + /auth/me return it', async () => {
    const res = await http(app, token.admin)
      .patch(`/api/v1/enterprise/organizations/${IDS.org.b}`)
      .send({ workMode: 'MAINTENANCE' })
      .expect(200);
    expect(res.body.workMode).toBe('MAINTENANCE');

    const loginRes = await http(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAILS.mgrB, password: TEST_PASSWORD })
      .expect(201);
    expect(loginRes.body.user.workMode).toBe('MAINTENANCE');

    token.mgrB = await login(app, EMAILS.mgrB);
    const me = await http(app, token.mgrB).get('/api/v1/auth/me').expect(200);
    expect(me.body.workMode).toBe('MAINTENANCE');
  });

  it('an unknown mode is rejected (400)', () =>
    http(app, token.admin)
      .patch(`/api/v1/enterprise/organizations/${IDS.org.b}`)
      .send({ workMode: 'REPAIRS' })
      .expect(400));

  it('a manager cannot set a work mode (403)', () =>
    http(app, token.mgrA)
      .patch(`/api/v1/enterprise/organizations/${IDS.org.a}`)
      .send({ workMode: 'SURVEY' })
      .expect(403));

  it('admin clears it with null', async () => {
    const res = await http(app, token.admin)
      .patch(`/api/v1/enterprise/organizations/${IDS.org.b}`)
      .send({ workMode: null })
      .expect(200);
    expect(res.body.workMode).toBeNull();
    const me = await http(app, token.mgrB).get('/api/v1/auth/me').expect(200);
    expect(me.body.workMode).toBeNull();
  });

  it('ADMIN users and non-contractor orgs never carry a mode', async () => {
    const adminMe = await http(app, token.admin).get('/api/v1/auth/me').expect(200);
    expect(adminMe.body.workMode).toBeNull();

    token.tnb = await login(app, T.tnbEmail);
    const tnbMe = await http(app, token.tnb).get('/api/v1/auth/me').expect(200);
    expect(tnbMe.body.workMode).toBeNull();
  });
});

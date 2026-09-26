import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * TNB maintenance rank (docs/PLAN-maintenance-flow.md §4.2, M1 step 1).
 *
 *  1. ADMIN provisions TNB users with a rank; login + /auth/me surface the rank
 *     and `canActOnMaintenanceAsClient` (FOREMAN/TECHNICIAN true, ENGINEER false).
 *  2. A rank is ONLY valid on a CLIENT user in a TNB org — anywhere else is 400.
 *  3. A rank never outlives its preconditions: moving the user out of TNB (or off
 *     the CLIENT role) clears it.
 *  4. A MANAGER can never grant a rank (the field is stripped).
 *  5. A deactivated TNB org loses its authority without touching the user row.
 *
 * Self-contained: creates and removes its own TNB org + users.
 */
const T = {
  org: '0e000000-0000-4000-8000-0000000000a1',
  email: {
    foreman: 'foreman.tnb@authz.test',
    engineer: 'engineer.tnb@authz.test',
  },
};

describe('Authz · TNB client rank', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    token.admin = await login(app, EMAILS.adminT1);
    token.mgrA = await login(app, EMAILS.mgrA);

    await prisma.organization.create({
      data: {
        id: T.org,
        tenantId: IDS.tenant.t1,
        name: 'TNB (rank spec)',
        type: 'TNB',
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.organization.deleteMany({ where: { id: T.org } });
    await app?.close();
  });

  /** Creates a TNB CLIENT user via the API and sets a known password. */
  async function createTnbUser(email: string, clientRank: string) {
    const res = await http(app, token.admin)
      .post('/api/v1/users')
      .send({
        name: `TNB ${clientRank}`,
        email,
        role: 'CLIENT',
        organizationId: T.org,
        clientRank,
      })
      .expect(201);
    const id = (res.body.user?.id ?? res.body.id) as string;
    createdUserIds.push(id);
    const seed = await prisma.user.findUniqueOrThrow({
      where: { id: IDS.user.mgrA },
      select: { passwordHash: true },
    });
    await prisma.user.update({
      where: { id },
      data: { passwordHash: seed.passwordHash, mustChangePassword: false },
    });
    return id;
  }

  let foremanId: string;
  let engineerId: string;

  it('admin creates TNB Foreman + Engineer with their ranks (201)', async () => {
    foremanId = await createTnbUser(T.email.foreman, 'FOREMAN');
    engineerId = await createTnbUser(T.email.engineer, 'ENGINEER');
    const rows = await prisma.user.findMany({
      where: { id: { in: [foremanId, engineerId] } },
      select: { id: true, clientRank: true },
    });
    expect(Object.fromEntries(rows.map((r) => [r.id, r.clientRank]))).toEqual({
      [foremanId]: 'FOREMAN',
      [engineerId]: 'ENGINEER',
    });
  });

  it('login + /auth/me: Foreman may act, Engineer is view-only', async () => {
    token.foreman = await login(app, T.email.foreman);
    token.engineer = await login(app, T.email.engineer);

    const foremanMe = await http(app, token.foreman).get('/api/v1/auth/me').expect(200);
    expect(foremanMe.body.clientRank).toBe('FOREMAN');
    expect(foremanMe.body.canActOnMaintenanceAsClient).toBe(true);
    expect(foremanMe.body.isClientViewer).toBe(true);

    const engineerMe = await http(app, token.engineer).get('/api/v1/auth/me').expect(200);
    expect(engineerMe.body.clientRank).toBe('ENGINEER');
    expect(engineerMe.body.canActOnMaintenanceAsClient).toBe(false);
  });

  it('contractor users never act as TNB', async () => {
    const me = await http(app, token.mgrA).get('/api/v1/auth/me').expect(200);
    expect(me.body.clientRank ?? null).toBeNull();
    expect(me.body.canActOnMaintenanceAsClient).toBe(false);
  });

  it('a rank on a non-TNB user is rejected (400)', () =>
    http(app, token.admin)
      .post('/api/v1/users')
      .send({
        name: 'Contractor with rank',
        email: 'rank-contractor@authz.test',
        role: 'TECHNICIAN',
        organizationId: IDS.org.a,
        clientRank: 'FOREMAN',
      })
      .expect(400));

  it('a rank on a non-CLIENT role inside TNB is rejected (400)', () =>
    http(app, token.admin)
      .patch(`/api/v1/users/${engineerId}`)
      .send({ role: 'MANAGER', clientRank: 'ENGINEER' })
      .expect(400));

  it('a manager cannot grant a rank (field stripped)', async () => {
    const res = await http(app, token.mgrA)
      .post('/api/v1/users')
      .send({
        name: 'Mgr-made tech',
        email: 'rank-mgr-made@authz.test',
        role: 'TECHNICIAN',
        clientRank: 'FOREMAN',
      })
      .expect(201);
    const id = (res.body.user?.id ?? res.body.id) as string;
    createdUserIds.push(id);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { clientRank: true },
    });
    expect(row.clientRank).toBeNull();
  });

  it('a deactivated TNB org loses authority', async () => {
    await prisma.organization.update({ where: { id: T.org }, data: { isActive: false } });
    try {
      const me = await http(app, token.foreman).get('/api/v1/auth/me').expect(200);
      expect(me.body.canActOnMaintenanceAsClient).toBe(false);
    } finally {
      await prisma.organization.update({ where: { id: T.org }, data: { isActive: true } });
    }
  });

  it('moving the user out of TNB clears the rank', async () => {
    await http(app, token.admin)
      .patch(`/api/v1/users/${foremanId}`)
      .send({ organizationId: IDS.org.a, role: 'TECHNICIAN' })
      .expect(200);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: foremanId },
      select: { clientRank: true },
    });
    expect(row.clientRank).toBeNull();
  });

  it('admin can clear a rank explicitly', async () => {
    await http(app, token.admin)
      .patch(`/api/v1/users/${engineerId}`)
      .send({ clientRank: null })
      .expect(200);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: engineerId },
      select: { clientRank: true },
    });
    expect(row.clientRank).toBeNull();
  });
});

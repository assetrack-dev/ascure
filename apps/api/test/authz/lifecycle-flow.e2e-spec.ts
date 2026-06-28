import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * DC-first survey review flow — the lifecycle ROUTING (lifecycle-gates.e2e covers
 * the role/scope gates). The crew submits straight to the DC; the team's MANAGER
 * is pulled in only on the amendment path to verify the rework. Drives the
 * dedicated IDS.visit.lifecycle visit so the mutations don't leak into other
 * specs:
 *
 *   crew completes → RONDAAN SELESAI (DC) → DC bounce → PERLU PINDAAN →
 *   crew re-completes → PINDAAN SELESAI (manager) → manager re-issues →
 *   RONDAAN SELESAI.
 *
 * Plus the negative gates: a manager can't act on a fresh RONDAAN SELESAI, and
 * the DC can't act on a PINDAAN SELESAI (it's the manager's recheck).
 */
describe('Authz · DC-first survey lifecycle flow', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const base = `/api/v1/site-visits/${IDS.visit.lifecycle}`;

  beforeAll(async () => {
    app = await createTestApp();
    token.techA = await login(app, EMAILS.techA); // crew
    token.mgrA = await login(app, EMAILS.mgrA); // manager (own company)
    token.adminT1 = await login(app, EMAILS.adminT1); // acts as DC (ADMIN governance)
  });

  afterAll(async () => {
    await app?.close();
  });

  const expectOk = (res: { status: number }) =>
    expect(res.status).toBeLessThan(300);

  async function lifecycleStatus(): Promise<string | null> {
    const res = await http(app, token.adminT1).get(base).expect(200);
    return res.body?.lifecycle?.status ?? null;
  }

  it('routes a first submission to the DC and amendments through the manager', async () => {
    // 1. Crew completes a first survey → straight to the DC (RONDAAN SELESAI).
    expectOk(await http(app, token.techA).post(`${base}/complete`).send({}));
    expect(await lifecycleStatus()).toBe('RONDAAN_SELESAI');

    // 2. The MANAGER cannot act on a fresh first submission (not PINDAAN SELESAI).
    await http(app, token.mgrA).post(`${base}/lifecycle/manager-approve`).expect(400);

    // 3. The DC sends it back for amendment directly from RONDAAN SELESAI.
    expectOk(
      await http(app, token.adminT1)
        .post(`${base}/lifecycle/request-amendment`)
        .send({ remark: 'Fix the clearance reading on pole LC-1.' }),
    );
    expect(await lifecycleStatus()).toBe('PERLU_PINDAAN');

    // 4. The crew re-completes the amendment → routes to the MANAGER (PINDAAN SELESAI).
    expectOk(await http(app, token.techA).post(`${base}/complete`).send({}));
    expect(await lifecycleStatus()).toBe('PINDAAN_SELESAI');

    // 5. The DC cannot act on a PINDAAN SELESAI (it's the manager's recheck).
    await http(app, token.adminT1)
      .post(`${base}/lifecycle/request-amendment`)
      .send({ remark: 'should be blocked' })
      .expect(400);

    // 6. The MANAGER verifies the fixes and re-issues to the DC (RONDAAN SELESAI).
    expectOk(await http(app, token.mgrA).post(`${base}/lifecycle/manager-approve`));
    expect(await lifecycleStatus()).toBe('RONDAAN_SELESAI');

    // 7. The MANAGER can also bounce an inadequate amendment back to the crew
    //    (PINDAAN SELESAI → PERLU PINDAAN).
    expectOk(
      await http(app, token.adminT1)
        .post(`${base}/lifecycle/request-amendment`)
        .send({ remark: 'one more fix' }),
    );
    expectOk(await http(app, token.techA).post(`${base}/complete`).send({}));
    expect(await lifecycleStatus()).toBe('PINDAAN_SELESAI');
    expectOk(
      await http(app, token.mgrA)
        .post(`${base}/lifecycle/manager-request-amendment`)
        .send({ remark: 'still not done' }),
    );
    expect(await lifecycleStatus()).toBe('PERLU_PINDAAN');
  });
});

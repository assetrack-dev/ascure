import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * R4 — privilege escalation / lifecycle-gate bypass. The survey review chain is
 * technician/supervisor → MANAGER → DC, and each transition is gated INSIDE the
 * service (the controller only mounts JwtAuthGuard + RolesGuard). Calibration
 * established the check order: role/capability is asserted BEFORE the visit is
 * loaded, so:
 *   - a technician calling a manager/DC/reporting transition → 403 (role first),
 *     regardless of the visit's state;
 *   - a manager of ANOTHER company → 404 (role passes, then the access scope
 *     filters the visit out);
 *   - a manager of the OWN company on a wrong-state visit → 400 (role passes,
 *     reaches the state gate) — which proves the gate discriminates by role.
 *
 * Seed visits are DALAM_RONDAAN, so none of these transitions can succeed; that
 * keeps the suite state-independent (no mutation leaks across spec files).
 */
describe('Authz · survey lifecycle privilege gates (R4)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};
  const visitA = `/api/v1/site-visits/${IDS.visit.a}`;

  beforeAll(async () => {
    app = await createTestApp();
    token.techA = await login(app, EMAILS.techA);
    token.mgrA = await login(app, EMAILS.mgrA);
    token.mgrB = await login(app, EMAILS.mgrB);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('a technician cannot drive manager / DC / reporting transitions (403, role gate first)', () => {
    it('manager-approve → 403', () =>
      http(app, token.techA).post(`${visitA}/lifecycle/manager-approve`).expect(403));

    it('manager-request-amendment → 403', () =>
      http(app, token.techA)
        .post(`${visitA}/lifecycle/manager-request-amendment`)
        .send({ remark: 'should not be allowed' })
        .expect(403));

    it('generate-report → 403', () =>
      http(app, token.techA).post(`${visitA}/lifecycle/generate-report`).expect(403));

    it('request-amendment (DC/QA) → 403', () =>
      http(app, token.techA)
        .post(`${visitA}/lifecycle/request-amendment`)
        .send({ remark: 'should not be allowed' })
        .expect(403));
  });

  describe('manager role gate vs company scope', () => {
    it('a manager passes the role gate on their own visit — reaches the state check (400, not 403)', () =>
      http(app, token.mgrA).post(`${visitA}/lifecycle/manager-approve`).expect(400));

    it('a manager of another company cannot approve this visit (404 — filtered out of scope)', () =>
      http(app, token.mgrB).post(`${visitA}/lifecycle/manager-approve`).expect(404));
  });
});

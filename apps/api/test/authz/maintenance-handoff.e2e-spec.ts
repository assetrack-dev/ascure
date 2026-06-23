import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * Maintenance handoff (the RELEASE_ON_REPORT cross-company path). When a defect
 * is released at LAPORAN SELESAI it is stamped with the MAINHEAD's registered
 * maintenance organization (Defect.maintenanceOrganizationId). The maint-org
 * branch of defectAccessScope then grants that maintenance company visibility of
 * its routed pool ACROSS the inspecting-team boundary — intentional cross-company
 * sharing — but strictly bounded: only defects stamped with the company's org,
 * still tenant-scoped, still requiring a SUBMITTED inspection.
 *
 * Seed: `defect.routed` sits on company A's SUBMITTED inspection but is stamped to
 * MaintCo (a maintenance company, not an inspecting one). This pins that the
 * routing grants exactly the right visibility and nothing more. The access-scope
 * branch is mode-independent, so this holds regardless of DEFECT_GOVERNANCE_MODE;
 * the mode only governs WHEN the stamp is applied.
 */
describe('Authz · maintenance handoff (RELEASE_ON_REPORT routed-pool visibility)', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    token.maintUser = await login(app, EMAILS.maintUser);
    token.techA = await login(app, EMAILS.techA);
    token.techB = await login(app, EMAILS.techB);
    token.adminT2 = await login(app, EMAILS.adminT2);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('the maintenance company sees a defect routed to it, across the inspecting-team boundary (200)', () =>
    http(app, token.maintUser).get(`/api/v1/defects/${IDS.defect.routed}`).expect(200));

  it('but the maintenance company does NOT see the inspecting company\'s un-routed defects (404)', () =>
    http(app, token.maintUser).get(`/api/v1/defects/${IDS.defect.a}`).expect(404));

  it('the maintenance company\'s defect list is exactly its routed pool', async () => {
    const res = await http(app, token.maintUser).get('/api/v1/defects');
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain(IDS.defect.routed);
    expect(body).not.toContain(IDS.defect.a);
    expect(body).not.toContain(IDS.defect.b);
  });

  it('the inspecting team still sees the routed defect (inspection-side visibility retained) (200)', () =>
    http(app, token.techA).get(`/api/v1/defects/${IDS.defect.routed}`).expect(200));

  it('an unrelated inspection company cannot see the routed defect (404)', () =>
    http(app, token.techB).get(`/api/v1/defects/${IDS.defect.routed}`).expect(404));

  it('cross-tenant: an admin of another tenant cannot see the routed defect (404)', () =>
    http(app, token.adminT2).get(`/api/v1/defects/${IDS.defect.routed}`).expect(404));
});

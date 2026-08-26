import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * MANAGER reject-then-fix flow (mobile): a manager who sends a pole back for
 * re-inspection must be able to run the inspection themself — resolve the
 * checklist template and open an inspection on their OWN COMPANY's team visit.
 * Both paths used to load the visit through a narrow own-team-membership
 * filter, which 404'd for managers (they oversee teams but aren't members) and
 * surfaced on mobile as a bogus "No active SAVR checklist template found".
 *
 * The company boundary must NOT widen with the fix: another company's manager
 * still 404s, and a MAIN_CONTRACTOR manager still cannot act on a
 * subcontractor's visit (oversight is read-only; mutations stay strict own-org).
 *
 * Seed-safe: the positive create targets (visit.a, asset.a), which already
 * carries inspection.a — the create endpoint is idempotent per (asset, visit)
 * and returns the existing inspection, so nothing new is written. The negative
 * cases are rejected before any state change.
 */
describe('Authz · manager inspect on own company visit (create + template resolve)', () => {
  let app: INestApplication;
  let mgrA: string;
  let mgrB: string;

  beforeAll(async () => {
    app = await createTestApp();
    mgrA = await login(app, EMAILS.mgrA);
    mgrB = await login(app, EMAILS.mgrB);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("mgrA CAN open an inspection on their company's team visit (idempotent return of the existing one)", async () => {
    const res = await http(app, mgrA)
      .post('/api/v1/inspections')
      .send({ siteVisitId: IDS.visit.a, assetId: IDS.asset.a })
      .expect(201);
    expect(res.body.id).toBe(IDS.inspection.a);
  });

  it("mgrA CAN resolve the checklist template for their company's visit", () =>
    http(app, mgrA)
      .get('/api/v1/inspection-templates/resolve')
      .query({ siteVisitId: IDS.visit.a, assetTypeId: IDS.assetType.savr })
      .expect(200));

  it("mgrB cannot open an inspection on company A's visit (404)", () =>
    http(app, mgrB)
      .post('/api/v1/inspections')
      .send({ siteVisitId: IDS.visit.a, assetId: IDS.asset.a })
      .expect(404));

  it("mgrB cannot resolve a template against company A's visit (404)", () =>
    http(app, mgrB)
      .get('/api/v1/inspection-templates/resolve')
      .query({ siteVisitId: IDS.visit.a, assetTypeId: IDS.assetType.savr })
      .expect(404));

  it("mgrA cannot open an inspection on their SUBCONTRACTOR's visit (oversight is read-only — 404)", () =>
    http(app, mgrA)
      .post('/api/v1/inspections')
      .send({ siteVisitId: IDS.sub.visit, assetId: IDS.sub.asset })
      .expect(404));
});

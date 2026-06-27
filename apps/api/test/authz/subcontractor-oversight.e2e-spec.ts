import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * Main-contractor read-only oversight (siteVisitOversightWhere).
 *
 * A MAIN_CONTRACTOR manager gains READ-ONLY visibility of its SUBCONTRACTOR
 * subtree's work — the site visits / inspections / asset register / map of work
 * it delegated — WITHOUT any write access. Every mutation gate stays own-org
 * strict (siteVisitAccessWhere / findAccessibleSiteVisit / getAccessibleInspection),
 * so the main contractor can monitor but never complete / reassign / amend / join
 * a subcontractor's work. Visibility is bounded to the subtree (downward only):
 * an unrelated main contractor sees none of it, and the subcontractor's own
 * manager does not see the parent's work.
 *
 * Seed: Company S (SUBCONTRACTOR) is a child of Company A (MAIN_CONTRACTOR), with
 * its own team + full work chain (IDS.sub.visit / .inspection / .asset / .defect).
 * Company B is an unrelated MAIN_CONTRACTOR (no parent/child link to A or S).
 */
describe('Authz · main-contractor read-only oversight of subcontractors', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    token.mgrA = await login(app, EMAILS.mgrA); // main contractor (parent of S)
    token.mgrB = await login(app, EMAILS.mgrB); // unrelated main contractor
    token.subMgr = await login(app, EMAILS.subMgr); // the subcontractor's own manager
  }, 30000);

  afterAll(async () => {
    await app?.close();
  });

  describe('READ — the main contractor sees the work it delegated', () => {
    it('site-visit list includes the subcontractor visit (alongside its own)', async () => {
      const res = await http(app, token.mgrA).get('/api/v1/site-visits');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.sub.visit);
      expect(body).toContain(IDS.visit.a);
    });

    it('site-visit detail of the subcontractor visit (200)', () =>
      http(app, token.mgrA).get(`/api/v1/site-visits/${IDS.sub.visit}`).expect(200));

    it('the subcontractor visit asset register (200)', () =>
      http(app, token.mgrA)
        .get(`/api/v1/site-visits/${IDS.sub.visit}/assets`)
        .expect(200));

    it('inspection detail of the subcontractor inspection (200)', () =>
      http(app, token.mgrA)
        .get(`/api/v1/inspections/${IDS.sub.inspection}`)
        .expect(200));

    it('the map feed includes the subcontractor asset', async () => {
      const res = await http(app, token.mgrA).get('/api/v1/assets/map');
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).toContain(IDS.sub.asset);
    });
  });

  describe('WRITE — oversight is read-only; mutation gates stay own-org strict', () => {
    it('cannot COMPLETE the subcontractor visit (404 — outside the strict mutation scope)', () =>
      http(app, token.mgrA)
        .post(`/api/v1/site-visits/${IDS.sub.visit}/complete`)
        .send({})
        .expect(404));

    it('cannot REASSIGN the subcontractor visit (404)', () =>
      http(app, token.mgrA)
        .post(`/api/v1/site-visits/${IDS.sub.visit}/reassign`)
        .send({ toTeamId: IDS.team.a, reason: 'oversight must not permit this' })
        .expect(404));

    it('cannot JOIN the subcontractor visit (404)', () =>
      http(app, token.mgrA)
        .post(`/api/v1/site-visits/${IDS.sub.visit}/join`)
        .expect(404));

    it('cannot AMEND the subcontractor inspection (404)', () =>
      http(app, token.mgrA)
        .post(`/api/v1/inspections/${IDS.sub.inspection}/amend`)
        .expect(404));
  });

  describe('ISOLATION — oversight is bounded to the subtree (downward only)', () => {
    it('an unrelated main contractor (B) does NOT see the subcontractor visit', async () => {
      const res = await http(app, token.mgrB).get('/api/v1/site-visits');
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(IDS.sub.visit);
    });

    it('an unrelated main contractor (B) cannot read the subcontractor visit detail (404)', () =>
      http(app, token.mgrB).get(`/api/v1/site-visits/${IDS.sub.visit}`).expect(404));

    it('the subcontractor manager sees its own work but NOT the parent contractor\'s (no upward visibility)', async () => {
      const res = await http(app, token.subMgr).get('/api/v1/site-visits');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(IDS.sub.visit);
      expect(body).not.toContain(IDS.visit.a);
    });
  });
});

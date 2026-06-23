import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * Cross-company isolation isn't only about READS — a company must not be able to
 * ACT on another company's work/findings either. These mutations all load their
 * target through the same access-scoped lookup as the reads, so a cross-company
 * caller is filtered out and gets 404 BEFORE any state change — which also means
 * these tests never mutate the shared seed (they're rejected), keeping them
 * order-independent. (Body-less endpoints only, so the 404 is the access gate,
 * not a 400 from validation.)
 */
describe('Authz · cross-company mutation isolation (cannot act on another company\'s work)', () => {
  let app: INestApplication;
  let techA: string;

  beforeAll(async () => {
    app = await createTestApp();
    techA = await login(app, EMAILS.techA);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('cannot submit company B\'s inspection (404)', () =>
    http(app, techA).post(`/api/v1/inspections/${IDS.inspection.b}/submit`).expect(404));

  it('cannot amend company B\'s inspection (404)', () =>
    http(app, techA).post(`/api/v1/inspections/${IDS.inspection.b}/amend`).expect(404));

  it('cannot claim company B\'s defect (404)', () =>
    http(app, techA).patch(`/api/v1/defects/${IDS.defect.b}/claim`).expect(404));
});

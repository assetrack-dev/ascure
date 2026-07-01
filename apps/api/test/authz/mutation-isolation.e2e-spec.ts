import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { getTestPrisma } from '../utils/prisma';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * Cross-company isolation isn't only about READS — a company must not be able to
 * ACT on another company's work/findings either. These mutations all load their
 * target through the same access-scoped lookup as the reads, so a cross-company
 * caller is filtered out and gets 404 BEFORE any state change — which also means
 * these tests never mutate the shared seed (they're rejected), keeping them
 * order-independent. (Body-less, or a well-formed body so the 404 is the access
 * gate, not a 400 from validation.)
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

/**
 * Asset edit/delete isolation (regression for the mobile Map "anyone can delete
 * anyone's asset" report). The asset delete/update/status endpoints only require
 * a non-read-only role, then load the asset through the strict mutation scope
 * (siteVisitAccessWhere): a technician may SEE another team's poles on the map
 * but must not be able to edit or delete them. A cross-team target 404s exactly
 * like a non-existent one — before any deletion — so the shared seed survives.
 * A positive check on a throwaway pole owned by Team A guards against the fix
 * over-restricting the field crew's own work.
 */
describe('Authz · asset mutation isolation (cannot edit/delete another company\'s asset)', () => {
  let app: INestApplication;
  let techA: string;

  // A throwaway pole owned by Team A (via its creation visit), created + torn
  // down inside this spec so it never touches the shared multi-company seed.
  const THROWAWAY_ASSET_A = '7f000000-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    app = await createTestApp();
    techA = await login(app, EMAILS.techA);
    await getTestPrisma().asset.create({
      data: {
        id: THROWAWAY_ASSET_A,
        tenantId: IDS.tenant.t1,
        substationId: IDS.substation.s1,
        assetTypeId: IDS.assetType.savr,
        assetCode: 'A-THROWAWAY',
        name: 'Pole A-THROWAWAY',
        createdDuringVisitId: IDS.visit.a,
        createdByUserId: IDS.user.techA,
      },
    });
  });

  afterAll(async () => {
    // Remove the throwaway if a failed assertion left it behind (idempotent).
    await getTestPrisma().asset.deleteMany({ where: { id: THROWAWAY_ASSET_A } });
    await app?.close();
  });

  it('techA cannot delete company B\'s asset (404)', () =>
    http(app, techA).del(`/api/v1/assets/${IDS.asset.b}`).expect(404));

  it('techA cannot bulk-delete company B\'s asset (404)', () =>
    http(app, techA)
      .post('/api/v1/assets/bulk-delete')
      .send({ ids: [IDS.asset.b] })
      .expect(404));

  it('techA cannot change status of company B\'s asset (404)', () =>
    http(app, techA)
      .patch(`/api/v1/assets/${IDS.asset.b}/status`)
      .send({ status: 'INACTIVE' })
      .expect(404));

  it('techA CAN delete a pole in their own team scope (200)', () =>
    http(app, techA).del(`/api/v1/assets/${THROWAWAY_ASSET_A}`).expect(200));
});

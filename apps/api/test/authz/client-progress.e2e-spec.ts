import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Client (network-owner) progress view — the TNB-facing read-only surface.
 *
 * A CLIENT viewer is an EXTERNAL party, so its scope is deliberately orthogonal
 * to the contractor scopes: a contractor is scoped by WHO DID THE WORK (team /
 * organization), a client by WHOSE NETWORK IT IS (Mainhead, via
 * OrganizationMainhead). The properties that matter:
 *
 *  1. FAILS CLOSED — a client org with no Mainhead assigned sees NOTHING, never
 *     the whole tenant.
 *  2. BOUNDED — an assigned client sees its own Mainhead and 403s on any other.
 *  3. NO BACK DOOR — `GET /assets/:id` must not hand a client a pole outside its
 *     Mainheads; the client view's scoping would be pointless if the generic
 *     asset read leaked.
 *  4. EVERY STAGE VISIBLE — inside those Mainheads the client sees the network
 *     at any lifecycle stage, in-field work included, LABELLED rather than
 *     hidden (owner's call, 2026-08-10 — this used to be a lifecycle gate).
 *     Mainhead scope is now the ONLY boundary, which makes 1–3 load-bearing.
 *  5. CLOSED TO NON-CLIENTS — a contractor cannot read the client endpoints.
 *
 * Self-contained: this spec creates its OWN org / mainhead / pencawang / pole /
 * survey chain (the shared fixture has no Mainhead) and removes it afterwards,
 * so it cannot perturb the other specs sharing this database.
 */
const C = {
  org: '0e000000-0000-4000-8000-000000000001',
  user: '10000000-0000-4000-8000-0000000000f1',
  mainhead: 'e0000000-0000-4000-8000-00000000000a',
  otherMainhead: 'e0000000-0000-4000-8000-00000000000b',
  substation: '30000000-0000-4000-8000-0000000000f1',
  otherSubstation: '30000000-0000-4000-8000-0000000000f2',
  team: '20000000-0000-4000-8000-0000000000f1',
  visit: '60000000-0000-4000-8000-0000000000f1',
  outsideVisit: '60000000-0000-4000-8000-0000000000f2',
  asset: '70000000-0000-4000-8000-0000000000f1',
  outsideAsset: '70000000-0000-4000-8000-0000000000f2',
  /** In the client's Pencawang but never inspected — the NOT_SURVEYED case. */
  bareAsset: '70000000-0000-4000-8000-0000000000f3',
  inspection: '80000000-0000-4000-8000-0000000000f1',
  assignment: 'f0000000-0000-4000-8000-000000000001',
  region: 'd0000000-0000-4000-8000-000000000001',
  email: 'client.tnb@authz.test',
};

describe('Authz · client (TNB) progress view', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    // Reuse the fixture's password hash so `login` works with the shared secret.
    const seedUser = await prisma.user.findUniqueOrThrow({
      where: { id: IDS.user.mgrA },
      select: { passwordHash: true },
    });

    await prisma.organization.create({
      data: {
        id: C.org,
        tenantId: IDS.tenant.t1,
        name: 'Tenaga Nasional Berhad (test)',
        type: 'TNB',
        isActive: true,
      },
    });
    await prisma.user.create({
      data: {
        id: C.user,
        tenantId: IDS.tenant.t1,
        email: C.email,
        name: 'TNB Viewer',
        passwordHash: seedUser.passwordHash,
        role: 'CLIENT',
        organizationId: C.org,
      },
    });
    // Both Mainheads share ONE region, so drilling that region is exactly the
    // case where the substation-filter collision used to leak the unassigned one.
    await prisma.operationalRegion.create({
      data: {
        id: C.region,
        tenantId: IDS.tenant.t1,
        name: 'Client Region',
        code: 'CLR',
        isActive: true,
      },
    });
    await prisma.mainhead.createMany({
      data: [
        {
          id: C.mainhead,
          name: 'CLIENT MH IN',
          isActive: true,
          operationalRegionId: C.region,
        },
        {
          id: C.otherMainhead,
          name: 'CLIENT MH OUT',
          isActive: true,
          operationalRegionId: C.region,
        },
      ],
    });
    await prisma.substation.createMany({
      data: [
        {
          id: C.substation,
          tenantId: IDS.tenant.t1,
          name: 'Client Pencawang',
          code: 'CL-1',
          mainheadId: C.mainhead,
        },
        {
          id: C.otherSubstation,
          tenantId: IDS.tenant.t1,
          name: 'Outside Pencawang',
          code: 'CL-2',
          mainheadId: C.otherMainhead,
        },
      ],
    });
    await prisma.asset.createMany({
      data: [
        {
          id: C.asset,
          tenantId: IDS.tenant.t1,
          assetCode: 'CL-POLE-1',
          substationId: C.substation,
          assetTypeId: IDS.assetType.savr,
          latitude: 3.1,
          longitude: 101.6,
        },
        {
          id: C.outsideAsset,
          tenantId: IDS.tenant.t1,
          assetCode: 'CL-POLE-OUT',
          substationId: C.otherSubstation,
          assetTypeId: IDS.assetType.savr,
        },
        {
          id: C.bareAsset,
          tenantId: IDS.tenant.t1,
          assetCode: 'CL-POLE-2',
          substationId: C.substation,
          assetTypeId: IDS.assetType.savr,
        },
      ],
    });
    await prisma.team.create({
      data: {
        id: C.team,
        tenantId: IDS.tenant.t1,
        name: 'Client Spec Team',
        code: 'CLT',
        organizationId: IDS.org.a,
      },
    });
    // The survey starts IN THE FIELD, which is now a VISIBLE state for the
    // client — the assertions below pin that it is labelled, not hidden.
    await prisma.siteVisit.createMany({
      data: [
        {
          id: C.visit,
          tenantId: IDS.tenant.t1,
          teamId: C.team,
          substationId: C.substation,
          mainheadId: C.mainhead,
          createdByUserId: IDS.user.mgrA,
          organizationId: IDS.org.a,
          status: 'ACTIVE',
          lifecycleStatus: 'DALAM_RONDAAN',
        },
        // A finished survey on the UNASSIGNED Mainhead: the client must not
        // reach it through the visits feed either.
        {
          id: C.outsideVisit,
          tenantId: IDS.tenant.t1,
          teamId: C.team,
          substationId: C.otherSubstation,
          mainheadId: C.otherMainhead,
          createdByUserId: IDS.user.mgrA,
          organizationId: IDS.org.a,
          status: 'ACTIVE',
          lifecycleStatus: 'LAPORAN_SELESAI',
        },
      ],
    });
    await prisma.inspection.create({
      data: {
        id: C.inspection,
        tenantId: IDS.tenant.t1,
        assetId: C.asset,
        siteVisitId: C.visit,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });

    token.client = await login(app, C.email);
    token.mgrA = await login(app, EMAILS.mgrA);
  }, 60000);

  afterAll(async () => {
    // Reverse dependency order so the FKs stay satisfied.
    await prisma.assetShareLink.deleteMany({
      where: { assetId: { in: [C.asset, C.outsideAsset, C.bareAsset] } },
    });
    await prisma.inspection.deleteMany({ where: { id: C.inspection } });
    await prisma.siteVisit.deleteMany({
      where: { id: { in: [C.visit, C.outsideVisit] } },
    });
    await prisma.asset.deleteMany({
      where: { id: { in: [C.asset, C.outsideAsset, C.bareAsset] } },
    });
    await prisma.team.deleteMany({ where: { id: C.team } });
    await prisma.substation.deleteMany({
      where: { id: { in: [C.substation, C.otherSubstation] } },
    });
    await prisma.organizationMainhead.deleteMany({
      where: { organizationId: C.org },
    });
    await prisma.mainhead.deleteMany({
      where: { id: { in: [C.mainhead, C.otherMainhead] } },
    });
    await prisma.operationalRegion.deleteMany({ where: { id: C.region } });
    await prisma.user.deleteMany({ where: { id: C.user } });
    await prisma.organization.deleteMany({ where: { id: C.org } });
    await app?.close();
  });

  describe('fails closed before any Mainhead is assigned', () => {
    it('progress returns an empty roll-up, NOT the tenant', async () => {
      const res = await http(app, token.client).get('/api/v1/client/progress');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.groups).toHaveLength(0);
    });

    it('the client cannot read a pole in its own (unassigned) Pencawang', () =>
      http(app, token.client).get(`/api/v1/assets/${C.asset}`).expect(404));
  });

  describe('once a Mainhead is assigned', () => {
    beforeAll(async () => {
      await prisma.organizationMainhead.create({
        data: {
          id: C.assignment,
          organizationId: C.org,
          mainheadId: C.mainhead,
          isActive: true,
        },
      });
    });

    it('progress covers the assigned Mainhead only', async () => {
      const res = await http(app, token.client).get('/api/v1/client/progress');
      expect(res.status).toBe(200);
      // Two registered poles, one of them submitted. Coverage counts the
      // SUBMISSION, not the survey's lifecycle stage, so a pole inside a survey
      // still being walked counts (owner's call, 2026-08-10).
      expect(res.body.total).toBe(2);
      expect(res.body.inspected).toBe(1);
      const names = res.body.groups.map((g: { name: string }) => g.name);
      expect(names).toContain('CLIENT MH IN');
      expect(names).not.toContain('CLIENT MH OUT');
    });

    it('drilling an unassigned Mainhead is refused', () =>
      http(app, token.client)
        .get(`/api/v1/client/progress?mainheadId=${C.otherMainhead}`)
        .expect(403));

    it('an unassigned Pencawang is refused', () =>
      http(app, token.client)
        .get(`/api/v1/client/pencawang/${C.otherSubstation}/poles`)
        .expect(403));

    it('a pole outside the assigned Mainhead is NOT readable via /assets/:id', () =>
      http(app, token.client).get(`/api/v1/assets/${C.outsideAsset}`).expect(404));

    // The map applies the client scope as a `substation` filter, and the
    // drill-down levels filter on `substation` too. Spreading both into one
    // where-clause let the later key REPLACE the client scope, so drilling a
    // region showed a TNB user Mainheads they were never assigned. These pin
    // the AND-ing that fixes it.
    describe('map scope survives the drill-down filters', () => {
      it('the Mainhead roll-up lists only the assigned Mainhead', async () => {
        const res = await http(app, token.client).get(
          '/api/v1/assets/map?level=mainhead',
        );
        expect(res.status).toBe(200);
        const names = res.body.map((b: { name: string }) => b.name);
        expect(names).toContain('CLIENT MH IN');
        expect(names).not.toContain('CLIENT MH OUT');
      });

      it('and still does when drilled into a region', async () => {
        const res = await http(app, token.client).get(
          `/api/v1/assets/map?level=mainhead&regionId=${C.region}`,
        );
        expect(res.status).toBe(200);
        const names = res.body.map((b: { name: string }) => b.name);
        expect(names).not.toContain('CLIENT MH OUT');
      });

      it('the Mainhead-wide pole layer refuses an unassigned Mainhead', async () => {
        const res = await http(app, token.client).get(
          `/api/v1/assets/map?level=points&mainheadId=${C.otherMainhead}`,
        );
        expect(res.status).toBe(200);
        expect(res.body.poles).toHaveLength(0);
      });
    });

    // ⚠ These replace the old lifecycle-gate cases. The client used to see only
    // surveys that had left the field; they now see every stage, so what needs
    // pinning is the opposite: in-field work must be VISIBLE and LABELLED, and
    // the Mainhead boundary must still hold on its own.
    describe('in-field work is visible and labelled, not hidden', () => {
      it('the Pencawang lists every pole, surveyed or not', async () => {
        const res = await http(app, token.client).get(
          `/api/v1/client/pencawang/${C.substation}/poles`,
        );
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(2);

        const byCode = Object.fromEntries(
          res.body.poles.map((pole: { assetCode: string }) => [
            pole.assetCode,
            pole,
          ]),
        );
        // Submitted, but its survey is still being walked: shown, flagged.
        expect(byCode['CL-POLE-1'].surveyState).toBe('SURVEYED');
        expect(byCode['CL-POLE-1'].isFinished).toBe(false);
        expect(byCode['CL-POLE-1'].lifecycleStatus).toBe('DALAM_RONDAAN');
        // Registered but never inspected — the client's outstanding work.
        expect(byCode['CL-POLE-2'].surveyState).toBe('NOT_SURVEYED');
        expect(byCode['CL-POLE-2'].inspectionId).toBeNull();
      });

      it('and /assets/:id opens the pole while it is still in the field', () =>
        http(app, token.client).get(`/api/v1/assets/${C.asset}`).expect(200));

      it('the visits feed lists the in-field survey, marked unfinished', async () => {
        const res = await http(app, token.client).get('/api/v1/client/visits');
        expect(res.status).toBe(200);

        const ids = res.body.visits.map((visit: { id: string }) => visit.id);
        expect(ids).toContain(C.visit);
        // ...but never a survey on an unassigned Mainhead.
        expect(ids).not.toContain(C.outsideVisit);

        const mine = res.body.visits.find(
          (visit: { id: string }) => visit.id === C.visit,
        );
        expect(mine.isFinished).toBe(false);
        expect(mine.lifecycleStatus).toBe('DALAM_RONDAAN');
        expect(mine.surveyedCount).toBe(1);
        // ⚠ NO ATTRIBUTION — the contractor that walked it must not be sent.
        expect(mine.team).toBeUndefined();
        expect(mine.organization).toBeUndefined();
      });

      it('a survey on an unassigned Mainhead is refused by id', () =>
        http(app, token.client)
          .get(`/api/v1/client/visits/${C.outsideVisit}`)
          .expect(403));

      it('the visit detail lists the survey and its poles', async () => {
        const res = await http(app, token.client).get(
          `/api/v1/client/visits/${C.visit}`,
        );
        expect(res.status).toBe(200);
        expect(res.body.visit.pencawang).toBe('Client Pencawang');
        const codes = res.body.poles.map(
          (pole: { assetCode: string }) => pole.assetCode,
        );
        expect(codes).toContain('CL-POLE-1');
      });

      it('filtering the feed by an unassigned Mainhead is refused', () =>
        http(app, token.client)
          .get(`/api/v1/client/visits?mainheadId=${C.otherMainhead}`)
          .expect(403));

      // The client may hand a pole on THEIR network to someone without an
      // account — but a share link is PUBLIC and unauthenticated, so the
      // Mainhead boundary has to hold here too or it becomes a way to publish
      // any pole in the tenant by id.
      describe('sharing a pole', () => {
        it('the client can mint a link for a pole on their Mainhead', async () => {
          const res = await http(app, token.client)
            .post(`/api/v1/share/asset/${C.asset}`)
            .send({ expiresInDays: 90 });
          expect(res.status).toBe(201);
          expect(typeof res.body.token).toBe('string');
          // ...capped at 30 days however long they asked for.
          const days =
            (new Date(res.body.expiresAt).getTime() - Date.now()) / 86_400_000;
          expect(days).toBeLessThanOrEqual(30);
          expect(days).toBeGreaterThan(29);
        });

        it('but NOT for a pole outside their Mainheads', () =>
          http(app, token.client)
            .post(`/api/v1/share/asset/${C.outsideAsset}`)
            .send({ expiresInDays: 30 })
            .expect(404));
      });

      it('completing the survey flips it to finished', async () => {
        await prisma.siteVisit.update({
          where: { id: C.visit },
          data: { lifecycleStatus: 'RONDAAN_SELESAI' },
        });

        const res = await http(app, token.client).get(
          `/api/v1/client/pencawang/${C.substation}/poles`,
        );
        expect(res.status).toBe(200);
        const pole = res.body.poles.find(
          (row: { assetCode: string }) => row.assetCode === 'CL-POLE-1',
        );
        expect(pole.isFinished).toBe(true);

        // Coverage does NOT move — it already counted the submission, so the
        // headline and the drill-down agree at every stage.
        const progress = await http(app, token.client).get(
          '/api/v1/client/progress',
        );
        expect(progress.body.inspected).toBe(1);
        expect(progress.body.total).toBe(2);
      });
    });
  });

  describe('closed to non-client callers', () => {
    it('a contractor MANAGER cannot read the client progress view', () =>
      http(app, token.mgrA).get('/api/v1/client/progress').expect(403));

    it('nor the client pole list', () =>
      http(app, token.mgrA)
        .get(`/api/v1/client/pencawang/${C.substation}/poles`)
        .expect(403));

    it('nor the client visits feed', () =>
      http(app, token.mgrA).get('/api/v1/client/visits').expect(403));

    it('nor one client visit by id', () =>
      http(app, token.mgrA)
        .get(`/api/v1/client/visits/${C.visit}`)
        .expect(403));
  });
});

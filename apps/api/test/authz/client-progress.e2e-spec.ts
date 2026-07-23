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
 *  4. LIFECYCLE-GATED — evidence only appears once the crew has finished the
 *     survey, so work-in-progress never reaches the client.
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
  asset: '70000000-0000-4000-8000-0000000000f1',
  outsideAsset: '70000000-0000-4000-8000-0000000000f2',
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
    // The survey starts IN PROGRESS so the lifecycle gate can be proven first.
    await prisma.siteVisit.create({
      data: {
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
    await prisma.inspection.deleteMany({ where: { id: C.inspection } });
    await prisma.siteVisit.deleteMany({ where: { id: C.visit } });
    await prisma.asset.deleteMany({
      where: { id: { in: [C.asset, C.outsideAsset] } },
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
      expect(res.body.total).toBe(1);
      // The pole IS submitted, but its survey is still being walked — coverage
      // counts finished work only, matching the evidence gate. A page that
      // reported 100% here would open to "no completed surveys yet".
      expect(res.body.inspected).toBe(0);
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

    describe('evidence is gated on the survey leaving the field', () => {
      it('an in-progress survey exposes NO poles', async () => {
        const res = await http(app, token.client).get(
          `/api/v1/client/pencawang/${C.substation}/poles`,
        );
        expect(res.status).toBe(200);
        expect(res.body.poles).toHaveLength(0);
      });

      it('and /assets/:id still refuses the pole while in progress', () =>
        http(app, token.client).get(`/api/v1/assets/${C.asset}`).expect(404));

      it('completing the survey reveals the pole and its evidence', async () => {
        await prisma.siteVisit.update({
          where: { id: C.visit },
          data: { lifecycleStatus: 'RONDAAN_SELESAI' },
        });

        const res = await http(app, token.client).get(
          `/api/v1/client/pencawang/${C.substation}/poles`,
        );
        expect(res.status).toBe(200);
        expect(res.body.poles).toHaveLength(1);
        expect(res.body.poles[0].assetCode).toBe('CL-POLE-1');

        await http(app, token.client).get(`/api/v1/assets/${C.asset}`).expect(200);

        // ...and coverage moves WITH it — the headline and the drill-down agree.
        const progress = await http(app, token.client).get(
          '/api/v1/client/progress',
        );
        expect(progress.body.inspected).toBe(1);
        expect(progress.body.percent).toBe(100);
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
  });
});

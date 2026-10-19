import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * "My team" (docs/PLAN-maintenance-flow.md §21, R5): the field crew's small
 * read-only web view — own teams and teammates, the team's open surveys with
 * the DC's amendment remark first, poles inspected today / in 7 days. Own teams
 * only: another company's crew sees none of it.
 */
const M = {
  sub: '30000000-0000-4000-8000-000000000081',
  visit: '60000000-0000-4000-8000-000000000081',
  asset: '70000000-0000-4000-8000-000000000081',
  inspection: '80000000-0000-4000-8000-000000000081',
};
const REMARK = 'Pole 3 photo blurry — retake';

type Summary = {
  teams: Array<{ id: string; members: Array<{ id: string; isMe: boolean }> }>;
  inspected: { today: { team: number; mine: number }; week: { team: number; mine: number } };
  openSurveys: Array<{ id: string; amendment: { remark: string | null } | null }>;
  maintenance: unknown;
};

describe('Authz · My team (field crew view)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};
  const mine = async (who: string) =>
    (await http(app, token[who]).get('/api/v1/teams/mine').expect(200)).body as Summary;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const t = IDS.tenant.t1;
    await prisma.substation.create({ data: { id: M.sub, tenantId: t, name: 'My Team PE', code: 'MT-1' } });
    await prisma.siteVisit.create({
      data: {
        id: M.visit,
        tenantId: t,
        teamId: IDS.team.a,
        substationId: M.sub,
        createdByUserId: IDS.user.techA,
        organizationId: IDS.org.a,
        status: 'IN_PROGRESS',
        lifecycleStatus: 'PERLU_PINDAAN',
        amendmentRemark: REMARK,
        amendmentRequestedAt: new Date(),
      },
    });
    await prisma.asset.create({
      data: { id: M.asset, tenantId: t, assetCode: 'MT-POLE-1', substationId: M.sub, assetTypeId: IDS.assetType.savr },
    });
    await prisma.inspection.create({
      data: {
        id: M.inspection,
        tenantId: t,
        assetId: M.asset,
        siteVisitId: M.visit,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
    token.techA = await login(app, EMAILS.techA);
    token.viewerA = await login(app, EMAILS.viewerA);
    token.techB = await login(app, EMAILS.techB);
  });

  afterAll(async () => {
    await prisma.inspection.deleteMany({ where: { id: M.inspection } });
    await prisma.siteVisit.deleteMany({ where: { id: M.visit } });
    await prisma.asset.deleteMany({ where: { id: M.asset } });
    await prisma.substation.deleteMany({ where: { id: M.sub } });
    await app?.close();
  });

  it('a technician sees own team, teammates, the amendment first, and today’s poles', async () => {
    const body = await mine('techA');
    expect(body.teams.map((team) => team.id)).toEqual([IDS.team.a]);
    const members = body.teams[0].members;
    expect(members.find((member) => member.isMe)?.id).toBe(IDS.user.techA);
    expect(members.map((member) => member.id)).toContain(IDS.user.viewerA);

    expect(body.openSurveys[0]).toMatchObject({ id: M.visit, amendment: { remark: REMARK } });
    expect(body.inspected.today.mine).toBeGreaterThanOrEqual(1);
    expect(body.inspected.week.team).toBeGreaterThanOrEqual(body.inspected.today.team);
  });

  it('a viewer gets the same team view, without maintenance', async () => {
    const body = await mine('viewerA');
    expect(body.teams.map((team) => team.id)).toEqual([IDS.team.a]);
    expect(body.openSurveys.map((survey) => survey.id)).toContain(M.visit);
    expect(body.maintenance).toBeNull();
  });

  it('another company’s crew sees none of it', async () => {
    const body = await mine('techB');
    expect(body.teams.map((team) => team.id)).not.toContain(IDS.team.a);
    expect(body.openSurveys.map((survey) => survey.id)).not.toContain(M.visit);
  });
});

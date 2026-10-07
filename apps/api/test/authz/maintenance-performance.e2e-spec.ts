import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Plan §15 (J33) — Crew Performance → Maintenance: repair output credited to
 * the TEAM holding the Kejanggalan, over a period (UTC+8 days).
 *
 *   Team A (Company A, main contractor): 1 repaired + closed, 1 sent back, 1 on hand
 *   Team S (subcontractor of A):          1 cannot repair
 *   Team B (Company B):                   1 repaired — outside A's scope
 *
 * A Main Contractor manager sees its own + subcontractor teams; another company
 * sees only its own; a technician gets 403. Dates sit in March 2026 so the
 * period holds only this spec's rows.
 */
const P = {
  item: [
    '90000000-0000-4000-8000-0000000c1601',
    '90000000-0000-4000-8000-0000000c1602',
    '90000000-0000-4000-8000-0000000c1603',
    '90000000-0000-4000-8000-0000000c1604',
  ],
  defect: {
    aDone: 'a0000000-0000-4000-8000-0000000c1601',
    sCannot: 'a0000000-0000-4000-8000-0000000c1602',
    bDone: 'a0000000-0000-4000-8000-0000000c1603',
    aOnHand: 'a0000000-0000-4000-8000-0000000c1604',
  },
};
const ALL_DEFECTS = Object.values(P.defect);
const PERIOD = 'from=2026-03-01&to=2026-03-31';
const at = (day: number, hour: number) => new Date(Date.UTC(2026, 2, day, hour - 8));

type TeamRow = {
  teamId: string;
  repaired: number;
  closed: number;
  sentBack: number;
  cannotRepair: number;
  activeDays: number;
  avgHoursToDone: number | null;
  passRate: number | null;
  onHand: number;
};

describe('Authz · reports — maintenance crew performance (plan §15)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  const teamsOf = async (who: string) => {
    const res = await http(app, token[who])
      .get(`/api/v1/reports/maintenance-performance?${PERIOD}`)
      .expect(200);
    return res.body.teams as TeamRow[];
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    await prisma.inspectionItemResult.createMany({
      data: P.item.map((id) => ({
        id,
        inspectionId: IDS.inspection.a,
        label: 'Kejanggalan',
        result: 'FAIL' as const,
        isDefect: true,
        severity: 'MEDIUM' as const,
      })),
    });
    await prisma.defect.createMany({
      data: [
        {
          id: P.defect.aDone,
          inspectionItemResultId: P.item[0],
          status: 'CLOSED',
          severity: 'MEDIUM',
          lifecycleStatus: 'CLOSED',
          maintenanceOrganizationId: IDS.org.a,
          assignedToTeamId: IDS.team.a,
          assignedAt: at(2, 8),
          maintainedAt: at(3, 8),
          closureVerifiedAt: at(5, 10),
        },
        {
          id: P.defect.sCannot,
          inspectionItemResultId: P.item[1],
          status: 'OPEN',
          severity: 'MEDIUM',
          lifecycleStatus: 'COMPLETED',
          resolutionOutcome: 'EXTERNAL_CONSTRAINT',
          maintenanceOrganizationId: IDS.sub.org,
          assignedToTeamId: IDS.sub.team,
          assignedAt: at(2, 8),
          maintainedAt: at(4, 9),
        },
        {
          id: P.defect.bDone,
          inspectionItemResultId: P.item[2],
          status: 'OPEN',
          severity: 'MEDIUM',
          lifecycleStatus: 'COMPLETED',
          maintenanceOrganizationId: IDS.org.b,
          assignedToTeamId: IDS.team.b,
          assignedAt: at(2, 8),
          maintainedAt: at(6, 8),
        },
        {
          id: P.defect.aOnHand,
          inspectionItemResultId: P.item[3],
          status: 'OPEN',
          severity: 'MEDIUM',
          lifecycleStatus: 'ASSIGNED',
          maintenanceOrganizationId: IDS.org.a,
          assignedToTeamId: IDS.team.a,
          assignedAt: at(2, 8),
        },
      ],
    });
    // Team A's repair: BEFORE + AFTER photos on day 3; sent back once on day 4.
    await prisma.defectEvidenceImage.createMany({
      data: ['BEFORE', 'AFTER'].map((evidenceType) => ({
        defectId: P.defect.aDone,
        evidenceType,
        fileName: `${evidenceType}.jpg`,
        storageKey: 'k',
        url: `/uploads/defects/x/${evidenceType}.jpg`,
        createdAt: at(3, 7),
      })),
    });
    await prisma.defectTimelineEntry.create({
      data: {
        defectId: P.defect.aDone,
        type: 'STATUS_CHANGED',
        fromLifecycleStatus: 'COMPLETED',
        toLifecycleStatus: 'IN_PROGRESS',
        comment: 'After photo blurry',
        createdAt: at(4, 12),
      },
    });

    token.admin = await login(app, EMAILS.adminT1);
    token.mgrA = await login(app, EMAILS.mgrA);
    token.mgrB = await login(app, EMAILS.mgrB);
    token.techA = await login(app, EMAILS.techA);
  });

  afterAll(async () => {
    await prisma.defectEvidenceImage.deleteMany({ where: { defectId: { in: ALL_DEFECTS } } });
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: ALL_DEFECTS } } });
    await prisma.defect.deleteMany({ where: { id: { in: ALL_DEFECTS } } });
    await prisma.inspectionItemResult.deleteMany({ where: { id: { in: P.item } } });
    await app?.close();
  });

  it('credits the team: repaired, closed, sent back, active days, time to done, pass rate, on hand', async () => {
    const teams = await teamsOf('mgrA');
    const teamA = teams.find((row) => row.teamId === IDS.team.a);
    expect(teamA).toMatchObject({
      repaired: 1,
      closed: 1,
      sentBack: 1,
      cannotRepair: 0,
      activeDays: 1,
      avgHoursToDone: 24,
      passRate: 50,
      onHand: 1,
    });
    expect(teams.find((row) => row.teamId === IDS.sub.team)).toMatchObject({
      repaired: 0,
      cannotRepair: 1,
      passRate: null,
    });
  });

  it("a Main Contractor manager sees its own + subcontractor teams, never another company's", async () => {
    const ids = (await teamsOf('mgrA')).map((row) => row.teamId);
    expect(ids).toEqual(expect.arrayContaining([IDS.team.a, IDS.sub.team]));
    expect(ids).not.toContain(IDS.team.b);

    const other = (await teamsOf('mgrB')).map((row) => row.teamId);
    expect(other).toContain(IDS.team.b);
    expect(other).not.toContain(IDS.team.a);
  });

  it('ADMIN sees every team; a technician is refused', async () => {
    const ids = (await teamsOf('admin')).map((row) => row.teamId);
    expect(ids).toEqual(expect.arrayContaining([IDS.team.a, IDS.sub.team, IDS.team.b]));
    await http(app, token.techA).get(`/api/v1/reports/maintenance-performance?${PERIOD}`).expect(403);
  });

  it('downloads the Excel', async () => {
    const res = await http(app, token.mgrA)
      .get(`/api/v1/reports/maintenance-performance.xlsx?${PERIOD}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('maintenance-performance-2026-03-01_to_2026-03-31.xlsx');
  });
});

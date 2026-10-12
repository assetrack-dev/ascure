import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Self-claim vs Pencawang packages (docs/PLAN-maintenance-flow.md §18).
 *
 *  1. A Kejanggalan routed to a maintenance company (a package) cannot be
 *     self-claimed — the Manager / TNB gives it to a team (409).
 *  2. The defect list says which Kejanggalan are routed, so the app keeps them
 *     out of "Ready to Claim".
 *  3. Unrouted work keeps the legacy claim (200 → assigned to the claimer).
 *
 * Restores both defects it touches.
 */
describe('Authz · self-claim of package work', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};
  let originalA: {
    status: string;
    lifecycleStatus: string | null;
    assignedUserId: string | null;
    assignedToUserId: string | null;
    assignedTeamId: string | null;
    assignedToTeamId: string | null;
    assignedAt: Date | null;
    maintenanceOrganizationId: string | null;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    token.maintUser = await login(app, EMAILS.maintUser);
    token.techA = await login(app, EMAILS.techA);
    originalA = await prisma.defect.findUniqueOrThrow({
      where: { id: IDS.defect.a },
      select: {
        status: true,
        lifecycleStatus: true,
        assignedUserId: true,
        assignedToUserId: true,
        assignedTeamId: true,
        assignedToTeamId: true,
        assignedAt: true,
        maintenanceOrganizationId: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.defectTimelineEntry.deleteMany({
      where: { defectId: IDS.defect.a, comment: { startsWith: 'Self-claimed' } },
    });
    await prisma.defect.update({
      where: { id: IDS.defect.a },
      data: originalA as never,
    });
    await app?.close();
  });

  it('a routed Kejanggalan cannot be self-claimed (409) and stays unassigned', async () => {
    const res = await http(app, token.maintUser)
      .patch(`/api/v1/defects/${IDS.defect.routed}/claim`)
      .expect(409);
    expect(String(res.body.message)).toContain('Pencawang package');
    const row = await prisma.defect.findUniqueOrThrow({
      where: { id: IDS.defect.routed },
      select: { assignedToUserId: true, lifecycleStatus: true },
    });
    expect(row.assignedToUserId).toBeNull();
    expect(row.lifecycleStatus).toBe('VERIFIED');
  });

  it('the defect list carries maintenanceOrganizationId', async () => {
    const res = await http(app, token.maintUser).get('/api/v1/defects').expect(200);
    const routed = (res.body as Array<{ id: string; maintenanceOrganizationId?: string | null }>).find(
      (item) => item.id === IDS.defect.routed,
    );
    expect(routed?.maintenanceOrganizationId).toBe(IDS.org.maint);
  });

  it('unrouted work keeps the legacy self-claim (200)', async () => {
    await prisma.defect.update({
      where: { id: IDS.defect.a },
      data: {
        lifecycleStatus: 'VERIFIED',
        assignedUserId: null,
        assignedToUserId: null,
        assignedTeamId: null,
        assignedToTeamId: null,
        maintenanceOrganizationId: null,
      },
    });
    await http(app, token.techA).patch(`/api/v1/defects/${IDS.defect.a}/claim`).expect(200);
    const row = await prisma.defect.findUniqueOrThrow({
      where: { id: IDS.defect.a },
      select: { assignedToUserId: true, lifecycleStatus: true },
    });
    expect(row.assignedToUserId).toBe(IDS.user.techA);
    expect(row.lifecycleStatus).toBe('ASSIGNED');
  });
});

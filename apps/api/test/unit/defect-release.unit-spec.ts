import { MaintenanceCategory } from '@prisma/client';
import { buildVisitReleasePlan } from '../../src/defects/defect-release.util';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Release at LAPORAN SELESAI / emergency submit now routes through the PE's
 * MaintenancePackage(s) — TNB's assignment — instead of the Mainhead registry
 * (docs/PLAN-maintenance-flow.md §5). No package ⇒ released unrouted, and an
 * emergency with nowhere to go is left for TNB's manual queue (no write at all,
 * so re-submits stay idempotent).
 */
function fakePrisma(
  packages: Array<{ category: MaintenanceCategory | null; maintenanceOrganizationId: string }>,
  defects: Array<{ id: string; maintenanceCategory: MaintenanceCategory | null }>,
) {
  const updates: Array<{ where: { id: { in: string[] } }; data: Record<string, unknown> }> = [];
  const prisma = {
    maintenancePackage: { findMany: async () => packages },
    defect: {
      findMany: async () =>
        defects.map((defect) => ({ ...defect, lifecycleStatus: 'DETECTED' })),
      updateMany: (args: (typeof updates)[number]) => {
        updates.push(args);
        return Promise.resolve(args);
      },
    },
    defectTimelineEntry: { createMany: (args: unknown) => Promise.resolve(args) },
  } as unknown as PrismaService;
  return { prisma, updates };
}

const now = new Date('2026-09-26T00:00:00Z');

describe('buildVisitReleasePlan (package routing)', () => {
  it('no package: releases every dormant defect unrouted', async () => {
    const { prisma, updates } = fakePrisma([], [
      { id: 'd1', maintenanceCategory: MaintenanceCategory.RENTIS },
      { id: 'd2', maintenanceCategory: null },
    ]);
    const plan = await buildVisitReleasePlan(prisma, 'v1', { scope: 'ALL', now });
    expect(plan).toMatchObject({ released: 2, routed: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0].data).not.toHaveProperty('maintenanceOrganizationId');
    expect(updates[0].data.lifecycleStatus).toBe('VERIFIED');
  });

  it('split packages: each defect goes to its lane company', async () => {
    const { prisma, updates } = fakePrisma(
      [
        { category: MaintenanceCategory.RENTIS, maintenanceOrganizationId: 'rentis-co' },
        { category: MaintenanceCategory.SELENGGARAAN, maintenanceOrganizationId: 'sel-co' },
      ],
      [
        { id: 'd1', maintenanceCategory: MaintenanceCategory.RENTIS },
        { id: 'd2', maintenanceCategory: null },
        { id: 'd3', maintenanceCategory: MaintenanceCategory.CAT_TIANG },
      ],
    );
    const plan = await buildVisitReleasePlan(prisma, 'v1', { scope: 'ALL', now });
    expect(plan).toMatchObject({ released: 3, routed: 2 });
    const byOrg = Object.fromEntries(
      updates.map((update) => [
        String(update.data.maintenanceOrganizationId ?? 'none'),
        update.where.id.in,
      ]),
    );
    expect(byOrg).toEqual({ 'rentis-co': ['d1'], 'sel-co': ['d2'], none: ['d3'] });
  });

  it('emergency with no package: no write (waits for TNB)', async () => {
    const { prisma, updates } = fakePrisma([], [{ id: 'e1', maintenanceCategory: null }]);
    const plan = await buildVisitReleasePlan(prisma, 'v1', { scope: 'EMERGENCY', now });
    expect(plan).toMatchObject({ released: 0, routed: 0, ops: [] });
    expect(updates).toHaveLength(0);
  });

  it('emergency on a packaged PE: routed to the package company', async () => {
    const { prisma, updates } = fakePrisma(
      [{ category: null, maintenanceOrganizationId: 'whole-co' }],
      [{ id: 'e1', maintenanceCategory: null }],
    );
    const plan = await buildVisitReleasePlan(prisma, 'v1', { scope: 'EMERGENCY', now });
    expect(plan).toMatchObject({ released: 1, routed: 1 });
    expect(updates[0].data.maintenanceOrganizationId).toBe('whole-co');
  });
});

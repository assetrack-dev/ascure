import { MaintenanceCategory } from '@prisma/client';
import {
  resolvePackageOrganizationId,
  resolvePackageTarget,
  resolveRoutingTarget,
} from '../../src/maintenance-packages/package-routing.util';

/**
 * Which company a Kejanggalan belongs to under a PE's packages
 * (docs/PLAN-maintenance-flow.md §5.1): a work-type package wins over the
 * whole-PE package, legacy null categories count as SELENGGARAAN, and no
 * matching package means unrouted (waiting for TNB).
 */
describe('resolvePackageOrganizationId', () => {
  const { RENTIS, CAT_TIANG, SELENGGARAAN } = MaintenanceCategory;

  it('whole-PE package covers every work type', () => {
    const packages = [{ category: null, maintenanceOrganizationId: 'whole' }];
    for (const category of [RENTIS, CAT_TIANG, SELENGGARAAN, null]) {
      expect(resolvePackageOrganizationId(packages, category)).toBe('whole');
    }
  });

  it('a work-type package wins; other lanes fall to the whole package', () => {
    const packages = [
      { category: null, maintenanceOrganizationId: 'whole' },
      { category: RENTIS, maintenanceOrganizationId: 'rentis-co' },
    ];
    expect(resolvePackageOrganizationId(packages, RENTIS)).toBe('rentis-co');
    expect(resolvePackageOrganizationId(packages, CAT_TIANG)).toBe('whole');
  });

  it('a legacy null category is Selenggaraan', () => {
    const packages = [{ category: SELENGGARAAN, maintenanceOrganizationId: 'sel-co' }];
    expect(resolvePackageOrganizationId(packages, null)).toBe('sel-co');
  });

  it('no covering package → unrouted', () => {
    expect(resolvePackageOrganizationId([], RENTIS)).toBeNull();
    expect(
      resolvePackageOrganizationId(
        [{ category: RENTIS, maintenanceOrganizationId: 'rentis-co' }],
        CAT_TIANG,
      ),
    ).toBeNull();
  });
});

/** Plan §12: the covering package's team travels with its company. */
describe('resolvePackageTarget', () => {
  const { RENTIS, SELENGGARAAN } = MaintenanceCategory;

  it('returns the lane package team, else the whole-PE team', () => {
    const packages = [
      { category: null, maintenanceOrganizationId: 'whole', assignedTeamId: 'crew-1' },
      { category: RENTIS, maintenanceOrganizationId: 'rentis-co', assignedTeamId: null },
    ];
    expect(resolvePackageTarget(packages, RENTIS)).toEqual({ organizationId: 'rentis-co', teamId: null });
    expect(resolvePackageTarget(packages, SELENGGARAAN)).toEqual({ organizationId: 'whole', teamId: 'crew-1' });
  });

  it('no package → unrouted, no team', () => {
    expect(resolvePackageTarget([], RENTIS)).toEqual({ organizationId: null, teamId: null });
  });
});

/** Plan §12.6: pole + work type → whole pole → PE work type → whole PE. */
describe('resolveRoutingTarget', () => {
  const { RENTIS, SELENGGARAAN } = MaintenanceCategory;
  const packages = [
    { category: null, maintenanceOrganizationId: 'pe-co', assignedTeamId: 'pe-crew' },
    { category: RENTIS, maintenanceOrganizationId: 'pe-rentis-co', assignedTeamId: null },
  ];
  const poles = [
    { assetId: 'pole-1', category: null, maintenanceOrganizationId: 'pole-co', assignedTeamId: 'pole-crew' },
    { assetId: 'pole-1', category: RENTIS, maintenanceOrganizationId: 'pole-rentis-co', assignedTeamId: null },
  ];

  it('a pole + work type split wins, then the whole-pole split', () => {
    expect(resolveRoutingTarget(packages, poles, 'pole-1', RENTIS)).toEqual({ organizationId: 'pole-rentis-co', teamId: null, source: 'POLE' });
    expect(resolveRoutingTarget(packages, poles, 'pole-1', SELENGGARAAN)).toEqual({ organizationId: 'pole-co', teamId: 'pole-crew', source: 'POLE' });
  });

  it('other poles follow the PE packages', () => {
    expect(resolveRoutingTarget(packages, poles, 'pole-2', RENTIS)).toEqual({ organizationId: 'pe-rentis-co', teamId: null, source: 'PACKAGE' });
    expect(resolveRoutingTarget(packages, poles, 'pole-2', null)).toEqual({ organizationId: 'pe-co', teamId: 'pe-crew', source: 'PACKAGE' });
    expect(resolveRoutingTarget([], [], 'pole-2', null)).toEqual({ organizationId: null, teamId: null, source: null });
  });
});

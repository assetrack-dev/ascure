import { ClientRank, OrganizationType, UserRole } from '@prisma/client';
import { hasClientMaintenanceActorShape } from '../../src/common/authorization/client-maintenance-actor';

/**
 * TNB maintenance rank matrix (docs/PLAN-maintenance-flow.md §4.2, owner-locked
 * 2026-09-26): FOREMAN + TECHNICIAN act, ENGINEER is view-only, and a rank is
 * only ever honoured on a CLIENT user inside an ACTIVE TNB organization.
 */
const tnb = { type: OrganizationType.TNB, isActive: true };

const shape = (
  overrides: Partial<Parameters<typeof hasClientMaintenanceActorShape>[0]> = {},
) => ({
  role: UserRole.CLIENT,
  clientRank: ClientRank.FOREMAN as ClientRank | null,
  organization: tnb as { type: OrganizationType; isActive: boolean } | null,
  ...overrides,
});

describe('hasClientMaintenanceActorShape', () => {
  it.each([
    [ClientRank.FOREMAN, true],
    [ClientRank.TECHNICIAN, true],
    [ClientRank.ENGINEER, false],
  ])('TNB %s → %s', (clientRank, expected) => {
    expect(hasClientMaintenanceActorShape(shape({ clientRank }))).toBe(expected);
  });

  it('no rank → read-only', () => {
    expect(hasClientMaintenanceActorShape(shape({ clientRank: null }))).toBe(false);
  });

  it('a rank on a non-CLIENT role is ignored', () => {
    for (const role of [
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.SUPERVISOR,
      UserRole.TECHNICIAN,
      UserRole.VIEWER,
    ]) {
      expect(hasClientMaintenanceActorShape(shape({ role }))).toBe(false);
    }
  });

  it('a rank outside a TNB organization is ignored', () => {
    for (const type of [
      OrganizationType.ASCURE,
      OrganizationType.MAIN_CONTRACTOR,
      OrganizationType.SUBCONTRACTOR,
      OrganizationType.CLIENT,
    ]) {
      expect(
        hasClientMaintenanceActorShape(
          shape({ organization: { type, isActive: true } }),
        ),
      ).toBe(false);
    }
    expect(hasClientMaintenanceActorShape(shape({ organization: null }))).toBe(false);
  });

  it('a deactivated TNB organization loses its authority', () => {
    expect(
      hasClientMaintenanceActorShape(
        shape({ organization: { type: OrganizationType.TNB, isActive: false } }),
      ),
    ).toBe(false);
  });
});

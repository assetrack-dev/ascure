import { OrganizationWorkMode, UserRole } from '@prisma/client';
import { resolveWorkspace, WorkspaceShape } from '../../src/common/authorization/workspace';

/**
 * Plan §21 (R1): which web console a user gets. Navigation only — the API scope
 * checks are unchanged — but a wrong answer here would show the wrong menu, so
 * the matrix is pinned.
 */
const shape = (overrides: Partial<WorkspaceShape> = {}): WorkspaceShape => ({
  role: UserRole.MANAGER,
  workMode: null,
  isClientViewer: false,
  isClientSupervisor: false,
  canGovernQa: false,
  ...overrides,
});

describe('resolveWorkspace', () => {
  it('ADMIN always gets the full console, whatever else is set', () => {
    expect(
      resolveWorkspace(
        shape({ role: UserRole.ADMIN, workMode: OrganizationWorkMode.MAINTENANCE, canGovernQa: true }),
      ),
    ).toBe('ADMIN');
  });

  it('a client viewer gets TNB; the Supervisor rank its own workspace', () => {
    expect(resolveWorkspace(shape({ role: UserRole.CLIENT, isClientViewer: true }))).toBe('TNB');
    expect(
      resolveWorkspace(
        shape({ role: UserRole.CLIENT, isClientViewer: true, isClientSupervisor: true }),
      ),
    ).toBe('TNB_SUPERVISOR');
  });

  it('a DC keeps the classic console for now (R9)', () => {
    expect(
      resolveWorkspace(shape({ canGovernQa: true, workMode: OrganizationWorkMode.SURVEY })),
    ).toBe('CLASSIC');
  });

  it('no Web view set → classic console for every contractor role', () => {
    for (const role of [UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.TECHNICIAN, UserRole.VIEWER]) {
      expect(resolveWorkspace(shape({ role }))).toBe('CLASSIC');
    }
  });

  it.each([
    [OrganizationWorkMode.SURVEY, 'COMPANY_SURVEY'],
    [OrganizationWorkMode.MAINTENANCE, 'COMPANY_MAINTENANCE'],
    [OrganizationWorkMode.BOTH, 'COMPANY_BOTH'],
  ])('manager / supervisor with Web view %s → %s', (workMode, expected) => {
    expect(resolveWorkspace(shape({ role: UserRole.MANAGER, workMode }))).toBe(expected);
    expect(resolveWorkspace(shape({ role: UserRole.SUPERVISOR, workMode }))).toBe(expected);
  });

  it('technician / viewer in a company with a Web view → field crew', () => {
    for (const role of [UserRole.TECHNICIAN, UserRole.VIEWER]) {
      expect(
        resolveWorkspace(shape({ role, workMode: OrganizationWorkMode.MAINTENANCE })),
      ).toBe('FIELD_CREW');
    }
  });

  it('a CLIENT role outside a client org falls back to classic', () => {
    expect(
      resolveWorkspace(shape({ role: UserRole.CLIENT, workMode: OrganizationWorkMode.SURVEY })),
    ).toBe('CLASSIC');
  });
});

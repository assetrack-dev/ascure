import { UserRole } from '@prisma/client';
import { siteVisitAccessWhere } from '../../src/common/authorization/site-visit-scope';
import { ScopeContext } from '../../src/common/authorization/scope-context';
import { RequestUser } from '../../src/common/interfaces/request-user.interface';

/**
 * Unit-level pin for the canonical visibility matrix. The e2e suite proves the
 * matrix end-to-end through HTTP; these tests pin the exact where-clause SHAPE
 * per role so a refactor that quietly changes a branch is caught at the source —
 * no DB or app needed (the helper is pure).
 */
const USER_ID = 'user-1';

const user = (overrides: Partial<RequestUser> = {}): RequestUser => ({
  id: USER_ID,
  tenantId: 'tenant-1',
  email: 'u@authz.test',
  name: 'U',
  role: UserRole.TECHNICIAN,
  organizationId: null,
  ...overrides,
});

const ctx = (overrides: Partial<ScopeContext> = {}): ScopeContext => ({
  isAdmin: false,
  isQa: false,
  qaMainheadIds: [],
  maintenanceOrgIds: [],
  ...overrides,
});

const ownTeam = { members: { some: { userId: USER_ID, isActive: true } } };

describe('siteVisitAccessWhere — canonical visibility matrix (unit)', () => {
  it('ADMIN → empty filter (full tenant visibility)', () => {
    expect(siteVisitAccessWhere(user({ role: UserRole.ADMIN }))).toEqual({});
  });

  it('ctx.isAdmin short-circuits to empty even when the role is lower', () => {
    expect(
      siteVisitAccessWhere(
        user({ role: UserRole.MANAGER, organizationId: 'org-a' }),
        ctx({ isAdmin: true }),
      ),
    ).toEqual({});
  });

  it('QA actor → scoped to their accessible MAINHEADs', () => {
    expect(
      siteVisitAccessWhere(
        user({ role: UserRole.VIEWER }),
        ctx({ isQa: true, qaMainheadIds: ['mh-1', 'mh-2'] }),
      ),
    ).toEqual({ mainheadId: { in: ['mh-1', 'mh-2'] } });
  });

  it('QA actor with no MAINHEAD access → scoped to nothing (mainheadId in [])', () => {
    expect(
      siteVisitAccessWhere(user({ role: UserRole.VIEWER }), ctx({ isQa: true, qaMainheadIds: [] })),
    ).toEqual({ mainheadId: { in: [] } });
  });

  it('MANAGER with an org → every team in the org OR their own teams', () => {
    expect(
      siteVisitAccessWhere(user({ role: UserRole.MANAGER, organizationId: 'org-a' })),
    ).toEqual({ team: { OR: [{ organizationId: 'org-a' }, ownTeam] } });
  });

  it('MANAGER WITHOUT an org → own teams only, never tenant-wide (security default)', () => {
    expect(
      siteVisitAccessWhere(user({ role: UserRole.MANAGER, organizationId: null })),
    ).toEqual({ team: ownTeam });
  });

  it('SUPERVISOR → explicitly-supervised teams OR their own teams', () => {
    expect(siteVisitAccessWhere(user({ role: UserRole.SUPERVISOR }))).toEqual({
      team: {
        OR: [
          { supervisors: { some: { supervisorUserId: USER_ID, isActive: true } } },
          ownTeam,
        ],
      },
    });
  });

  it.each([UserRole.TECHNICIAN, UserRole.VIEWER, UserRole.CLIENT])(
    '%s → own teams only',
    (role) => {
      expect(siteVisitAccessWhere(user({ role }))).toEqual({ team: ownTeam });
    },
  );
});

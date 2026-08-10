import { UserRole } from '@prisma/client';
import {
  siteVisitAccessWhere,
  siteVisitOversightWhere,
} from '../../src/common/authorization/site-visit-scope';
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
  crossTeamMainheadIds: [],
  // Required since the client (TNB) branch landed — a default of "not a client"
  // keeps every contractor case below unchanged.
  isClientViewer: false,
  clientMainheadIds: [],
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

describe('siteVisitOversightWhere — read-only main-contractor oversight (unit)', () => {
  it('MANAGER → widens to the company subcontractor subtree (ctx.maintenanceOrgIds)', () => {
    expect(
      siteVisitOversightWhere(
        user({ role: UserRole.MANAGER, organizationId: 'org-main' }),
        ctx({ maintenanceOrgIds: ['org-main', 'org-sub-1', 'org-sub-2'] }),
      ),
    ).toEqual({
      team: {
        OR: [
          { organizationId: { in: ['org-main', 'org-sub-1', 'org-sub-2'] } },
          ownTeam,
        ],
      },
    });
  });

  it('MANAGER with no subcontractors (maintenanceOrgIds = [own]) → own org only', () => {
    expect(
      siteVisitOversightWhere(
        user({ role: UserRole.MANAGER, organizationId: 'org-main' }),
        ctx({ maintenanceOrgIds: ['org-main'] }),
      ),
    ).toEqual({
      team: { OR: [{ organizationId: { in: ['org-main'] } }, ownTeam] },
    });
  });

  it('MANAGER without a ctx → falls back to the strict own-org scalar filter', () => {
    expect(
      siteVisitOversightWhere(
        user({ role: UserRole.MANAGER, organizationId: 'org-main' }),
      ),
    ).toEqual({ team: { OR: [{ organizationId: 'org-main' }, ownTeam] } });
  });

  it('MANAGER with an empty maintenanceOrgIds → strict own-org scalar (no widening)', () => {
    expect(
      siteVisitOversightWhere(
        user({ role: UserRole.MANAGER, organizationId: 'org-main' }),
        ctx({ maintenanceOrgIds: [] }),
      ),
    ).toEqual({ team: { OR: [{ organizationId: 'org-main' }, ownTeam] } });
  });

  it.each([UserRole.SUPERVISOR, UserRole.TECHNICIAN, UserRole.VIEWER])(
    '%s → oversight is a no-op (identical to the strict scope even with child orgs in ctx)',
    (role) => {
      const u = user({ role, organizationId: 'org-main' });
      const c = ctx({ maintenanceOrgIds: ['org-main', 'org-sub-1'] });
      expect(siteVisitOversightWhere(u, c)).toEqual(siteVisitAccessWhere(u, c));
    },
  );

  it('ADMIN / QA short-circuits are unchanged in the oversight variant', () => {
    expect(siteVisitOversightWhere(user({ role: UserRole.ADMIN }))).toEqual({});
    expect(
      siteVisitOversightWhere(
        user({ role: UserRole.VIEWER }),
        ctx({ isQa: true, qaMainheadIds: ['mh-1'] }),
      ),
    ).toEqual({ mainheadId: { in: ['mh-1'] } });
  });
});

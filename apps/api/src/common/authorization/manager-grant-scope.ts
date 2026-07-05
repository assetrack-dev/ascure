import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Governance capabilities a MANAGER must never grant (privilege escalation):
 * - QA_VALIDATION — defect governance authority.
 * - REPORTING     — data export; effective at team/branch/org level
 *                   (resolveCanReport), so a manager granting it to a team would
 *                   hand their crew export access.
 *
 * Server-side twin of the client `capability-groups.ts` GOVERNANCE group. A
 * manager may grant only WORKSPACE (INSPECTION/MAINTENANCE) and ASSET_DOMAIN
 * capabilities — those are operational, not authority.
 */
export const GOVERNANCE_CAPABILITY_CODES: ReadonlySet<string> = new Set([
  'QA_VALIDATION',
  'REPORTING',
]);

export function isGovernanceCapabilityCode(
  code: string | null | undefined,
): boolean {
  return GOVERNANCE_CAPABILITY_CODES.has((code ?? '').trim().toUpperCase());
}

/**
 * Assert every MAINHEAD id belongs to the actor's own company. A MAINHEAD belongs
 * to a company when EITHER:
 *  - it is explicitly assigned to the company (OrganizationMainhead, active) — the
 *    ADMIN-curated set, which works for region-scoped MAINHEADs (no branch); OR
 *  - its branch is in the company (`branch.organizationId`) — the legacy link,
 *    kept so branch-scoped setups keep working without re-assignment.
 * Rejects a foreign-company MAINHEAD and an unknown id. Used to bound what a
 * MANAGER may attach to a team/user.
 */
export async function assertMainheadsInOwnCompany(
  tx: Prisma.TransactionClient,
  organizationId: string | null | undefined,
  mainheadIds: string[],
): Promise<void> {
  if (mainheadIds.length === 0) {
    return;
  }
  if (!organizationId) {
    throw new ForbiddenException(
      'Your account is not linked to a company, so you cannot assign MAINHEADs.',
    );
  }

  const rows = await tx.mainhead.findMany({
    where: { id: { in: mainheadIds } },
    select: {
      id: true,
      branch: { select: { organizationId: true } },
      organizationAssignments: {
        where: { organizationId, isActive: true },
        select: { id: true },
      },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const id of mainheadIds) {
    const mainhead = byId.get(id);
    if (!mainhead) {
      throw new NotFoundException('MAINHEAD not found.');
    }
    const assignedToCompany = mainhead.organizationAssignments.length > 0;
    const branchInCompany = mainhead.branch?.organizationId === organizationId;
    if (!assignedToCompany && !branchInCompany) {
      throw new ForbiddenException(
        'You can only assign MAINHEADs that belong to your own company.',
      );
    }
  }
}

/**
 * Return the subset of capability ids a MANAGER is allowed to grant — i.e. drop
 * every GOVERNANCE capability (and any unknown id). Preserves the caller's order
 * for the survivors. `[]` in → `[]` out.
 */
export async function filterNonGovernanceCapabilityIds(
  tx: Prisma.TransactionClient,
  capabilityIds: string[],
): Promise<string[]> {
  if (capabilityIds.length === 0) {
    return [];
  }
  const rows = await tx.capability.findMany({
    where: { id: { in: capabilityIds } },
    select: { id: true, code: true },
  });
  const allowed = new Set(
    rows
      .filter((row) => !isGovernanceCapabilityCode(row.code))
      .map((row) => row.id),
  );
  return capabilityIds.filter((id) => allowed.has(id));
}

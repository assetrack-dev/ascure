import { UserRole } from '@prisma/client';
import { RequestUser } from '../interfaces/request-user.interface';
import { UsersService } from '../../users/users.service';

export const REPORTING_CAPABILITY_CODE = 'REPORTING';

/**
 * Resolves whether a user may access reporting / export features.
 *
 * Authority follows the canonical effective-capability model
 * (User + Team + Branch + Organization) resolved by
 * `UsersService.getCurrentUserCapabilities` — the same resolver used elsewhere
 * for operational authority. ADMIN always qualifies (the resolver already
 * returns every capability for ADMIN; we short-circuit to skip the extra
 * query). Note this is intentionally broader than `isQaActor` (which is a
 * narrow user-level QA check): REPORTING may be granted at the organization,
 * branch or team level, and the seed grants it on the ASCURE organization.
 *
 * Exposed as a `canReport` flag on login + /auth/me so the admin UI can gate
 * the Reports area exactly when the API would authorize it, instead of guessing
 * from role (MANAGER/SUPERVISOR/TECHNICIAN all normalize to VIEWER client-side).
 * It does NOT change or weaken the server-side authorization, which is enforced
 * independently in ReportsService.
 */
export async function resolveCanReport(
  usersService: UsersService,
  user: RequestUser,
): Promise<boolean> {
  if (user.role === UserRole.ADMIN) {
    return true;
  }

  const capabilities = await usersService.getCurrentUserCapabilities(user);

  return capabilities.some(
    (capability) => capability.code === REPORTING_CAPABILITY_CODE,
  );
}

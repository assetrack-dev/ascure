import { UserRole } from '@prisma/client';
import { RequestUser } from '../interfaces/request-user.interface';
import { UsersService } from '../../users/users.service';

export const IMPORT_CAPABILITY_CODE = 'IMPORT';

/**
 * Resolves whether a user may run AppSheet/bulk imports. ADMIN always qualifies;
 * otherwise the user must hold an effective IMPORT capability
 * (User + Team + Branch + Organization), resolved by the canonical resolver
 * UsersService.getCurrentUserCapabilities. Mirrors resolveCanReport. Enforced
 * server-side in ImportsService.
 */
export async function resolveCanImport(
  usersService: UsersService,
  user: RequestUser,
): Promise<boolean> {
  if (user.role === UserRole.ADMIN) {
    return true;
  }

  const capabilities = await usersService.getCurrentUserCapabilities(user);

  return capabilities.some(
    (capability) => capability.code === IMPORT_CAPABILITY_CODE,
  );
}

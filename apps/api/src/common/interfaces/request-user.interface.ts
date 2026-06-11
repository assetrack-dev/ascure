import { UserRole } from '@prisma/client';

export interface RequestUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string | null;
}

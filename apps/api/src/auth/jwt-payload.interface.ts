import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: UserRole;
  // Present only on mobile-app tokens (single-device, long-lived sessions).
  // `client` marks the token's origin; `sid` is the login session id the JWT
  // guard checks against the user's current `mobileSessionId` to enforce one
  // active phone per account. Both are absent on admin-web tokens.
  client?: 'mobile';
  sid?: string;
}

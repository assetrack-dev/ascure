import { OrganizationWorkMode, UserRole } from '@prisma/client';

/**
 * Plan §21 (R1): the web console a user gets — menu, home page and header — from
 * role + company type + company Web view + TNB rank. Navigation only: every
 * endpoint keeps its own scope checks, so a wrong workspace can never widen data.
 *
 *  - ADMIN                → full console + Setup (+ "Preview as").
 *  - client viewer (TNB / CLIENT org) → TNB, or TNB_SUPERVISOR for that rank.
 *  - DC (ASCURE QA actor) → CLASSIC for now (R9: DC workspace later).
 *  - contractor with no Web view set → CLASSIC (today's console, unchanged until
 *    Admin sets it on the company).
 *  - contractor MANAGER / SUPERVISOR → COMPANY_SURVEY / _MAINTENANCE / _BOTH.
 *  - contractor TECHNICIAN / VIEWER  → FIELD_CREW (small read-only view, R5).
 *
 * The admin web mirrors this in lib/workspaces.ts ONLY for a session cached
 * before this field existed — keep the two in step.
 */
export const WORKSPACES = [
  'ADMIN',
  'TNB',
  'TNB_SUPERVISOR',
  'COMPANY_SURVEY',
  'COMPANY_MAINTENANCE',
  'COMPANY_BOTH',
  'FIELD_CREW',
  'CLASSIC',
] as const;

export type Workspace = (typeof WORKSPACES)[number];

export interface WorkspaceShape {
  role: UserRole;
  /** resolveWorkMode(): null unless an active contractor company set one. */
  workMode: OrganizationWorkMode | null;
  isClientViewer: boolean;
  isClientSupervisor: boolean;
  /** canGovernQa — ADMIN or an ASCURE QA_VALIDATION actor (never VIEWER/CLIENT). */
  canGovernQa: boolean;
}

export function resolveWorkspace(user: WorkspaceShape): Workspace {
  if (user.role === UserRole.ADMIN) return 'ADMIN';
  if (user.isClientViewer) return user.isClientSupervisor ? 'TNB_SUPERVISOR' : 'TNB';
  if (user.canGovernQa) return 'CLASSIC';
  if (!user.workMode) return 'CLASSIC';

  if (user.role === UserRole.TECHNICIAN || user.role === UserRole.VIEWER) {
    return 'FIELD_CREW';
  }
  if (user.role === UserRole.MANAGER || user.role === UserRole.SUPERVISOR) {
    switch (user.workMode) {
      case OrganizationWorkMode.SURVEY:
        return 'COMPANY_SURVEY';
      case OrganizationWorkMode.MAINTENANCE:
        return 'COMPANY_MAINTENANCE';
      case OrganizationWorkMode.BOTH:
        return 'COMPANY_BOTH';
    }
  }
  return 'CLASSIC';
}

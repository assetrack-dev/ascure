/**
 * Pilot Execution Sprint — canonical capability allow-list.
 *
 * Only these codes may be assigned through the capability assignment pickers
 * (Organization, Branch, MAINHEAD, Team, User). Legacy capability rows
 * (SURVEY, REPAIR, CIVIL, DISTRIBUTION, THIRTY_THREE_KV, EMERGENCY_RESPONSE,
 * OTHER) seeded by the Sprint G1 migration remain in the `Capability` table
 * and on any existing assignment rows, but are not assignable from the UI.
 *
 * The catalogue management endpoint (GET /enterprise/capabilities) continues
 * to expose every row regardless of canonical status so legacy records remain
 * visible and editable from the Capabilities page.
 */
/**
 * Workspace Access codes gate which mobile workspaces (Inspection /
 * Maintenance) a user may enter. Unlike other groups, a DIRECT user-level
 * assignment of any of these codes is an explicit per-user workspace
 * selection: it OVERRIDES workspace codes inherited from Team / Branch /
 * Organization (most-specific wins). Users with no direct workspace
 * assignment still inherit as before.
 */
export const WORKSPACE_CAPABILITY_CODES: ReadonlySet<string> = new Set([
  'INSPECTION',
  'MAINTENANCE',
]);

export const CANONICAL_CAPABILITY_CODES: ReadonlySet<string> = new Set([
  // Workspace Access
  'INSPECTION',
  'MAINTENANCE',
  // Governance & Reporting
  'QA_VALIDATION',
  'REPORTING',
  'IMPORT',
  // Asset Domains
  'SAVR',
  'SAVT',
  'PENCAWANG',
  'FEEDER_PILLAR',
  'LINK_BOX',
  'CABLE_BRIDGE',
  'UNDERGROUND_CABLE',
  'THERMAL_INSPECTION',
]);

/**
 * Governance G2 — MAINHEAD Capability Restriction.
 *
 * MAINHEADs may only be assigned Asset Domain capabilities. Workspace Access
 * and Governance & Reporting codes are not assignable to MAINHEADs and are
 * rejected by the syncMainheadCapabilities validator.
 *
 * MAINHEAD remains an operational-scope label; user authority is resolved
 * exclusively from User + Team + Branch + Organization assignments by
 * UsersService.getEffectiveCapabilitiesForUser().
 */
export const MAINHEAD_ASSIGNABLE_CAPABILITY_CODES: ReadonlySet<string> = new Set([
  'SAVR',
  'SAVT',
  'PENCAWANG',
  'FEEDER_PILLAR',
  'LINK_BOX',
  'CABLE_BRIDGE',
  'UNDERGROUND_CABLE',
  'THERMAL_INSPECTION',
]);

export function isCanonicalCapabilityCode(
  code: string | null | undefined,
): boolean {
  if (typeof code !== 'string') {
    return false;
  }

  return CANONICAL_CAPABILITY_CODES.has(code.trim().toUpperCase());
}

export function isMainheadAssignableCapabilityCode(
  code: string | null | undefined,
): boolean {
  if (typeof code !== 'string') {
    return false;
  }

  return MAINHEAD_ASSIGNABLE_CAPABILITY_CODES.has(code.trim().toUpperCase());
}

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
export const CANONICAL_CAPABILITY_CODES: ReadonlySet<string> = new Set([
  // Workspace Access
  'INSPECTION',
  'MAINTENANCE',
  // Governance & Reporting
  'QA_VALIDATION',
  'REPORTING',
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

export function isCanonicalCapabilityCode(
  code: string | null | undefined,
): boolean {
  if (typeof code !== 'string') {
    return false;
  }

  return CANONICAL_CAPABILITY_CODES.has(code.trim().toUpperCase());
}

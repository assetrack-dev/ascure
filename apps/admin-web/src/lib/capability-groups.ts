export type CapabilityGroupKey =
  | "WORKSPACE"
  | "GOVERNANCE"
  | "ASSET_DOMAIN";

export interface CapabilityGroupConfig {
  key: CapabilityGroupKey;
  title: string;
  caption: string;
}

export const CAPABILITY_GROUPS: CapabilityGroupConfig[] = [
  {
    key: "WORKSPACE",
    title: "Workspace Access",
    caption: "Lets users enter this mobile workspace.",
  },
  {
    key: "GOVERNANCE",
    title: "Governance & Reporting",
    caption: "Cross-MAINHEAD authority and reporting access.",
  },
  {
    key: "ASSET_DOMAIN",
    title: "Asset Domains",
    caption: "Asset classes this entity is authorised to operate on.",
  },
];

const WORKSPACE_CODES: ReadonlySet<string> = new Set([
  "INSPECTION",
  "MAINTENANCE",
]);

const GOVERNANCE_CODES: ReadonlySet<string> = new Set([
  "QA_VALIDATION",
  "REPORTING",
]);

const ASSET_DOMAIN_CODES: ReadonlySet<string> = new Set([
  "SAVR",
  "SAVT",
  "PENCAWANG",
  "FEEDER_PILLAR",
  "LINK_BOX",
  "CABLE_BRIDGE",
  "UNDERGROUND_CABLE",
  "THERMAL_INSPECTION",
]);

/**
 * Pilot Execution Sprint canonical allow-list.
 *
 * Only capabilities whose code appears in this union of three group sets are
 * assignable from the User / Organization / Branch / MAINHEAD / Team pickers.
 * Legacy capability rows (SURVEY, REPAIR, CIVIL, DISTRIBUTION, THIRTY_THREE_KV,
 * EMERGENCY_RESPONSE, OTHER) seeded by the Sprint G1 migration are excluded
 * here and additionally filtered server-side in `/enterprise/options`.
 */
export const CANONICAL_CAPABILITY_CODES: ReadonlySet<string> = new Set([
  ...WORKSPACE_CODES,
  ...GOVERNANCE_CODES,
  ...ASSET_DOMAIN_CODES,
]);

export function isCanonicalCapabilityCode(
  code: string | null | undefined,
): boolean {
  return CANONICAL_CAPABILITY_CODES.has(normalizeCode(code));
}

export interface AssignableFilterInput {
  code?: string | null;
  isActive?: boolean | null;
}

/**
 * Predicate used by the assignment pickers. Drops anything not in the
 * canonical allow-list, plus anything explicitly marked inactive. Capabilities
 * with an undefined isActive flag are treated as active (forward-compatible
 * with API responses that omit the field).
 */
export function isAssignableCapability(
  capability: AssignableFilterInput,
): boolean {
  if (capability.isActive === false) {
    return false;
  }

  return isCanonicalCapabilityCode(capability.code);
}

function normalizeCode(code: string | null | undefined) {
  return (code ?? "").trim().toUpperCase();
}

/**
 * Map a capability code to one of three pilot groups.
 *
 * Workspace gates  : INSPECTION, MAINTENANCE
 * Governance roles : QA_VALIDATION, REPORTING
 * Asset domains    : everything else (SAVR, SAVT, PENCAWANG, FEEDER_PILLAR,
 *                    LINK_BOX, CABLE_BRIDGE, UNDERGROUND_CABLE,
 *                    THERMAL_INSPECTION, plus any future contractor-specific
 *                    domains the seed may add)
 */
export function capabilityGroupFor(
  code: string | null | undefined,
): CapabilityGroupKey {
  const normalized = normalizeCode(code);

  if (WORKSPACE_CODES.has(normalized)) {
    return "WORKSPACE";
  }

  if (GOVERNANCE_CODES.has(normalized)) {
    return "GOVERNANCE";
  }

  return "ASSET_DOMAIN";
}

export interface CapabilityLike {
  id: string;
  name: string;
  code?: string | null;
}

export interface CapabilityGroup<T extends CapabilityLike> {
  key: CapabilityGroupKey;
  title: string;
  caption: string;
  items: T[];
}

/**
 * Per-context allow-lists used by the assignment pickers.
 *
 * Governance G2 (MAINHEAD Capability Restriction) — the MAINHEAD picker is
 * limited to Asset Domains. Organization / Branch / Team / User pickers
 * continue to show all three groups.
 */
export const MAINHEAD_PICKER_GROUP_KEYS: ReadonlyArray<CapabilityGroupKey> = [
  "ASSET_DOMAIN",
];

/**
 * Bucket the provided capabilities into the three pilot groups, in the
 * canonical order defined by CAPABILITY_GROUPS. Empty groups are dropped so
 * the picker only renders sections that have at least one capability.
 */
export function groupCapabilities<T extends CapabilityLike>(
  capabilities: ReadonlyArray<T>,
): CapabilityGroup<T>[] {
  const buckets = new Map<CapabilityGroupKey, T[]>();

  for (const config of CAPABILITY_GROUPS) {
    buckets.set(config.key, []);
  }

  for (const capability of capabilities) {
    const key = capabilityGroupFor(capability.code);
    const bucket = buckets.get(key);

    if (bucket) {
      bucket.push(capability);
    }
  }

  return CAPABILITY_GROUPS.flatMap((config) => {
    const items = buckets.get(config.key) ?? [];

    if (items.length === 0) {
      return [];
    }

    return [
      {
        key: config.key,
        title: config.title,
        caption: config.caption,
        items,
      },
    ];
  });
}

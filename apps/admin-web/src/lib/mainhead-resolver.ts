import type { EnterpriseOptionRecord } from "@/types/enterprise";

export interface ResolverRegionRef {
  id: string;
  name: string;
  code?: string | null;
}

export interface ResolvedMainhead {
  id: string;
  name: string;
  code?: string | null;
  /**
   * The region the user picked that pulled this MAINHEAD in via inheritance.
   * Null when the MAINHEAD was added through direct MAINHEAD access.
   */
  viaRegion: ResolverRegionRef | null;
}

export interface EffectiveMainheads {
  /**
   * MAINHEADs added through direct access only (not also inherited via a
   * picked region). Always represented in the picker.
   */
  direct: ResolvedMainhead[];
  /**
   * MAINHEADs inherited from picked regions, grouped by the region that
   * provided them. A MAINHEAD that was also picked directly appears in
   * `direct` and is excluded from `viaRegion` to avoid double counting.
   */
  viaRegion: Array<{
    region: ResolverRegionRef;
    mainheads: ResolvedMainhead[];
  }>;
  /**
   * All MAINHEADs the user will effectively see (union of direct +
   * viaRegion), deduped and sorted by display label.
   */
  effective: ResolvedMainhead[];
}

function displayLabel(option: { name: string; code?: string | null }) {
  return option.code ? `${option.code} - ${option.name}` : option.name;
}

function compareByLabel<T extends { name: string; code?: string | null }>(
  left: T,
  right: T,
) {
  return displayLabel(left).localeCompare(displayLabel(right), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Mirrors steps 1 and 2 of the V10 MAINHEAD Visibility Algorithm:
 *
 *   1. UserMainheadAccess         → direct
 *   2. UserOperationalRegionAccess → viaRegion (every MAINHEAD whose
 *                                    operationalRegionId is one of the
 *                                    picked regionIds)
 *
 * Steps 3–7 (team / branch / legacy / ADMIN / QA overrides) are
 * intentionally not modelled here — they belong to the runtime resolver,
 * not the admin-time preview.
 */
export function resolveEffectiveMainheads(input: {
  directIds: ReadonlyArray<string>;
  regionIds: ReadonlyArray<string>;
  mainheads: ReadonlyArray<EnterpriseOptionRecord>;
  regions: ReadonlyArray<EnterpriseOptionRecord>;
}): EffectiveMainheads {
  const directIdSet = new Set(input.directIds);
  const regionIdSet = new Set(input.regionIds);

  const regionById = new Map<string, ResolverRegionRef>();

  for (const region of input.regions) {
    if (regionIdSet.has(region.id)) {
      regionById.set(region.id, {
        id: region.id,
        name: region.name,
        code: region.code ?? null,
      });
    }
  }

  const directOnly: ResolvedMainhead[] = [];
  const viaRegionBuckets = new Map<string, ResolvedMainhead[]>();

  for (const mainhead of input.mainheads) {
    const inheritedFrom =
      mainhead.operationalRegionId &&
      regionIdSet.has(mainhead.operationalRegionId)
        ? regionById.get(mainhead.operationalRegionId) ?? null
        : null;
    const isDirect = directIdSet.has(mainhead.id);

    if (!isDirect && !inheritedFrom) {
      continue;
    }

    const resolved: ResolvedMainhead = {
      id: mainhead.id,
      name: mainhead.name,
      code: mainhead.code ?? null,
      viaRegion: !isDirect && inheritedFrom ? inheritedFrom : null,
    };

    if (isDirect) {
      directOnly.push(resolved);
      continue;
    }

    if (inheritedFrom) {
      const bucket = viaRegionBuckets.get(inheritedFrom.id) ?? [];
      bucket.push(resolved);
      viaRegionBuckets.set(inheritedFrom.id, bucket);
    }
  }

  directOnly.sort(compareByLabel);

  const viaRegionGrouped: EffectiveMainheads["viaRegion"] = [];

  for (const region of regionById.values()) {
    const bucket = viaRegionBuckets.get(region.id) ?? [];
    bucket.sort(compareByLabel);
    if (bucket.length > 0) {
      viaRegionGrouped.push({ region, mainheads: bucket });
    }
  }

  viaRegionGrouped.sort((left, right) =>
    compareByLabel(left.region, right.region),
  );

  const effectiveById = new Map<string, ResolvedMainhead>();

  for (const item of directOnly) {
    effectiveById.set(item.id, item);
  }

  for (const group of viaRegionGrouped) {
    for (const item of group.mainheads) {
      if (!effectiveById.has(item.id)) {
        effectiveById.set(item.id, item);
      }
    }
  }

  const effective = Array.from(effectiveById.values()).sort(compareByLabel);

  return {
    direct: directOnly,
    viaRegion: viaRegionGrouped,
    effective,
  };
}

export function formatMainheadLabel(option: ResolvedMainhead) {
  return displayLabel(option);
}

export function formatRegionLabel(region: ResolverRegionRef) {
  return displayLabel(region);
}

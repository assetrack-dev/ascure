import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export type MapLevel = 'region' | 'mainhead' | 'pencawang' | 'points';

/**
 * Query for GET /assets/map. Without `level` the endpoint returns the legacy
 * full per-asset list; with a level it drives the hierarchical drill-down
 * (see docs/PLAN-hierarchical-map.md). Parent ids scope one level to its parent.
 *
 * The filter params (inspected / assetTypeIds / categories / defectsOnly) fold
 * into the WHERE at EVERY level, so they narrow the bubble counts and the leaf
 * points alike. They are orthogonal to the hierarchy (region/mainhead/pencawang
 * are the drill-down, not filters).
 */
export class MapQueryDto {
  @IsOptional()
  @IsIn(['region', 'mainhead', 'pencawang', 'points'])
  level?: MapLevel;

  /** mainhead level: restrict to mainheads in this Region. */
  @IsOptional()
  @IsUUID()
  regionId?: string;

  /** pencawang level: restrict to Pencawang under this Mainhead. */
  @IsOptional()
  @IsUUID()
  mainheadId?: string;

  /** points level (required): individual poles in this Pencawang. */
  @IsOptional()
  @IsUUID()
  pencawangId?: string;

  /** Inspection filter: only inspected, or only not-yet-inspected poles. */
  @IsOptional()
  @IsIn(['inspected', 'not'])
  inspected?: 'inspected' | 'not';

  /** Comma-separated AssetType ids. */
  @IsOptional()
  @IsString()
  assetTypeIds?: string;

  /** Comma-separated MaintenanceCategory values (open-defect category). */
  @IsOptional()
  @IsString()
  categories?: string;

  /** "true" → only poles that carry an open defect. */
  @IsOptional()
  @IsString()
  defectsOnly?: string;
}

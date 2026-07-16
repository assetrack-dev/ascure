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

  /** points level: individual poles in this Pencawang. Provide EITHER this or
   *  `mainheadId` (the Mainhead-wide "show all poles" view). */
  @IsOptional()
  @IsUUID()
  pencawangId?: string;

  /** points level (Mainhead-wide): viewport bounds "minLng,minLat,maxLng,maxLat".
   *  When the points level is scoped by `mainheadId`, only poles inside this box
   *  are returned (capped) so the payload stays bounded as the user pans/zooms. */
  @IsOptional()
  @IsString()
  bbox?: string;

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

  /** Comma-separated Mainhead ids (a Pencawang's structural parent). */
  @IsOptional()
  @IsString()
  mainheadIds?: string;

  /** Comma-separated Pencawang (Substation) ids. */
  @IsOptional()
  @IsString()
  pencawangIds?: string;

  /** Comma-separated AssetStatus values. */
  @IsOptional()
  @IsString()
  statuses?: string;

  /** Comma-separated Team ids (via the pole's site visit). */
  @IsOptional()
  @IsString()
  teamIds?: string;
}

import { IsIn, IsOptional, IsUUID } from 'class-validator';

export type MapLevel = 'region' | 'mainhead' | 'pencawang' | 'points';

/**
 * Query for GET /assets/map. Without `level` the endpoint returns the legacy
 * full per-asset list; with a level it drives the hierarchical drill-down
 * (see docs/PLAN-hierarchical-map.md). Parent ids scope one level to its parent.
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
}

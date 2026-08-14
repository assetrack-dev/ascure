import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type RegistryLevel = 'region' | 'mainhead' | 'pencawang' | 'assets';

/**
 * Sentinel id for the "Unassigned" bucket at every registry level — a Pencawang
 * with no Mainhead, or a Mainhead with no Region. It must stay drillable (its
 * poles would otherwise be unreachable from the page), so the parent-id params
 * accept this literal beside a UUID.
 */
export const REGISTRY_UNASSIGNED = 'unassigned';

/**
 * Query for GET /assets/registry — the Assets page's lazy drill-down feed
 * (Region → Mainhead → Pencawang → the one Pencawang's asset rows), so the page
 * never loads the whole tenant at once. `search` (2+ chars) short-circuits the
 * hierarchy: a capped cross-scope match list for finding one pole by code.
 */
export class RegistryQueryDto {
  @IsOptional()
  @IsIn(['region', 'mainhead', 'pencawang', 'assets'])
  level?: RegistryLevel;

  /** mainhead level: restrict to Mainheads in this Region (or 'unassigned'). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  regionId?: string;

  /** pencawang level: restrict to Pencawang under this Mainhead (or 'unassigned'). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  mainheadId?: string;

  /** assets level: the one Pencawang whose rows to return. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  pencawangId?: string;

  /** Cross-scope pole search (asset code / old pole number), capped result. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

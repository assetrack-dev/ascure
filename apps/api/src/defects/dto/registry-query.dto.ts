import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type DefectRegistryLevel = 'region' | 'mainhead' | 'pencawang' | 'defects';

/**
 * Query for GET /defects/registry — the Defects page's lazy drill-down feed
 * (Region → Mainhead → Pencawang → the one Pencawang's defect rows), mirroring
 * the Assets registry so the page never loads the whole tenant's defect history
 * at once. `search` (2+ chars) short-circuits the hierarchy with a capped
 * cross-scope match on the pole code.
 */
export class DefectRegistryQueryDto {
  @IsOptional()
  @IsIn(['region', 'mainhead', 'pencawang', 'defects'])
  level?: DefectRegistryLevel;

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

  /** defects level: the one Pencawang whose defect rows to return. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  pencawangId?: string;

  /** Cross-scope pole-code search, capped result. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

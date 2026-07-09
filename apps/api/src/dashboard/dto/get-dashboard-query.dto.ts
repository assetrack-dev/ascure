import { IsIn, IsOptional } from 'class-validator';

/**
 * Preset time-range keys for the additive dashboard windowing. Kept as a small
 * fixed set (rather than free-form from/to) so the response `range.key` stays a
 * closed enum the frontend can switch on. Absent => the service defaults the new
 * range-scoped fields to 30d while leaving every pre-existing field untouched.
 */
export type DashboardRangeKey = '7d' | '30d' | '90d' | 'ytd';

export const DASHBOARD_RANGE_KEYS: readonly DashboardRangeKey[] = [
  '7d',
  '30d',
  '90d',
  'ytd',
];

export class GetDashboardQueryDto {
  // Whitelisted for the global ValidationPipe (forbidNonWhitelisted); an invalid
  // value 400s here, so the service can assume a valid key or undefined.
  @IsOptional()
  @IsIn(DASHBOARD_RANGE_KEYS as unknown as string[])
  range?: DashboardRangeKey;
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { useSession } from '../context/AuthContext';
import type { AppDrawerScreenProps } from '../navigation/types';
import {
  CrewPerformance,
  DailyTeamActivity,
  DailyTeamActivityTeam,
  DailyUserActivity,
  DashboardData,
  DashboardRecentDefect,
  DefectStatus,
} from '../types';
import { formatDateTime } from '../utils';
import { useCapabilities } from '../useCapabilities';
import {
  AppButton,
  BodyText,
  Card,
  ErrorBanner,
  Mono,
  Screen,
  SectionTitle,
  SkeletonCard,
  StatusSpineTile,
  type SpineTone,
} from '../ui';
import { Theme, useTheme } from '../theme';

export function DashboardScreen() {
  const navigation = useNavigation<AppDrawerScreenProps<'Dashboard'>['navigation']>();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { token, user, handleUnauthorized } = useSession();
  // Inspection-centric stats vs maintenance/defect stats are gated separately so
  // each crew sees only what's relevant to their work (requirement: don't show
  // defect numbers to an inspection-only team, or inspection counts to a
  // maintenance-only team).
  const { canInspect, canMaintain, loading: capsLoading } = useCapabilities();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [teamActivity, setTeamActivity] = useState<DailyTeamActivity | null>(null);
  const [userActivity, setUserActivity] = useState<DailyUserActivity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Daily per-team activity is a Manager/Supervisor monitoring view; technicians
  // don't see the card (and the API would only ever return their own team).
  const canSeeTeamActivity =
    user.role === 'ADMIN' || user.role === 'MANAGER' || user.role === 'SUPERVISOR';
  // Per-USER performance (monitor + pay) is a manager/admin view.
  const canSeePerUser = user.role === 'ADMIN' || user.role === 'MANAGER';

  // Defect stats belong to maintenance work + oversight roles. An inspection-only
  // technician shouldn't see defect numbers; a manager/supervisor oversees both.
  const showDefectStats = canMaintain || canSeeTeamActivity;

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const activityRequest = canSeeTeamActivity
        ? api.getDailyTeamActivity(token).catch((activityError) => {
            // A 401 must still sign the user out; any other failure (e.g. an
            // older API without this endpoint) just hides the card rather than
            // breaking the whole dashboard.
            if (activityError instanceof ApiError && activityError.status === 401) {
              throw activityError;
            }
            console.warn('[DASHBOARD] team activity unavailable', activityError);
            return null;
          })
        : Promise.resolve(null);

      const userActivityRequest = canSeePerUser
        ? api.getDailyUserActivity(token).catch((activityError) => {
            if (activityError instanceof ApiError && activityError.status === 401) {
              throw activityError;
            }
            console.warn('[DASHBOARD] user activity unavailable', activityError);
            return null;
          })
        : Promise.resolve(null);

      const [response, activity, userActivityData] = await Promise.all([
        api.getDashboard(token),
        activityRequest,
        userActivityRequest,
      ]);

      setDashboard(response);
      setTeamActivity(activity);
      setUserActivity(userActivityData);
    } catch (loadError) {
      console.error('[DASHBOARD LOAD ERROR]', loadError);

      if (loadError instanceof ApiError && loadError.status === 401) {
        await handleUnauthorized(loadError);
        return;
      }

      setDashboard(null);
      setTeamActivity(null);
      setUserActivity(null);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load dashboard.');
    } finally {
      setIsLoading(false);
    }
  }, [canSeePerUser, canSeeTeamActivity, handleUnauthorized, token]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return (
    <Screen
      title="Dashboard"
      leftAction={{
        icon: 'menu',
        onPress: () => navigation.openDrawer(),
        accessibilityLabel: 'Menu',
      }}
      rightAction={{
        icon: 'refresh',
        onPress: loadDashboard,
        accessibilityLabel: 'Refresh',
        disabled: isLoading,
      }}
    >
      <ErrorBanner message={error} />
      {/* Wait for BOTH the dashboard data AND the user's capabilities before
          deciding which cards to show — otherwise the body renders for a beat
          with every card gated off (caps still resolving) and the screen flashes
          empty. Suppress the skeleton once an error is shown (the Try Again card
          handles that). */}
      {(isLoading || capsLoading) && !error ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : null}

      {!isLoading && !capsLoading && dashboard ? (
        <>
          {/* Hero metric — the single "are we on track?" number, adapting to what
              the role can see. Inspection crews lead with inspections done; a
              maintenance-only crew leads with open defects. */}
          {canInspect ? (
            <HeroMetric
              value={dashboard.totalInspections}
              label="Inspections completed"
              caption={`${formatNumber(dashboard.totalAssets)} assets in scope`}
              coverage={
                dashboard.totalAssets > 0
                  ? dashboard.totalInspections / dashboard.totalAssets
                  : null
              }
            />
          ) : showDefectStats ? (
            <HeroMetric
              value={dashboard.openDefects}
              label="Open defects"
              caption={`${formatNumber(dashboard.totalDefects)} defects tracked`}
              coverage={
                dashboard.totalDefects > 0
                  ? dashboard.closedDefects / dashboard.totalDefects
                  : null
              }
              coverageLabel="closed"
              tone="danger"
            />
          ) : null}

          {/* Compact mini-stat cards below the hero (real totals only). */}
          {canInspect || showDefectStats ? (
            <View style={styles.miniRow}>
              {canInspect ? (
                <>
                  <MiniStat label="Total Assets" value={dashboard.totalAssets} />
                  <MiniStat label="Inspections" value={dashboard.totalInspections} />
                </>
              ) : null}
              {showDefectStats ? (
                <MiniStat label="Total Defects" value={dashboard.totalDefects} />
              ) : null}
            </View>
          ) : null}

          {/* Defects as a single proportion bar + legend with mono counts. */}
          {showDefectStats ? (
            <DefectBreakdown
              open={dashboard.openDefects}
              inProgress={dashboard.inProgressDefects}
              closed={dashboard.closedDefects}
            />
          ) : null}

          {canSeeTeamActivity && teamActivity ? (
            <TeamActivityCard activity={teamActivity} />
          ) : null}

          {canSeePerUser && userActivity ? (
            <UserActivityCard activity={userActivity} token={token} />
          ) : null}

          {showDefectStats ? (
            <Card>
              <SectionTitle>Recent Defects</SectionTitle>
              {dashboard.recentDefects.length === 0 ? (
                <BodyText muted>No recent defects found.</BodyText>
              ) : (
                dashboard.recentDefects.map((defect) => (
                  <StatusSpineTile
                    key={defect.id}
                    code={defect.assetCode || 'Unknown Asset'}
                    spine={spineForDefect(defect)}
                    chip={{
                      label: formatStatus(defect.status),
                      tone: getStatusTone(defect.status),
                    }}
                    secondary={defect.label}
                    meta={[formatDateTime(defect.createdAt)]}
                    onPress={() => navigation.navigate('DefectDetail', { defectId: defect.id })}
                  />
                ))
              )}
            </Card>
          ) : null}

          {/* A user with no inspection/maintenance/oversight scope would otherwise
              see a completely blank screen — give them an explanation instead. */}
          {!canInspect && !showDefectStats && !(canSeeTeamActivity && teamActivity) ? (
            <Card>
              <SectionTitle>No data for your role</SectionTitle>
              <BodyText muted>
                Your account has no inspection or maintenance workspace access yet.
                Contact your manager to be granted access.
              </BodyText>
            </Card>
          ) : null}
        </>
      ) : null}

      {!isLoading && error ? (
        <Card>
          <AppButton label="Try Again" variant="secondary" onPress={loadDashboard} />
        </Card>
      ) : null}
    </Screen>
  );
}

/**
 * The dark hero metric card (handoff 1c): a mono eyebrow, one big Space Grotesk
 * number, a caption, and — where a real ratio exists — a thin progress bar so
 * the number reads "against a whole" without inventing any figures.
 */
function HeroMetric({
  value,
  label,
  caption,
  coverage,
  coverageLabel = 'inspected',
  tone = 'primary',
}: {
  value: number;
  label: string;
  caption: string;
  coverage: number | null;
  coverageLabel?: string;
  tone?: 'primary' | 'danger';
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const accent = tone === 'danger' ? theme.colors.danger : theme.colors.primary;
  const pct = coverage !== null ? Math.max(0, Math.min(1, coverage)) : null;

  return (
    <View style={styles.hero}>
      <Text style={styles.heroEyebrow}>{label.toUpperCase()}</Text>
      <View style={styles.heroValueRow}>
        <Text style={styles.heroValue}>{formatNumber(value)}</Text>
      </View>
      <Text style={styles.heroCaption}>{caption}</Text>

      {pct !== null ? (
        <View style={styles.heroProgressWrap}>
          <View style={styles.heroTrack}>
            <View
              style={[
                styles.heroFill,
                { width: `${Math.round(pct * 100)}%`, backgroundColor: accent },
              ]}
            />
          </View>
          <Text style={styles.heroProgressLabel}>
            <Text style={styles.heroProgressPct}>{Math.round(pct * 100)}%</Text>{' '}
            {coverageLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.miniCard}>
      <Text style={styles.miniValue}>{formatNumber(value)}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}

const DEFECT_SEGMENTS = [
  { key: 'open', label: 'Open', tone: 'warning' as const },
  { key: 'inProgress', label: 'In Progress', tone: 'info' as const },
  { key: 'closed', label: 'Closed', tone: 'success' as const },
];

/**
 * Defect status as one stacked proportion bar + a legend of mono counts
 * (handoff 1c) — replaces the three identical status stat cards.
 */
function DefectBreakdown({
  open,
  inProgress,
  closed,
}: {
  open: number;
  inProgress: number;
  closed: number;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const counts: Record<string, number> = { open, inProgress, closed };
  const colorFor = (tone: 'warning' | 'info' | 'success') =>
    tone === 'warning'
      ? theme.colors.warning
      : tone === 'success'
        ? theme.colors.success
        : theme.colors.primary;
  const total = open + inProgress + closed;

  return (
    <Card>
      <SectionTitle>Defects</SectionTitle>

      <View style={styles.proportionBar}>
        {total === 0 ? (
          <View style={styles.proportionEmpty} />
        ) : (
          DEFECT_SEGMENTS.map((segment) => {
            const count = counts[segment.key];
            if (count <= 0) {
              return null;
            }
            return (
              <View
                key={segment.key}
                style={{
                  width: `${(count / total) * 100}%`,
                  backgroundColor: colorFor(segment.tone),
                }}
              />
            );
          })
        )}
      </View>

      <View style={styles.legend}>
        {DEFECT_SEGMENTS.map((segment) => (
          <View key={segment.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colorFor(segment.tone) }]} />
            <Text style={styles.legendLabel}>{segment.label}</Text>
            <Mono size={13} color={colorFor(segment.tone)}>
              {formatNumber(counts[segment.key])}
            </Mono>
          </View>
        ))}
      </View>
    </Card>
  );
}

function TeamActivityCard({ activity }: { activity: DailyTeamActivity }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const maxValue = activity.teams.reduce(
    (max, team) => Math.max(max, team.assetsInspectedToday),
    0,
  );

  return (
    <Card>
      <SectionTitle>Today's Team Activity</SectionTitle>
      <Text style={styles.activityDate}>{formatActivityDate(activity.date)}</Text>

      <View style={styles.activitySummary}>
        <Text style={styles.activityTotalValue}>
          {formatNumber(activity.totalAssetsInspectedToday)}
        </Text>
        <Text style={styles.activityTotalLabel}>
          {activity.totalAssetsInspectedToday === 1 ? 'pole inspected' : 'poles inspected'}
          {activity.activeTeamCount > 0
            ? ` · ${activity.activeTeamCount} ${
                activity.activeTeamCount === 1 ? 'team' : 'teams'
              } active`
            : ''}
        </Text>
      </View>

      {activity.teams.length === 0 ? (
        <BodyText muted>No inspections submitted today yet.</BodyText>
      ) : (
        <View style={styles.leaderboard}>
          {activity.teams.map((team, index) => (
            <LeaderboardRow
              key={team.teamId}
              rank={index + 1}
              name={team.teamName}
              value={team.assetsInspectedToday}
              maxValue={maxValue}
            />
          ))}
        </View>
      )}
    </Card>
  );
}

/**
 * A crew leaderboard row (handoff 1c): rank badge (solidFill), name + optional
 * subtitle, a progress bar sized to the leader, and a mono value.
 */
function LeaderboardRow({
  rank,
  name,
  subtitle,
  value,
  maxValue,
}: {
  rank: number;
  name: string;
  subtitle?: string | null;
  value: number;
  maxValue: number;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // Floor non-zero bars at a sliver so anyone with work always reads as > 0.
  const fraction =
    maxValue > 0 && value > 0 ? Math.max(value / maxValue, 0.06) : 0;

  return (
    <View style={styles.leaderRow}>
      <View style={styles.rankBadge}>
        <Text style={styles.rankBadgeText}>{rank}</Text>
      </View>
      <View style={styles.leaderBody}>
        <View style={styles.leaderTopRow}>
          <Text style={styles.leaderName} numberOfLines={1}>
            {name}
            {subtitle ? <Text style={styles.leaderSubtitle}>{` · ${subtitle}`}</Text> : null}
          </Text>
          <Mono size={14}>{formatNumber(value)}</Mono>
        </View>
        <View style={styles.leaderTrack}>
          <View style={[styles.leaderFill, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>
      </View>
    </View>
  );
}

function UserActivityCard({
  activity,
  token,
}: {
  activity: DailyUserActivity;
  token: string;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [monthOpen, setMonthOpen] = useState(false);
  const [month, setMonth] = useState<CrewPerformance | null>(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);

  const maxValue = activity.users.reduce(
    (max, row) => Math.max(max, row.assetsInspectedToday),
    0,
  );

  const toggleMonth = async () => {
    const next = !monthOpen;
    setMonthOpen(next);
    if (next && !month && !monthLoading) {
      setMonthLoading(true);
      setMonthError(null);
      try {
        setMonth(await api.getCrewPerformance(token));
      } catch (error) {
        setMonthError(
          error instanceof Error ? error.message : 'Unable to load this month.',
        );
      } finally {
        setMonthLoading(false);
      }
    }
  };

  return (
    <Card>
      <SectionTitle>Today's Crew Activity</SectionTitle>
      <Text style={styles.activityDate}>{formatActivityDate(activity.date)}</Text>

      <View style={styles.activitySummary}>
        <Text style={styles.activityTotalValue}>
          {formatNumber(activity.totalAssetsInspectedToday)}
        </Text>
        <Text style={styles.activityTotalLabel}>
          {activity.totalAssetsInspectedToday === 1 ? 'pole inspected' : 'poles inspected'}
          {activity.activeUserCount > 0
            ? ` · ${activity.activeUserCount} ${
                activity.activeUserCount === 1 ? 'person' : 'people'
              } active`
            : ''}
        </Text>
      </View>

      {activity.users.length === 0 ? (
        <BodyText muted>No inspections submitted today yet.</BodyText>
      ) : (
        <View style={styles.leaderboard}>
          {activity.users.map((row, index) => (
            <LeaderboardRow
              key={row.userId}
              rank={index + 1}
              name={row.name}
              subtitle={row.teamName}
              value={row.assetsInspectedToday}
              maxValue={maxValue}
            />
          ))}
        </View>
      )}

      <AppButton
        label={monthOpen ? 'Hide This Month' : 'This Month (pay view)'}
        variant="secondary"
        onPress={() => void toggleMonth()}
      />
      {monthOpen ? (
        monthLoading ? (
          <BodyText muted>Loading this month…</BodyText>
        ) : monthError ? (
          <ErrorBanner message={monthError} />
        ) : month ? (
          <View style={styles.leaderboard}>
            <Text style={styles.activityDate}>
              {month.period} · {formatNumber(month.totalAssetsInspected)} poles total
            </Text>
            {month.users.length === 0 ? (
              <BodyText muted>No inspections this month yet.</BodyText>
            ) : (
              month.users.map((row, index) => (
                <LeaderboardRow
                  key={row.userId}
                  rank={index + 1}
                  name={row.name}
                  subtitle={row.teamName}
                  value={row.assetsInspected}
                  maxValue={month.users[0]?.assetsInspected ?? 0}
                />
              ))
            )}
          </View>
        ) : null
      ) : null}
    </Card>
  );
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatActivityDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map((part) => Number.parseInt(part, 10));

  if (!year || !month || !day || month < 1 || month > 12) {
    return isoDate;
  }

  return `${day} ${MONTH_LABELS[month - 1]} ${year}`;
}

function getStatusTone(status: DefectStatus) {
  if (status === 'CLOSED') {
    return 'success';
  }

  if (status === 'OPEN') {
    return 'warning';
  }

  if (status === 'IN_PROGRESS') {
    return 'info';
  }

  return 'neutral';
}

/** Spine encodes severity, except a done defect always reads green (handoff C2). */
function spineForDefect(defect: DashboardRecentDefect): SpineTone {
  if (defect.status === 'CLOSED') {
    return 'green';
  }
  if (defect.severity === 'CRITICAL' || defect.severity === 'HIGH') {
    return 'red';
  }
  if (defect.severity === 'MEDIUM') {
    return 'amber';
  }
  if (defect.status === 'IN_PROGRESS') {
    return 'blue';
  }
  return 'neutral';
}

function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    // Hero metric — dark card, big display number (handoff 1c).
    hero: {
      backgroundColor: t.colors.solidFill,
      borderRadius: t.radius.card,
      padding: 20,
      gap: 6,
      borderWidth: 1,
      borderColor: t.colors.solidFill,
      ...t.shadow.raised,
    },
    heroEyebrow: {
      fontSize: 11,
      lineHeight: 15,
      fontFamily: t.fonts.mono,
      letterSpacing: 1.4,
      color: t.colors.onSolidFill,
      opacity: 0.6,
    },
    heroValueRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
    },
    heroValue: {
      fontSize: 56,
      lineHeight: 60,
      fontFamily: t.fonts.display,
      fontWeight: '700',
      letterSpacing: -1.5,
      color: t.colors.onSolidFill,
    },
    heroCaption: {
      fontSize: 13,
      lineHeight: 18,
      fontFamily: t.fonts.body,
      color: t.colors.onSolidFill,
      opacity: 0.66,
    },
    heroProgressWrap: {
      marginTop: 8,
      gap: 6,
    },
    heroTrack: {
      height: 8,
      borderRadius: t.radius.pill,
      backgroundColor: 'rgba(255,255,255,0.14)',
      overflow: 'hidden',
    },
    heroFill: {
      height: '100%',
      borderRadius: t.radius.pill,
    },
    heroProgressLabel: {
      fontSize: 12,
      fontFamily: t.fonts.body,
      color: t.colors.onSolidFill,
      opacity: 0.72,
    },
    heroProgressPct: {
      fontFamily: t.fonts.monoMedium,
      color: t.colors.onSolidFill,
    },

    // Compact mini-stat cards.
    miniRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    miniCard: {
      flexGrow: 1,
      flexBasis: 100,
      minHeight: 78,
      backgroundColor: t.colors.card,
      borderRadius: t.radius.card,
      padding: 14,
      gap: 4,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.shadow.card,
    },
    miniValue: {
      fontSize: 24,
      lineHeight: 30,
      fontFamily: t.fonts.display,
      fontWeight: '700',
      color: t.colors.textPrimary,
    },
    miniLabel: {
      fontSize: 12,
      lineHeight: 16,
      fontFamily: t.fonts.bodySemibold,
      fontWeight: '600',
      color: t.colors.textSecondary,
    },

    // Defect proportion bar + legend.
    proportionBar: {
      flexDirection: 'row',
      height: 14,
      borderRadius: t.radius.pill,
      overflow: 'hidden',
      backgroundColor: t.colors.surfaceMuted,
    },
    proportionEmpty: {
      flex: 1,
      backgroundColor: t.colors.surfaceMuted,
    },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 16,
      marginTop: 2,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    legendDot: {
      width: 9,
      height: 9,
      borderRadius: 5,
    },
    legendLabel: {
      fontSize: 13,
      fontFamily: t.fonts.bodyMedium,
      fontWeight: '500',
      color: t.colors.textSecondary,
    },

    // Team / crew activity + leaderboard.
    activityDate: {
      fontSize: 13,
      lineHeight: 18,
      fontFamily: t.fonts.bodySemibold,
      fontWeight: '600',
      color: t.colors.textSecondary,
      marginTop: -4,
    },
    activitySummary: {
      flexDirection: 'row',
      alignItems: 'baseline',
      flexWrap: 'wrap',
      gap: 8,
    },
    activityTotalValue: {
      fontSize: 32,
      lineHeight: 36,
      fontFamily: t.fonts.display,
      fontWeight: '700',
      letterSpacing: -0.6,
      color: t.colors.primary,
    },
    activityTotalLabel: {
      flexShrink: 1,
      fontSize: 13,
      lineHeight: 18,
      fontFamily: t.fonts.bodyMedium,
      fontWeight: '500',
      color: t.colors.textSecondary,
    },
    leaderboard: {
      gap: 12,
      marginTop: 2,
    },
    leaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    rankBadge: {
      width: 26,
      height: 26,
      borderRadius: 8,
      backgroundColor: t.colors.solidFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rankBadgeText: {
      fontSize: 13,
      fontFamily: t.fonts.monoMedium,
      color: t.colors.onSolidFill,
    },
    leaderBody: {
      flex: 1,
      gap: 6,
    },
    leaderTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    leaderName: {
      flex: 1,
      fontSize: 14,
      lineHeight: 19,
      fontFamily: t.fonts.bodySemibold,
      fontWeight: '600',
      color: t.colors.textPrimary,
    },
    leaderSubtitle: {
      fontFamily: t.fonts.body,
      fontWeight: '400',
      color: t.colors.textMuted,
    },
    leaderTrack: {
      height: 8,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.primarySoft,
      overflow: 'hidden',
    },
    leaderFill: {
      height: '100%',
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.primary,
    },
  });

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { useSession } from '../context/AuthContext';
import type { AppDrawerScreenProps } from '../navigation/types';
import {
  DailyTeamActivity,
  DailyTeamActivityTeam,
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
  Screen,
  SectionTitle,
  SkeletonCard,
  StatusChip,
} from '../ui';
import { Theme, useTheme } from '../theme';

export function DashboardScreen() {
  const navigation = useNavigation<AppDrawerScreenProps<'Dashboard'>['navigation']>();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { token, user, handleUnauthorized } = useSession();
  // Maintenance-only accounts shouldn't see inspection-centric stats.
  const { canInspect } = useCapabilities();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [teamActivity, setTeamActivity] = useState<DailyTeamActivity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Daily per-team activity is a Manager/Supervisor monitoring view; technicians
  // don't see the card (and the API would only ever return their own team).
  const canSeeTeamActivity =
    user.role === 'ADMIN' || user.role === 'MANAGER' || user.role === 'SUPERVISOR';

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

      const [response, activity] = await Promise.all([
        api.getDashboard(token),
        activityRequest,
      ]);

      setDashboard(response);
      setTeamActivity(activity);
    } catch (loadError) {
      console.error('[DASHBOARD LOAD ERROR]', loadError);

      if (loadError instanceof ApiError && loadError.status === 401) {
        await handleUnauthorized(loadError);
        return;
      }

      setDashboard(null);
      setTeamActivity(null);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load dashboard.');
    } finally {
      setIsLoading(false);
    }
  }, [canSeeTeamActivity, handleUnauthorized, token]);

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
      {isLoading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : null}

      {!isLoading && dashboard ? (
        <>
          <View style={styles.statGrid}>
            {canInspect ? (
              <>
                <StatCard label="Total Assets" value={dashboard.totalAssets} />
                <StatCard label="Total Inspections" value={dashboard.totalInspections} />
              </>
            ) : null}
            <StatCard label="Total Defects" value={dashboard.totalDefects} />
          </View>

          <View style={styles.statGrid}>
            <StatusStatCard label="Open" value={dashboard.openDefects} status="OPEN" />
            <StatusStatCard
              label="In Progress"
              value={dashboard.inProgressDefects}
              status="IN_PROGRESS"
            />
            <StatusStatCard label="Closed" value={dashboard.closedDefects} status="CLOSED" />
          </View>

          {canSeeTeamActivity && canInspect && teamActivity ? (
            <TeamActivityCard activity={teamActivity} />
          ) : null}

          <Card>
            <SectionTitle>Recent Defects</SectionTitle>
            {dashboard.recentDefects.length === 0 ? (
              <BodyText muted>No recent defects found.</BodyText>
            ) : (
              dashboard.recentDefects.map((defect) => (
                <RecentDefectRow
                  key={defect.id}
                  defect={defect}
                  onPress={() => navigation.navigate('DefectDetail', { defectId: defect.id })}
                />
              ))
            )}
          </Card>
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

function StatCard({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{formatNumber(value)}</Text>
    </View>
  );
}

function StatusStatCard({
  label,
  value,
  status,
}: {
  label: string;
  value: number;
  status: DefectStatus;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.statusStatCard}>
      <StatusChip label={label} tone={getStatusTone(status)} />
      <Text style={styles.statusStatValue}>{formatNumber(value)}</Text>
    </View>
  );
}

function RecentDefectRow({
  defect,
  onPress,
}: {
  defect: DashboardRecentDefect;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.recentDefectRow, pressed && styles.recentDefectRowPressed]}
    >
      <View style={styles.recentDefectHeader}>
        <View style={styles.recentDefectTextWrap}>
          <Text style={styles.recentDefectAsset}>{defect.assetCode || 'Unknown Asset'}</Text>
          <Text style={styles.recentDefectLabel}>{defect.label}</Text>
        </View>
        <StatusChip label={formatStatus(defect.status)} tone={getStatusTone(defect.status)} />
      </View>
      <Text style={styles.recentDefectDate}>{formatDateTime(defect.createdAt)}</Text>
    </Pressable>
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
      <Text style={styles.teamActivityDate}>{formatActivityDate(activity.date)}</Text>

      <View style={styles.teamActivitySummary}>
        <Text style={styles.teamActivityTotalValue}>
          {formatNumber(activity.totalAssetsInspectedToday)}
        </Text>
        <Text style={styles.teamActivityTotalLabel}>
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
        <View style={styles.teamActivityList}>
          {activity.teams.map((team) => (
            <TeamActivityRow key={team.teamId} team={team} maxValue={maxValue} />
          ))}
        </View>
      )}
    </Card>
  );
}

function TeamActivityRow({
  team,
  maxValue,
}: {
  team: DailyTeamActivityTeam;
  maxValue: number;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // Floor non-zero bars at a sliver so a team with work always reads as > 0.
  const fraction =
    maxValue > 0 && team.assetsInspectedToday > 0
      ? Math.max(team.assetsInspectedToday / maxValue, 0.06)
      : 0;

  return (
    <View style={styles.teamActivityRow}>
      <View style={styles.teamActivityRowTop}>
        <Text style={styles.teamActivityTeamName} numberOfLines={1}>
          {team.teamName}
        </Text>
        <Text style={styles.teamActivityCount}>
          {formatNumber(team.assetsInspectedToday)}
        </Text>
      </View>
      <View style={styles.teamActivityTrack}>
        <View
          style={[styles.teamActivityFill, { width: `${Math.round(fraction * 100)}%` }]}
        />
      </View>
    </View>
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
    statGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    statCard: {
      flexGrow: 1,
      flexBasis: 140,
      minHeight: 94,
      backgroundColor: t.colors.card,
      borderRadius: t.radius.card,
      padding: 14,
      gap: 8,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    statLabel: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      color: t.colors.textSecondary,
    },
    statValue: {
      fontSize: 28,
      lineHeight: 34,
      fontWeight: '700',
      color: t.colors.textPrimary,
    },
    statusStatCard: {
      flexGrow: 1,
      flexBasis: 110,
      minHeight: 92,
      backgroundColor: t.colors.card,
      borderRadius: t.radius.card,
      padding: 14,
      gap: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    statusStatValue: {
      fontSize: 26,
      lineHeight: 32,
      fontWeight: '700',
      color: t.colors.textPrimary,
    },
    teamActivityDate: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      color: t.colors.textSecondary,
      marginTop: -4,
    },
    teamActivitySummary: {
      flexDirection: 'row',
      alignItems: 'baseline',
      flexWrap: 'wrap',
      gap: 8,
    },
    teamActivityTotalValue: {
      fontSize: 30,
      lineHeight: 34,
      fontWeight: '700',
      color: t.colors.primary,
    },
    teamActivityTotalLabel: {
      flexShrink: 1,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
      color: t.colors.textSecondary,
    },
    teamActivityList: {
      gap: 12,
      marginTop: 2,
    },
    teamActivityRow: {
      gap: 6,
    },
    teamActivityRowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    teamActivityTeamName: {
      flex: 1,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '600',
      color: t.colors.textPrimary,
    },
    teamActivityCount: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '700',
      color: t.colors.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    teamActivityTrack: {
      height: 8,
      borderRadius: 999,
      backgroundColor: t.colors.primarySoft,
      overflow: 'hidden',
    },
    teamActivityFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: t.colors.primary,
    },
    recentDefectRow: {
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      padding: 14,
      gap: 10,
    },
    recentDefectRowPressed: {
      backgroundColor: t.colors.surfacePressed,
    },
    recentDefectHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    recentDefectTextWrap: {
      flex: 1,
      gap: 4,
    },
    recentDefectAsset: {
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '700',
      color: t.colors.textPrimary,
    },
    recentDefectLabel: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '500',
      color: t.colors.textPrimary,
    },
    recentDefectDate: {
      fontSize: 13,
      lineHeight: 18,
      color: t.colors.textSecondary,
    },
  });

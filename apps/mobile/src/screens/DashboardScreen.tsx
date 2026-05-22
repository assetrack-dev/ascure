import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { useSession } from '../context/AuthContext';
import type { AppDrawerScreenProps } from '../navigation/types';
import { DashboardData, DashboardRecentDefect, DefectStatus } from '../types';
import { formatDateTime } from '../utils';
import {
  AppButton,
  BodyText,
  Card,
  ErrorBanner,
  Screen,
  SectionTitle,
  SkeletonCard,
  StatusChip,
  uiTheme,
} from '../ui';

export function DashboardScreen() {
  const navigation = useNavigation<AppDrawerScreenProps<'Dashboard'>['navigation']>();
  const { token, handleUnauthorized } = useSession();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const response = await api.getDashboard(token);
      setDashboard(response);
    } catch (loadError) {
      console.error('[DASHBOARD LOAD ERROR]', loadError);

      if (loadError instanceof ApiError && loadError.status === 401) {
        await handleUnauthorized(loadError);
        return;
      }

      setDashboard(null);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load dashboard.');
    } finally {
      setIsLoading(false);
    }
  }, [handleUnauthorized, token]);

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
            <StatCard label="Total Assets" value={dashboard.totalAssets} />
            <StatCard label="Total Inspections" value={dashboard.totalInspections} />
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

const styles = StyleSheet.create({
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: 140,
    minHeight: 94,
    backgroundColor: uiTheme.colors.card,
    borderRadius: uiTheme.radius.card,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  statLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: uiTheme.colors.textSecondary,
  },
  statValue: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: uiTheme.colors.textPrimary,
  },
  statusStatCard: {
    flexGrow: 1,
    flexBasis: 110,
    minHeight: 92,
    backgroundColor: uiTheme.colors.card,
    borderRadius: uiTheme.radius.card,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  statusStatValue: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    color: uiTheme.colors.textPrimary,
  },
  recentDefectRow: {
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    padding: 14,
    gap: 10,
  },
  recentDefectRowPressed: {
    backgroundColor: uiTheme.colors.surfacePressed,
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
    color: uiTheme.colors.textPrimary,
  },
  recentDefectLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: uiTheme.colors.textPrimary,
  },
  recentDefectDate: {
    fontSize: 13,
    lineHeight: 18,
    color: uiTheme.colors.textSecondary,
  },
});

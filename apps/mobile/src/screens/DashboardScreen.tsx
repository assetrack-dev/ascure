import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, ApiError } from '../api';
import { DashboardData, DashboardRecentDefect, DefectStatus } from '../types';
import { formatDateTime } from '../utils';
import {
  AppButton,
  BodyText,
  Card,
  ErrorBanner,
  InlineButton,
  LoadingBlock,
  Screen,
  SectionTitle,
  StatusChip,
} from '../ui';

export function DashboardScreen({
  token,
  onBack,
  onOpenDefect,
  onUnauthorized,
}: {
  token: string;
  onBack: () => void;
  onOpenDefect: (defectId: string) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
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
        await onUnauthorized(loadError);
        return;
      }

      setDashboard(null);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load dashboard.');
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized, token]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return (
    <Screen
      title="Dashboard"
      actions={
        <>
          <InlineButton label="Refresh" onPress={loadDashboard} disabled={isLoading} />
          <InlineButton label="Back" onPress={onBack} />
        </>
      }
    >
      <ErrorBanner message={error} />
      {isLoading ? <LoadingBlock label="Loading dashboard..." /> : null}

      {!isLoading && dashboard ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <StatCard label="Total Assets" value={dashboard.totalAssets} />
            <StatCard label="Total Inspections" value={dashboard.totalInspections} />
            <StatCard label="Total Defects" value={dashboard.totalDefects} />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <StatusStatCard label="OPEN" value={dashboard.openDefects} status="OPEN" />
            <StatusStatCard
              label="IN_PROGRESS"
              value={dashboard.inProgressDefects}
              status="IN_PROGRESS"
            />
            <StatusStatCard label="CLOSED" value={dashboard.closedDefects} status="CLOSED" />
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
                  onPress={() => onOpenDefect(defect.id)}
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
    <View
      style={{
        flexGrow: 1,
        flexBasis: 140,
        backgroundColor: '#ffffff',
        borderRadius: 18,
        padding: 16,
        gap: 8,
        borderWidth: 1,
        borderColor: '#dce5f1',
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: '#607086' }}>{label}</Text>
      <Text style={{ fontSize: 30, fontWeight: '800', color: '#0f172a' }}>
        {formatNumber(value)}
      </Text>
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
    <View
      style={{
        flexGrow: 1,
        flexBasis: 110,
        backgroundColor: '#ffffff',
        borderRadius: 18,
        padding: 16,
        gap: 10,
        borderWidth: 1,
        borderColor: '#dce5f1',
      }}
    >
      <StatusChip label={label} tone={getStatusTone(status)} />
      <Text style={{ fontSize: 28, fontWeight: '800', color: '#0f172a' }}>
        {formatNumber(value)}
      </Text>
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
      style={({ pressed }) => ({
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#dce5f1',
        backgroundColor: pressed ? '#f8fbff' : '#ffffff',
        padding: 14,
        gap: 10,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a' }}>
            {defect.assetCode || 'Unknown Asset'}
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: '600', color: '#10233d' }}>
            {defect.label}
          </Text>
        </View>
        <StatusChip label={formatStatus(defect.status)} tone={getStatusTone(defect.status)} />
      </View>
      <Text style={{ fontSize: 13, color: '#607086' }}>{formatDateTime(defect.createdAt)}</Text>
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

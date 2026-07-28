import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { useSession } from '../context/AuthContext';
import type { AppDrawerScreenProps } from '../navigation/types';
import { DefectListItem } from '../types';
import { formatDateTime } from '../utils';
import {
  AppButton,
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Screen,
  StatusSpineTile,
  TextField,
  type SpineTone,
} from '../ui';
import { Theme, useTheme } from '../theme';

// Hard cap on ROWS RENDERED. The list lives in a plain ScrollView (no
// virtualization) — mounting a tenant-scoped account's full defect list as
// native views OOM-crashes the phone (same failure as the Maintenance
// workspace, confirmed by logcat). Search filters within the fetched set.
const LIST_RENDER_LIMIT = 100;

export function DefectListScreen() {
  const navigation = useNavigation<AppDrawerScreenProps<'DefectList'>['navigation']>();
  const { token, handleUnauthorized } = useSession();
  const [defects, setDefects] = useState<DefectListItem[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const loadDefects = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await api.getDefects(token);
      setDefects(response);
    } catch (loadError) {
      console.error('[DEFECT LIST LOAD ERROR]', loadError);

      if (loadError instanceof ApiError && loadError.status === 401) {
        await handleUnauthorized(loadError);
        return;
      }

      setDefects([]);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load defects.');
    } finally {
      setIsLoading(false);
    }
  }, [handleUnauthorized, token]);

  useEffect(() => {
    loadDefects();
  }, [loadDefects]);

  const visibleDefects = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return defects;
    }

    return defects.filter((defect) => {
      const assetCode = defect.assetCode?.toLowerCase() ?? '';
      const label = defect.label.toLowerCase();

      return assetCode.includes(query) || label.includes(query);
    });
  }, [defects, search]);

  return (
    <Screen
      title="Defects"
      leftAction={{
        icon: 'menu',
        onPress: () => navigation.openDrawer(),
        accessibilityLabel: 'Menu',
      }}
      rightAction={{
        icon: 'refresh',
        onPress: loadDefects,
        accessibilityLabel: 'Refresh',
        disabled: isLoading,
      }}
    >
      <ErrorBanner message={error} />
      {isLoading ? <LoadingBlock label="Loading defects..." /> : null}

      {!isLoading ? (
        <>
          {/* Compact stat tiles (handoff 2d) — colored counts by status. */}
          <View style={styles.statRow}>
            <StatTile label="Open" value={countByStatus(defects, 'OPEN')} tone="warning" />
            <StatTile
              label="In Progress"
              value={countByStatus(defects, 'IN_PROGRESS')}
              tone="info"
            />
            <StatTile label="Closed" value={countByStatus(defects, 'CLOSED')} tone="success" />
          </View>

          <TextField
            label="Search"
            value={search}
            onChangeText={setSearch}
            placeholder="Asset code or defect label"
          />

          {!error && defects.length === 0 ? (
            <EmptyState
              icon="check-circle"
              title="No defects"
              description="No defects have been raised in your scope yet."
            />
          ) : null}

          {!error && defects.length > 0 && visibleDefects.length === 0 ? (
            <EmptyState
              icon="search"
              title="No matches"
              description="No defects match your search."
            />
          ) : null}

          {!error
            ? visibleDefects.slice(0, LIST_RENDER_LIMIT).map((defect) => (
                <StatusSpineTile
                  key={defect.id}
                  code={defect.assetCode || 'Unknown asset'}
                  spine={spineForDefect(defect)}
                  chip={{
                    label: formatStatus(defect.status),
                    tone: getStatusTone(defect.status),
                  }}
                  secondary={defect.label}
                  meta={[
                    defect.location,
                    defect.cycleNumber ? `Cycle ${defect.cycleNumber}` : null,
                    formatDateTime(defect.submittedAt),
                  ]}
                  onPress={() => navigation.navigate('DefectDetail', { defectId: defect.id })}
                />
              ))
            : null}
          {!error && visibleDefects.length > LIST_RENDER_LIMIT ? (
            <Text style={styles.overflowNote}>
              Showing the first {LIST_RENDER_LIMIT} of {visibleDefects.length} —
              type in Search to narrow the list, or browse everything in the
              admin console.
            </Text>
          ) : null}

          {error ? (
            <Card>
              <AppButton label="Try Again" variant="secondary" onPress={loadDefects} />
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'warning' | 'info' | 'success';
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const color =
    tone === 'warning'
      ? theme.colors.warning
      : tone === 'success'
        ? theme.colors.success
        : theme.colors.primary;

  return (
    <View style={styles.statTile}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function countByStatus(defects: DefectListItem[], status: DefectListItem['status']) {
  return defects.filter((defect) => defect.status === status).length;
}

/** Spine encodes severity, except a done defect always reads green (handoff C2). */
function spineForDefect(defect: DefectListItem): SpineTone {
  if (defect.status === 'CLOSED' || defect.status === 'RESOLVED') {
    return 'green';
  }
  if (defect.severity === 'CRITICAL' || defect.severity === 'HIGH') {
    return 'red';
  }
  if (defect.severity === 'MEDIUM') {
    return 'amber';
  }
  if (defect.status === 'IN_PROGRESS' || defect.status === 'MONITORING') {
    return 'blue';
  }
  return 'neutral';
}

function getStatusTone(
  status: DefectListItem['status'],
): 'neutral' | 'success' | 'warning' {
  if (status === 'CLOSED' || status === 'RESOLVED') {
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

const createStyles = (t: Theme) =>
  StyleSheet.create({
    statRow: {
      flexDirection: 'row',
      gap: 10,
    },
    overflowNote: {
      fontSize: 12,
      color: t.colors.textMuted,
      paddingHorizontal: 4,
      paddingTop: 4,
    },
    statTile: {
      flex: 1,
      backgroundColor: t.colors.card,
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      paddingVertical: 14,
      paddingHorizontal: 12,
      gap: 2,
      ...t.shadow.card,
    },
    statValue: {
      fontSize: 26,
      fontFamily: t.fonts.display,
      fontWeight: '700',
    },
    statLabel: {
      fontSize: 12,
      fontFamily: t.fonts.bodySemibold,
      fontWeight: '600',
      color: t.colors.textSecondary,
    },
  });

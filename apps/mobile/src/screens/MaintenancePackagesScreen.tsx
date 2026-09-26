import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { useSession } from '../context/AuthContext';
import { cachedFetch } from '../offlineCache';
import type { RootStackScreenProps } from '../navigation/types';
import {
  AppButton,
  Card,
  EmptyState,
  ErrorBanner,
  SkeletonCard,
  StatusSpineTile,
  WarningBanner,
  Screen,
  type SpineTone,
} from '../ui';
import { Theme, useTheme } from '../theme';
import { CATEGORY_LABEL, type WorkPackageList, type WorkPackageSummary } from '../maintenance/types';
import { WORK_CACHE_NAMESPACE } from '../maintenance/useWorkPack';

/**
 * Maintenance mode — the crew's Pencawang packages (docs/PLAN-maintenance-flow.md
 * §7.1). Works from the cached list when there is no signal.
 */
export function MaintenancePackagesScreen() {
  const navigation = useNavigation<RootStackScreenProps<'MaintenancePackages'>['navigation']>();
  const { token, handleUnauthorized } = useSession();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [data, setData] = useState<WorkPackageList | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const load = useCallback(
    async (showLoading: boolean) => {
      try {
        if (showLoading) setIsLoading(true);
        setError(null);
        const result = await cachedFetch(WORK_CACHE_NAMESPACE, 'list', () => api.getMaintenanceWork(token));
        setData(result.value);
        setFromCache(result.fromCache);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          await handleUnauthorized(loadError);
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Unable to load your packages.');
      } finally {
        setIsLoading(false);
      }
    },
    [handleUnauthorized, token],
  );

  useFocusEffect(
    useCallback(() => {
      void load(!loadedRef.current);
      loadedRef.current = true;
    }, [load]),
  );

  const packages = data?.packages ?? [];

  return (
    <Screen
      title="My Pencawang packages"
      leftAction={{ icon: 'back', onPress: () => navigation.goBack(), accessibilityLabel: 'Back' }}
      rightAction={{ icon: 'refresh', onPress: () => void load(true), accessibilityLabel: 'Refresh', disabled: isLoading }}
    >
      <ErrorBanner message={error} />
      {fromCache ? <WarningBanner message="Offline — showing the last saved list." /> : null}

      {isLoading && !data ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : null}

      {data && packages.length === 0 ? (
        <Card>
          <EmptyState
            icon="package"
            title="No packages yet"
            description={
              data.role === 'MANAGER'
                ? 'Pencawang TNB assigns to your company will appear here.'
                : 'Pencawang work your manager assigns to your team will appear here.'
            }
          />
        </Card>
      ) : null}

      {packages.map((pkg) => (
        <PackageTile
          key={pkg.siteVisitId}
          pkg={pkg}
          onPress={() =>
            navigation.navigate('MaintenancePackage', {
              siteVisitId: pkg.siteVisitId,
              title: pkg.pencawangName ?? pkg.pencawangCode ?? 'Pencawang',
            })
          }
        />
      ))}

      {error && !data ? (
        <Card>
          <AppButton label="Try again" variant="secondary" onPress={() => void load(true)} />
        </Card>
      ) : null}
      <View style={styles.bottomSpace} />
    </Screen>
  );
}

function PackageTile({ pkg, onPress }: { pkg: WorkPackageSummary; onPress: () => void }) {
  const open = pkg.counts.TODO + pkg.counts.IN_PROGRESS;
  const total = open + pkg.counts.SUBMITTED + pkg.counts.CLOSED;
  const overdue = pkg.dueDate ? new Date(pkg.dueDate).getTime() < Date.now() && open > 0 : false;
  const spine: SpineTone = pkg.emergencyCount > 0 || overdue ? 'red' : open > 0 ? 'amber' : pkg.counts.SUBMITTED > 0 ? 'blue' : 'green';

  return (
    <StatusSpineTile
      code={pkg.pencawangName ?? pkg.pencawangCode ?? 'Pencawang'}
      spine={spine}
      chip={
        pkg.emergencyCount > 0
          ? { label: `${pkg.emergencyCount} emergency`, tone: 'danger' }
          : open > 0
            ? { label: `${open} to repair`, tone: 'warning' }
            : { label: 'All submitted', tone: 'success' }
      }
      secondary={`${pkg.poleCount} pole${pkg.poleCount === 1 ? '' : 's'} · ${total} Kejanggalan · ${pkg.categories.map((category) => CATEGORY_LABEL[category]).join(', ')}`}
      meta={[
        pkg.mainhead?.name,
        pkg.dueDate ? `${overdue ? 'OVERDUE · ' : ''}Target ${formatDate(pkg.dueDate)}` : null,
        pkg.counts.SUBMITTED > 0 ? `${pkg.counts.SUBMITTED} awaiting check` : null,
      ]}
      onPress={onPress}
    />
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

function createStyles(_theme: Theme) {
  return StyleSheet.create({
    bottomSpace: { height: 24 },
  });
}


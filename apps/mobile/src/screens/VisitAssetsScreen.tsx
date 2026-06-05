import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { api, ApiError, isEndpointUnavailableError } from '../api';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Screen,
  StatusChip,
  TextField,
  uiTheme,
} from '../ui';
import {
  getAssetRowLabels,
  getDefectAssetIds,
  getNoTiangLama,
  getNoTiangRondaan,
  getSubmittedInspectionAssetIds,
} from '../assetDisplay';
import { Asset, SiteVisit } from '../types';
import { useSession } from '../context/AuthContext';
import type { RootStackScreenProps } from '../navigation/types';

type AssetFilter = 'ALL' | 'PENDING' | 'INSPECTED' | 'DEFECT' | 'NOT_FOUND';

const FILTERS: Array<{ key: AssetFilter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'INSPECTED', label: 'Inspected' },
  { key: 'DEFECT', label: 'Defect' },
  { key: 'NOT_FOUND', label: 'Not Found' },
];

export function VisitAssetsScreen() {
  const navigation = useNavigation<RootStackScreenProps<'VisitAssets'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'VisitAssets'>['route']>();
  const { visitId, substationId } = route.params;
  const { token, handleUnauthorized } = useSession();

  const [visit, setVisit] = useState<SiteVisit | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AssetFilter>('ALL');
  const hasLoadedRef = useRef(false);

  const loadData = useCallback(
    async (options?: { silent?: boolean }) => {
      try {
        setError(null);
        if (!options?.silent) {
          setIsLoading(true);
        }

        const visitResponse = await api.getSiteVisit(token, visitId);
        let visitAssets: Asset[];
        try {
          visitAssets = await api.getSiteVisitAssets(token, visitId);
        } catch (assetError) {
          if (isEndpointUnavailableError(assetError)) {
            visitAssets = await api.getAssets(token, substationId);
          } else {
            throw assetError;
          }
        }

        setVisit(visitResponse);
        setAssets(visitAssets);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          await handleUnauthorized(loadError);
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Unable to load assets.');
      } finally {
        setIsLoading(false);
      }
    },
    [handleUnauthorized, substationId, token, visitId],
  );

  // Refetch on focus so the list reflects inspections submitted (or synced)
  // since this screen was last visited.
  useFocusEffect(
    useCallback(() => {
      loadData({ silent: hasLoadedRef.current });
      hasLoadedRef.current = true;
    }, [loadData]),
  );

  const submittedAssetIds = useMemo(
    () => (visit ? getSubmittedInspectionAssetIds(visit) : new Set<string>()),
    [visit],
  );
  const defectAssetIds = useMemo(
    () => (visit ? getDefectAssetIds(visit) : new Set<string>()),
    [visit],
  );

  const counts = useMemo(() => {
    const tally: Record<AssetFilter, number> = {
      ALL: assets.length,
      PENDING: 0,
      INSPECTED: 0,
      DEFECT: 0,
      NOT_FOUND: 0,
    };

    for (const asset of assets) {
      if (matchesFilter(asset, 'PENDING', submittedAssetIds, defectAssetIds)) tally.PENDING += 1;
      if (matchesFilter(asset, 'INSPECTED', submittedAssetIds, defectAssetIds)) tally.INSPECTED += 1;
      if (matchesFilter(asset, 'DEFECT', submittedAssetIds, defectAssetIds)) tally.DEFECT += 1;
      if (matchesFilter(asset, 'NOT_FOUND', submittedAssetIds, defectAssetIds)) tally.NOT_FOUND += 1;
    }

    return tally;
  }, [assets, submittedAssetIds, defectAssetIds]);

  const visibleAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          matchesFilter(asset, filter, submittedAssetIds, defectAssetIds) &&
          matchesSearch(asset, search),
      ),
    [assets, filter, search, submittedAssetIds, defectAssetIds],
  );

  function openAsset(asset: Asset) {
    navigation.navigate('AssetDetail', {
      visitId,
      substationId,
      assetId: asset.id,
      assetSnapshot: asset,
    });
  }

  return (
    <Screen
      title="All Assets"
      subtitle={visit?.substation?.name ?? undefined}
      leftAction={{
        icon: 'back',
        onPress: () => navigation.goBack(),
        accessibilityLabel: 'Back',
      }}
      rightAction={{
        icon: 'refresh',
        onPress: () => loadData(),
        accessibilityLabel: 'Refresh',
        disabled: isLoading,
      }}
    >
      <ErrorBanner message={error} />

      <Card>
        <TextField
          label="Search"
          value={search}
          onChangeText={setSearch}
          placeholder="NO TIANG RONDAAN or NO TIANG LAMA"
          autoCapitalize="characters"
        />
        <View style={styles.filterRow}>
          {FILTERS.map((entry) => {
            const active = filter === entry.key;

            return (
              <Pressable
                key={entry.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setFilter(entry.key)}
                style={({ pressed }) => [
                  styles.filterChip,
                  active && styles.filterChipActive,
                  pressed && styles.filterChipPressed,
                ]}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {entry.label} ({counts[entry.key]})
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {isLoading && assets.length === 0 ? (
        <LoadingBlock label="Loading assets…" />
      ) : (
        <Card>
          {visibleAssets.length === 0 ? (
            <EmptyState
              title="No matching assets"
              description="Adjust the search text or filter to see more assets."
            />
          ) : (
            <View style={styles.assetList}>
              {visibleAssets.map((asset) => (
                <AssetRow
                  key={asset.id}
                  asset={asset}
                  inspected={submittedAssetIds.has(asset.id)}
                  hasDefect={defectAssetIds.has(asset.id)}
                  onPress={() => openAsset(asset)}
                />
              ))}
            </View>
          )}
        </Card>
      )}
    </Screen>
  );
}

function AssetRow({
  asset,
  inspected,
  hasDefect,
  onPress,
}: {
  asset: Asset;
  inspected: boolean;
  hasDefect: boolean;
  onPress: () => void;
}) {
  const { title, subtitle } = getAssetRowLabels(asset);
  const state = getAssetStateChip(asset, inspected, hasDefect);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.assetRow,
        asset.status === 'NOT_FOUND' && styles.assetRowMuted,
        pressed && styles.assetRowPressed,
      ]}
    >
      <View style={styles.assetTextWrap}>
        <Text style={styles.assetTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.assetSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <StatusChip label={state.label} tone={state.tone} />
    </Pressable>
  );
}

function getAssetStateChip(
  asset: Asset,
  inspected: boolean,
  hasDefect: boolean,
): { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' } {
  if (asset.status === 'NOT_FOUND') {
    return { label: 'Not Found', tone: 'neutral' };
  }
  if (hasDefect) {
    return { label: 'Defect', tone: 'danger' };
  }
  if (inspected) {
    return { label: 'Inspected', tone: 'success' };
  }

  return { label: 'Pending', tone: 'warning' };
}

function matchesFilter(
  asset: Asset,
  filter: AssetFilter,
  submittedAssetIds: Set<string>,
  defectAssetIds: Set<string>,
): boolean {
  switch (filter) {
    case 'ALL':
      return true;
    case 'PENDING':
      return asset.status !== 'NOT_FOUND' && !submittedAssetIds.has(asset.id);
    case 'INSPECTED':
      return submittedAssetIds.has(asset.id);
    case 'DEFECT':
      return defectAssetIds.has(asset.id);
    case 'NOT_FOUND':
      return asset.status === 'NOT_FOUND';
    default:
      return true;
  }
}

function matchesSearch(asset: Asset, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    getNoTiangRondaan(asset),
    getNoTiangLama(asset),
    asset.assetCode,
    asset.name,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

const styles = StyleSheet.create({
  filterRow: {
    marginTop: uiTheme.spacing.section,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: uiTheme.radius.pill,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.surfaceMuted,
  },
  filterChipActive: {
    borderColor: uiTheme.colors.primary,
    backgroundColor: uiTheme.colors.primarySoft,
  },
  filterChipPressed: {
    backgroundColor: uiTheme.colors.surfacePressed,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: uiTheme.colors.textSecondary,
  },
  filterChipTextActive: {
    color: uiTheme.colors.primaryStrong,
  },
  assetList: {
    gap: 8,
  },
  assetRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: uiTheme.radius.control,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
  },
  assetRowMuted: {
    opacity: 0.6,
  },
  assetRowPressed: {
    backgroundColor: uiTheme.colors.surfacePressed,
  },
  assetTextWrap: {
    flex: 1,
    gap: 2,
  },
  assetTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: uiTheme.colors.textPrimary,
  },
  assetSubtitle: {
    fontSize: 13,
    color: uiTheme.colors.textSecondary,
  },
});

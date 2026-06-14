import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
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
} from '../ui';
import { Theme, useTheme } from '../theme';
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [visit, setVisit] = useState<SiteVisit | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AssetFilter>('ALL');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
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

  function toggleSelect(assetId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      return;
    }

    try {
      setIsDeleting(true);
      setError(null);
      await api.deleteAssetsBulk(token, ids);
      exitSelectMode();
      await loadData({ silent: true });
    } catch (deleteError) {
      if (deleteError instanceof ApiError && deleteError.status === 401) {
        await handleUnauthorized(deleteError);
        return;
      }

      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete assets.');
    } finally {
      setIsDeleting(false);
    }
  }

  function confirmBulkDelete() {
    const count = selectedIds.size;
    if (count === 0) {
      return;
    }

    Alert.alert(
      `Delete ${count} pole${count === 1 ? '' : 's'}?`,
      'The selected poles and their inspections, photos, and links will be permanently deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete ${count}`,
          style: 'destructive',
          onPress: () => {
            void handleBulkDelete();
          },
        },
      ],
    );
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

      <View style={styles.bulkBar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          style={({ pressed }) => [styles.bulkToggle, pressed && styles.filterChipPressed]}
        >
          <Text style={styles.bulkToggleText}>{selectMode ? 'Cancel' : 'Select'}</Text>
        </Pressable>
        {selectMode ? (
          <Pressable
            accessibilityRole="button"
            onPress={confirmBulkDelete}
            disabled={selectedIds.size === 0 || isDeleting}
            style={({ pressed }) => [
              styles.bulkDelete,
              (selectedIds.size === 0 || isDeleting) && styles.bulkDeleteDisabled,
              pressed && selectedIds.size > 0 && !isDeleting && styles.filterChipPressed,
            ]}
          >
            {isDeleting ? <ActivityIndicator size="small" color={theme.colors.danger} /> : null}
            <Text style={styles.bulkDeleteText}>Delete ({selectedIds.size})</Text>
          </Pressable>
        ) : null}
      </View>

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
                  selectMode={selectMode}
                  selected={selectedIds.has(asset.id)}
                  onPress={() => (selectMode ? toggleSelect(asset.id) : openAsset(asset))}
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
  selectMode,
  selected,
}: {
  asset: Asset;
  inspected: boolean;
  hasDefect: boolean;
  onPress: () => void;
  selectMode: boolean;
  selected: boolean;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { title, subtitle } = getAssetRowLabels(asset);
  const state = getAssetStateChip(asset, inspected, hasDefect);

  return (
    <Pressable
      accessibilityRole={selectMode ? 'checkbox' : 'button'}
      accessibilityState={selectMode ? { checked: selected } : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.assetRow,
        asset.status === 'NOT_FOUND' && styles.assetRowMuted,
        selected && styles.assetRowSelected,
        pressed && styles.assetRowPressed,
      ]}
    >
      {selectMode ? (
        <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
          {selected ? <Text style={styles.checkboxTick}>✓</Text> : null}
        </View>
      ) : null}
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

const createStyles = (t: Theme) =>
  StyleSheet.create({
    filterRow: {
      marginTop: t.spacing.section,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    filterChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
    },
    filterChipActive: {
      borderColor: t.colors.primary,
      backgroundColor: t.colors.primarySoft,
    },
    filterChipPressed: {
      backgroundColor: t.colors.surfacePressed,
    },
    filterChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: t.colors.textSecondary,
    },
    filterChipTextActive: {
      color: t.colors.primaryStrong,
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
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
    },
    assetRowMuted: {
      opacity: 0.6,
    },
    assetRowSelected: {
      backgroundColor: t.colors.dangerSoft,
      borderColor: t.colors.dangerBorder,
    },
    assetRowPressed: {
      backgroundColor: t.colors.surfacePressed,
    },
    bulkBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 2,
    },
    bulkToggle: {
      minHeight: 38,
      paddingHorizontal: 16,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bulkToggleText: {
      fontSize: 13,
      fontWeight: '700',
      color: t.colors.textPrimary,
    },
    bulkDelete: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 16,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.colors.dangerBorder,
      backgroundColor: t.colors.dangerSoft,
    },
    bulkDeleteDisabled: {
      opacity: 0.5,
    },
    bulkDeleteText: {
      fontSize: 13,
      fontWeight: '700',
      color: t.colors.danger,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    checkboxChecked: {
      borderColor: t.colors.danger,
      backgroundColor: t.colors.danger,
    },
    checkboxTick: {
      color: t.colors.onStatus,
      fontSize: 13,
      fontWeight: '900',
    },
    assetTextWrap: {
      flex: 1,
      gap: 2,
    },
    assetTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: t.colors.textPrimary,
    },
    assetSubtitle: {
      fontSize: 13,
      color: t.colors.textSecondary,
    },
  });

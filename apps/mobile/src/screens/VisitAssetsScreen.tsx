import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { api, ApiError, isEndpointUnavailableError } from '../api';
import { cachedFetch, readCache } from '../offlineCache';
import { isTempId } from '../syncQueue';
import {
  Card,
  Dropdown,
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

type AssetSort = 'RONDAAN_ASC' | 'RONDAAN_DESC' | 'LAMA_ASC' | 'STATUS';

const SORT_OPTIONS: Array<{ value: AssetSort; label: string }> = [
  { value: 'RONDAAN_ASC', label: 'NO TIANG RONDAAN (A–Z)' },
  { value: 'RONDAAN_DESC', label: 'NO TIANG RONDAAN (Z–A)' },
  { value: 'LAMA_ASC', label: 'NO TIANG LAMA (A–Z)' },
  { value: 'STATUS', label: 'Inspection status' },
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
  // Default to the patrol sequence (NO TIANG RONDAAN, natural order) so the list
  // reads as the walk order the crew reviews it in, regardless of API order.
  const [sort, setSort] = useState<AssetSort>('RONDAAN_ASC');
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

        // Temp (offline-created) visit — read straight from cache, never call the
        // server with its non-UUID id (would 400 the moment signal returns).
        if (isTempId(visitId)) {
          const cachedVisit = (await readCache<SiteVisit>('site-visit', visitId))?.value ?? null;

          if (!cachedVisit) {
            setError('This offline visit is no longer available on this device.');
            return;
          }

          const cachedAssets =
            (await readCache<Asset[]>('site-visit-assets', visitId))?.value ??
            (substationId ? (await readCache<Asset[]>('assets', substationId))?.value : null) ??
            [];

          setVisit(cachedVisit);
          setAssets(cachedAssets);
          return;
        }

        const { value: visitResponse } = await cachedFetch('site-visit', visitId, () =>
          api.getSiteVisit(token, visitId),
        );
        let visitAssets: Asset[];
        try {
          const { value } = await cachedFetch('site-visit-assets', visitId, () =>
            api.getSiteVisitAssets(token, visitId),
          );
          visitAssets = value;
        } catch (assetError) {
          if (
            isEndpointUnavailableError(assetError) ||
            (assetError instanceof ApiError && assetError.status === 0)
          ) {
            const { value } = await cachedFetch('assets', substationId, () =>
              api.getAssets(token, substationId),
            );
            visitAssets = value;
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

  const visibleAssets = useMemo(() => {
    const filtered = assets.filter(
      (asset) =>
        matchesFilter(asset, filter, submittedAssetIds, defectAssetIds) &&
        matchesSearch(asset, search),
    );

    return sortAssets(filtered, sort, submittedAssetIds, defectAssetIds);
  }, [assets, filter, search, sort, submittedAssetIds, defectAssetIds]);

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
        <View style={styles.sortWrap}>
          <Dropdown
            label="Sort by"
            value={sort}
            options={SORT_OPTIONS.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            onSelect={(value) => setSort(value as AssetSort)}
          />
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

function sortAssets(
  assets: Asset[],
  sort: AssetSort,
  submittedAssetIds: Set<string>,
  defectAssetIds: Set<string>,
): Asset[] {
  const sorted = [...assets];

  switch (sort) {
    case 'RONDAAN_DESC':
      sorted.sort((a, b) => compareValues(getNoTiangRondaan(a), getNoTiangRondaan(b), true));
      break;
    case 'LAMA_ASC':
      sorted.sort((a, b) => compareValues(getNoTiangLama(a), getNoTiangLama(b), false));
      break;
    case 'STATUS':
      sorted.sort((a, b) => {
        const rankDelta =
          assetStateRank(a, submittedAssetIds, defectAssetIds) -
          assetStateRank(b, submittedAssetIds, defectAssetIds);

        if (rankDelta !== 0) {
          return rankDelta;
        }

        return compareValues(getNoTiangRondaan(a), getNoTiangRondaan(b), false);
      });
      break;
    case 'RONDAAN_ASC':
    default:
      sorted.sort((a, b) => compareValues(getNoTiangRondaan(a), getNoTiangRondaan(b), false));
      break;
  }

  return sorted;
}

/**
 * Compares two display values with missing values ALWAYS sorted last, independent
 * of direction — so choosing Z–A never floats a blank pole to the top. Present
 * values compare naturally; `descending` only reverses the real comparison.
 */
function compareValues(a: string | null, b: string | null, descending: boolean): number {
  if (a == null && b == null) {
    return 0;
  }
  if (a == null) {
    return 1;
  }
  if (b == null) {
    return -1;
  }

  const cmp = naturalCompare(a, b);

  return descending ? -cmp : cmp;
}

// Review order for the status sort: defects first (need attention), then poles
// still pending, then completed inspections, with not-found poles last.
function assetStateRank(
  asset: Asset,
  submittedAssetIds: Set<string>,
  defectAssetIds: Set<string>,
): number {
  if (asset.status === 'NOT_FOUND') {
    return 3;
  }
  if (defectAssetIds.has(asset.id)) {
    return 0;
  }
  if (submittedAssetIds.has(asset.id)) {
    return 2;
  }

  return 1;
}

/**
 * Human/alphanumeric comparison so pole numbers sort by their real sequence:
 * "A 2" before "A 10", and "FP1 C 5" before "FP1 C 5/1". Numeric runs compare as
 * numbers, text runs case-insensitively. Callers handle missing values.
 */
function naturalCompare(a: string, b: string): number {
  const at = tokenizeForSort(a);
  const bt = tokenizeForSort(b);
  const length = Math.min(at.length, bt.length);

  for (let i = 0; i < length; i += 1) {
    const av = at[i];
    const bv = bt[i];

    if (typeof av === 'number' && typeof bv === 'number') {
      if (av !== bv) {
        return av - bv;
      }
    } else if (typeof av === 'number') {
      return -1; // numeric run sorts before a text run at the same position
    } else if (typeof bv === 'number') {
      return 1;
    } else {
      const cmp = av.localeCompare(bv);
      if (cmp !== 0) {
        return cmp;
      }
    }
  }

  return at.length - bt.length;
}

function tokenizeForSort(value: string): Array<string | number> {
  const matches = value.toUpperCase().match(/\d+|\D+/g) ?? [];
  const tokens: Array<string | number> = [];

  for (const match of matches) {
    if (/^\d+$/.test(match)) {
      tokens.push(Number.parseInt(match, 10));
    } else {
      const trimmed = match.trim();
      if (trimmed) {
        tokens.push(trimmed);
      }
    }
  }

  return tokens;
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
    sortWrap: {
      marginTop: t.spacing.section,
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

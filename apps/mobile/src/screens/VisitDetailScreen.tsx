import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import { API_BASE_URL, api, ApiError, isEndpointUnavailableError } from '../api';
import {
  AppButton,
  Card,
  EmptyState,
  ErrorBanner,
  KeyValueRow,
  LoadingBlock,
  Screen,
  SectionTitle,
  StatusChip,
  SuccessBanner,
  TextField,
  WarningBanner,
  uiTheme,
} from '../ui';
import {
  enqueueVisitCompletion,
  hasQueuedVisitCompletion,
  isRetryableSyncError,
  SyncQueueSnapshot,
} from '../syncQueue';
import { Asset, SiteVisit, SiteVisitSummary } from '../types';
import { formatDateTime } from '../utils';

type Coordinate = {
  latitude: number;
  longitude: number;
};

type ThumbnailImage = {
  uri?: string | null;
  url?: string | null;
  path?: string | null;
};

type AssetWithOptionalDisplayData = Asset & {
  images?: ThumbnailImage[];
  inspectionImages?: ThumbnailImage[];
  latestInspection?: {
    images?: ThumbnailImage[];
  } | null;
  noTiangRondaan?: unknown;
  no_tiang_rondaan?: unknown;
};

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');
const DEFAULT_REGION: Region = {
  latitude: 3.139,
  longitude: 101.6869,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export function VisitDetailScreen({
  token,
  visitId,
  substationId,
  successMessage,
  isOffline,
  syncQueueSnapshot,
  onBack,
  onOpenAddAsset,
  onOpenAssetMap,
  onOpenAssetDetail,
  onUnauthorized,
}: {
  token: string;
  visitId: string;
  substationId: string;
  successMessage?: string;
  isOffline: boolean;
  syncQueueSnapshot: SyncQueueSnapshot;
  onBack: () => void;
  onOpenAddAsset: () => void;
  onOpenAssetMap: () => void;
  onOpenAssetDetail: (asset: Asset) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [visit, setVisit] = useState<SiteVisit | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompleting, setIsCompleting] = useState(false);
  const [linkingAssetId, setLinkingAssetId] = useState<string | null>(null);
  const [completionNotes, setCompletionNotes] = useState('');
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isCompletionQueued = hasQueuedVisitCompletion(syncQueueSnapshot, visitId);

  const loadVisitData = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [visitResponse, substationAssetList] = await Promise.all([
        api.getSiteVisit(token, visitId),
        api.getAssets(token, substationId),
      ]);
      const visitAssetList = await loadVisitScopedAssets(token, visitId, substationAssetList);

      setVisit(visitResponse);
      setAssets(visitAssetList);
      setAvailableAssets(createAvailableAssetList(substationAssetList, visitAssetList));
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await onUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load visit details.');
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized, substationId, token, visitId]);

  useEffect(() => {
    loadVisitData();
  }, [loadVisitData]);

  async function handleCompleteVisit() {
    if (!visit) {
      return;
    }

    const payload = {
      completedAt: new Date().toISOString(),
      completionNotes: completionNotes.trim() || undefined,
    };

    if (isOffline) {
      await queueVisitCompletion(visit, payload, 'Queued while offline.');
      return;
    }

    try {
      setIsCompleting(true);
      setError(null);
      setCompletionNotice(null);

      const completedVisit = await api.completeSiteVisit(token, visit.id, payload);

      setVisit(completedVisit);
      setCompletionNotice('Visit completed successfully.');
    } catch (completeError) {
      if (completeError instanceof ApiError && completeError.status === 401) {
        await onUnauthorized(completeError);
        return;
      }

      if (isEndpointUnavailableError(completeError)) {
        setError('Visit completion is not available on this backend version.');
        return;
      }

      if (isRetryableSyncError(completeError)) {
        const message =
          completeError instanceof Error
            ? completeError.message
            : 'Connection unavailable during visit completion.';

        await queueVisitCompletion(visit, payload, message);
        return;
      }

      setError(completeError instanceof Error ? completeError.message : 'Unable to complete visit.');
    } finally {
      setIsCompleting(false);
    }
  }

  async function queueVisitCompletion(
    currentVisit: SiteVisit,
    payload: { completedAt: string; completionNotes?: string },
    errorMessage: string,
  ) {
    try {
      setError(null);
      setCompletionNotice(null);

      await enqueueVisitCompletion({
        visit: currentVisit,
        assets,
        payload,
        errorMessage,
      });

      setCompletionNotice('Visit completion saved to Sync Queue.');
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : 'Unable to queue visit completion.');
    }
  }

  function handleConfirmCompleteVisit() {
    if (!visit || isVisitTerminal(visit.status) || isCompletionQueued) {
      return;
    }

    const rollup = createVisitRollup(visit, assets);
    const queuedInspectionCount = getQueuedInspectionCount(syncQueueSnapshot, visit.id);

    if (rollup.totalAssets === 0) {
      setError('Link at least one asset to this visit before completing it.');
      return;
    }

    if (queuedInspectionCount > 0 && !isOffline) {
      setError(
        `${queuedInspectionCount} inspection submission${queuedInspectionCount === 1 ? '' : 's'} still need to sync before this visit can be completed.`,
      );
      return;
    }

    const message =
      queuedInspectionCount > 0
        ? `${queuedInspectionCount} inspection submission${queuedInspectionCount === 1 ? '' : 's'} will sync before visit completion.`
        : rollup.pendingAssets > 0
        ? `${rollup.pendingAssets} asset${rollup.pendingAssets === 1 ? '' : 's'} still have no submitted inspection. Complete this visit anyway?`
        : 'This will close the shared site visit for the team.';

    Alert.alert('Complete visit?', message, [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: isOffline ? 'Queue Completion' : 'Complete Visit',
        onPress: () => {
          void handleCompleteVisit();
        },
      },
    ]);
  }

  async function handleLinkAsset(asset: Asset) {
    try {
      setError(null);
      setCompletionNotice(null);
      setLinkingAssetId(asset.id);

      const link = await api.linkSiteVisitAsset(token, visitId, asset.id);
      const linkedAsset = link.asset ?? asset;

      setAssets((currentAssets) => appendUniqueAsset(currentAssets, linkedAsset));
      setAvailableAssets((currentAssets) =>
        currentAssets.filter((currentAsset) => currentAsset.id !== asset.id),
      );
      setCompletionNotice(`${asset.assetCode} linked to this visit.`);
    } catch (linkError) {
      if (linkError instanceof ApiError && linkError.status === 401) {
        await onUnauthorized(linkError);
        return;
      }

      if (isEndpointUnavailableError(linkError)) {
        setAssets((currentAssets) => appendUniqueAsset(currentAssets, asset));
        setAvailableAssets((currentAssets) =>
          currentAssets.filter((currentAsset) => currentAsset.id !== asset.id),
        );
        setCompletionNotice(`${asset.assetCode} added locally for this visit.`);
        return;
      }

      setError(linkError instanceof Error ? linkError.message : 'Unable to link asset to visit.');
    } finally {
      setLinkingAssetId(null);
    }
  }

  return (
    <Screen
      title="Visit Detail"
      leftAction={{ icon: 'back', onPress: onBack, accessibilityLabel: 'Back' }}
      rightAction={{
        icon: 'refresh',
        onPress: loadVisitData,
        accessibilityLabel: 'Refresh',
        disabled: isLoading,
      }}
    >
      <ErrorBanner message={error} />
      <WarningBanner
        message={
          isOffline
            ? 'Offline mode: submitted inspections and visit completion stay in Sync Queue until connection returns.'
            : null
        }
      />
      <SuccessBanner message={successMessage} />
      <SuccessBanner message={completionNotice} />
      {isLoading ? <LoadingBlock label="Loading visit and assets..." /> : null}

      {!isLoading && visit ? (
        <>
          <VisitProgressCard rollup={createVisitRollup(visit, assets)} />

          <Card>
            <SectionTitle>Visit Summary</SectionTitle>
            <KeyValueRow label="Pencawang" value={`${visit.substation.code} - ${visit.substation.name}`} />
            <KeyValueRow label="Team" value={`${visit.team.code} - ${visit.team.name}`} />
            <KeyValueRow label="Started" value={formatDateTime(visit.startedAt)} />
            {visit.completedAt ? <KeyValueRow label="Completed" value={formatDateTime(visit.completedAt)} /> : null}
            <KeyValueRow label="Created By" value={visit.createdBy?.name ?? 'Unknown'} />
            {visit.substation.location ? <KeyValueRow label="Location" value={visit.substation.location} /> : null}
            <StatusChip label={formatStatusLabel(visit.status)} tone={getVisitStatusTone(visit.status)} />
          </Card>

          <VisitAssetMap
            assets={assets}
            onOpenAsset={onOpenAssetDetail}
            onOpenFullScreen={onOpenAssetMap}
          />

          <Card>
            <View style={styles.assetHeader}>
              <SectionTitle>Visit Assets</SectionTitle>
              <Pressable
                accessibilityRole="button"
                disabled={isVisitTerminal(visit.status)}
                onPress={onOpenAddAsset}
                style={({ pressed }) => [
                  styles.addAssetButton,
                  isVisitTerminal(visit.status) && styles.disabledButton,
                  pressed && !isVisitTerminal(visit.status) && styles.buttonPressed,
                ]}
              >
                <Text style={styles.addAssetButtonText}>+ Add</Text>
              </Pressable>
            </View>

            {assets.length === 0 ? (
              <EmptyState
                title="No assets found"
                description="Add or inspect an asset to link it to this visit."
              />
            ) : (
              <View style={styles.assetList}>
                {assets.map((asset) => (
                  <AssetListRow
                    key={asset.id}
                    asset={asset}
                    visit={visit}
                    onPress={() => onOpenAssetDetail(asset)}
                  />
                ))}
              </View>
            )}
          </Card>

          {availableAssets.length > 0 && !isVisitTerminal(visit.status) ? (
            <Card>
              <View style={styles.assetHeader}>
                <SectionTitle>Available Assets</SectionTitle>
                <Text style={styles.countText}>{availableAssets.length}</Text>
              </View>
              <View style={styles.assetList}>
                {availableAssets.map((asset) => (
                  <AssetListRow
                    key={asset.id}
                    asset={asset}
                    visit={visit}
                    rightLabel={linkingAssetId === asset.id ? 'Linking' : 'Link'}
                    disabled={linkingAssetId === asset.id}
                    onPress={() => {
                      void handleLinkAsset(asset);
                    }}
                  />
                ))}
              </View>
            </Card>
          ) : null}

          <Card>
            <SectionTitle>Complete Visit</SectionTitle>
            <TextField
              label="Completion Notes"
              value={completionNotes}
              onChangeText={setCompletionNotes}
              placeholder="Add final notes for this visit"
              editable={!isVisitTerminal(visit.status) && !isCompletionQueued && !isCompleting}
              multiline
            />
            <AppButton
              label={
                isCompletionQueued
                  ? 'Completion Queued'
                  : isVisitTerminal(visit.status)
                    ? 'Visit Completed'
                    : isCompleting
                      ? 'Completing Visit...'
                      : isOffline
                        ? 'Queue Visit Completion'
                        : 'Complete Visit'
              }
              variant={isVisitTerminal(visit.status) ? 'secondary' : 'primary'}
              onPress={handleConfirmCompleteVisit}
              loading={isCompleting}
              disabled={isVisitTerminal(visit.status) || isCompletionQueued || isCompleting}
            />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function VisitProgressCard({ rollup }: { rollup: SiteVisitSummary }) {
  return (
    <Card>
      <View style={styles.progressHeader}>
        <View style={styles.progressTitleWrap}>
          <SectionTitle>Visit Progress</SectionTitle>
          <Text style={styles.progressSubtitle}>
            {rollup.inspectedAssets} of {rollup.totalAssets} assets inspected
          </Text>
        </View>
        <Text style={styles.progressPercent}>{rollup.completionPercentage}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.min(Math.max(rollup.completionPercentage, 0), 100)}%` },
          ]}
        />
      </View>
      <View style={styles.progressStats}>
        <ProgressStat label="Pending" value={rollup.pendingAssets} />
        <ProgressStat label="Defects" value={rollup.defectsFound} />
        <ProgressStat label="Assets" value={rollup.totalAssets} />
      </View>
    </Card>
  );
}

function ProgressStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.progressStat}>
      <Text style={styles.progressStatValue}>{value}</Text>
      <Text style={styles.progressStatLabel}>{label}</Text>
    </View>
  );
}

function VisitAssetMap({
  assets,
  onOpenAsset,
  onOpenFullScreen,
}: {
  assets: Asset[];
  onOpenAsset: (asset: Asset) => void;
  onOpenFullScreen: () => void;
}) {
  const mappedAssets = assets
    .map((asset) => {
      const coordinate = getAssetCoordinate(asset);

      return coordinate ? { asset, coordinate } : null;
    })
    .filter(isMappedAsset);
  const region = createRegion(mappedAssets.map((item) => item.coordinate));

  return (
    <Card>
      <View style={styles.mapHeader}>
        <SectionTitle>Map</SectionTitle>
        <Pressable
          accessibilityRole="button"
          onPress={onOpenFullScreen}
          style={({ pressed }) => [styles.fullScreenButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.fullScreenButtonText}>View Full Screen</Text>
        </Pressable>
      </View>

      {mappedAssets.length === 0 ? (
        <EmptyState
          title="No mapped assets"
          description="Assets with GPS coordinates will appear on this pencawang map."
        />
      ) : (
        <View style={styles.mapFrame}>
          <MapView
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            initialRegion={region}
            region={region}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            toolbarEnabled={false}
          >
            {mappedAssets.map(({ asset, coordinate }) => (
              <Marker
                key={asset.id}
                coordinate={coordinate}
                title={asset.assetCode}
                description={asset.name ?? asset.assetType.name}
                pinColor={uiTheme.colors.primary}
                onPress={() => onOpenAsset(asset)}
              />
            ))}
          </MapView>
        </View>
      )}
    </Card>
  );
}

function AssetListRow({
  asset,
  visit,
  rightLabel = '>',
  disabled = false,
  onPress,
}: {
  asset: Asset;
  visit: SiteVisit;
  rightLabel?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const thumbnailUri = getAssetThumbnailUri(asset, visit);
  const noTiangRondaan = getNoTiangRondaan(asset);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.assetRow,
        asset.status === 'NOT_FOUND' && styles.assetRowMuted,
        disabled && styles.assetRowDisabled,
        pressed && !disabled && styles.assetRowPressed,
      ]}
    >
      <View style={styles.thumbnailFrame}>
        {thumbnailUri ? (
          <Image source={{ uri: thumbnailUri }} style={styles.thumbnail} resizeMode="cover" />
        ) : (
          <View style={styles.thumbnailPlaceholder}>
            <Text style={styles.thumbnailPlaceholderText}>No image</Text>
          </View>
        )}
      </View>

      <View style={styles.assetTextWrap}>
        <Text style={styles.assetName} numberOfLines={1}>
          {asset.name || 'Unnamed asset'}
        </Text>
        <Text style={styles.assetMeta} numberOfLines={1}>
          Code: {asset.assetCode}
        </Text>
        <Text style={styles.assetMeta} numberOfLines={1}>
          No Tiang Rondaan: {noTiangRondaan}
        </Text>
      </View>

      <Text style={rightLabel === '>' ? styles.rowArrow : styles.rowActionLabel}>
        {rightLabel}
      </Text>
    </Pressable>
  );
}

async function loadVisitScopedAssets(
  token: string,
  visitId: string,
  fallbackAssets: Asset[],
) {
  try {
    return await api.getSiteVisitAssets(token, visitId);
  } catch (error) {
    if (isEndpointUnavailableError(error)) {
      return fallbackAssets;
    }

    throw error;
  }
}

function createAvailableAssetList(substationAssets: Asset[], visitAssets: Asset[]) {
  const visitAssetIds = new Set(visitAssets.map((asset) => asset.id));

  return substationAssets.filter((asset) => !visitAssetIds.has(asset.id));
}

function appendUniqueAsset(assets: Asset[], asset: Asset) {
  if (assets.some((currentAsset) => currentAsset.id === asset.id)) {
    return assets;
  }

  return [...assets, asset];
}

function getQueuedInspectionCount(snapshot: SyncQueueSnapshot, siteVisitId: string) {
  return snapshot.items.filter((item) => item.summary.siteVisitId === siteVisitId).length;
}

function getAssetThumbnailUri(asset: Asset, visit: SiteVisit) {
  const image = getFirstAssetImage(asset, visit);

  return image ? getImageSourceUri(image) : null;
}

function getFirstAssetImage(asset: Asset, visit: SiteVisit): ThumbnailImage | null {
  const flexibleAsset = asset as AssetWithOptionalDisplayData;
  const assetImage =
    flexibleAsset.images?.[0] ??
    flexibleAsset.latestInspection?.images?.[0] ??
    flexibleAsset.inspectionImages?.[0];

  if (assetImage) {
    return assetImage;
  }

  for (const inspection of visit.inspections ?? []) {
    if (inspection.assetId !== asset.id) {
      continue;
    }

    const inspectionImage = inspection.inspectionImages?.[0] ?? inspection.images?.[0];

    if (inspectionImage) {
      return inspectionImage;
    }
  }

  return null;
}

function getImageSourceUri(image: ThumbnailImage) {
  const source = image.uri || image.url || image.path;

  if (!source) {
    return null;
  }

  if (/^[a-z][a-z\d+\-.]*:/i.test(source)) {
    return source;
  }

  return source.startsWith('/') ? `${API_ORIGIN}${source}` : `${API_ORIGIN}/${source}`;
}

function getNoTiangRondaan(asset: Asset) {
  const flexibleAsset = asset as AssetWithOptionalDisplayData;
  const metadata = asset.metadata && typeof asset.metadata === 'object' ? asset.metadata : {};
  const value =
    flexibleAsset.noTiangRondaan ??
    flexibleAsset.no_tiang_rondaan ??
    getMetadataValue(metadata, [
      'noTiangRondaan',
      'no_tiang_rondaan',
      'No Tiang Rondaan',
      'noTiang',
      'poleNumber',
    ]);

  return normalizeDisplayValue(value) ?? 'Not available';
}

function getMetadataValue(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (key in metadata) {
      return metadata[key];
    }
  }

  return undefined;
}

function normalizeDisplayValue(value: unknown) {
  if (typeof value === 'string') {
    const trimmedValue = value.trim();

    return trimmedValue || null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function createVisitRollup(visit: SiteVisit, assets: Asset[]): SiteVisitSummary {
  const totalAssets =
    getNumericRollupValue(visit.summary?.totalAssets, visit.totalAssets) ?? assets.length;
  const inspectedAssets =
    getNumericRollupValue(visit.summary?.inspectedAssets, visit.inspectedAssets) ??
    getSubmittedInspectionAssetIds(visit).size;
  const pendingAssets =
    getNumericRollupValue(visit.summary?.pendingAssets, visit.pendingAssets) ??
    Math.max(totalAssets - inspectedAssets, 0);
  const defectsFound = getNumericRollupValue(visit.summary?.defectsFound, visit.defectsFound) ?? 0;
  const completionPercentage =
    getNumericRollupValue(visit.summary?.completionPercentage, visit.completionPercentage) ??
    (totalAssets === 0 ? 0 : Math.round((inspectedAssets / totalAssets) * 100));

  return {
    totalAssets,
    inspectedAssets,
    pendingAssets,
    defectsFound,
    completionPercentage,
  };
}

function getSubmittedInspectionAssetIds(visit: SiteVisit) {
  const assetIds = new Set<string>();

  for (const inspection of visit.inspections ?? []) {
    if (inspection.completionStatus === 'SUBMITTED' || inspection.submittedAt) {
      assetIds.add(inspection.assetId);
    }
  }

  return assetIds;
}

function getNumericRollupValue(...values: Array<number | undefined>) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function formatStatusLabel(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getVisitStatusTone(status: string) {
  if (status === 'COMPLETED') {
    return 'success';
  }

  if (status === 'CANCELLED') {
    return 'warning';
  }

  return 'success';
}

function isVisitTerminal(status: string) {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

function getAssetCoordinate(asset: Asset) {
  return createCoordinate(asset.latitude, asset.longitude);
}

function createCoordinate(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
) {
  if (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  ) {
    return {
      latitude,
      longitude,
    };
  }

  return null;
}

function createRegion(coordinates: Coordinate[]): Region {
  if (coordinates.length === 0) {
    return DEFAULT_REGION;
  }

  if (coordinates.length === 1) {
    return {
      latitude: coordinates[0].latitude,
      longitude: coordinates[0].longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }

  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);
  const minimumLatitude = Math.min(...latitudes);
  const maximumLatitude = Math.max(...latitudes);
  const minimumLongitude = Math.min(...longitudes);
  const maximumLongitude = Math.max(...longitudes);

  return {
    latitude: (minimumLatitude + maximumLatitude) / 2,
    longitude: (minimumLongitude + maximumLongitude) / 2,
    latitudeDelta: Math.max((maximumLatitude - minimumLatitude) * 1.6, 0.01),
    longitudeDelta: Math.max((maximumLongitude - minimumLongitude) * 1.6, 0.01),
  };
}

function isMappedAsset(
  value: { asset: Asset; coordinate: Coordinate } | null,
): value is { asset: Asset; coordinate: Coordinate } {
  return value !== null;
}

const styles = StyleSheet.create({
  progressHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  progressTitleWrap: {
    flex: 1,
    gap: 3,
  },
  progressSubtitle: {
    color: uiTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  progressPercent: {
    minWidth: 58,
    color: uiTheme.colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    textAlign: 'right',
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: uiTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: uiTheme.colors.success,
  },
  progressStats: {
    flexDirection: 'row',
    gap: 10,
  },
  progressStat: {
    flex: 1,
    minHeight: 62,
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.surfaceMuted,
    justifyContent: 'center',
    paddingHorizontal: 10,
    gap: 2,
  },
  progressStatValue: {
    color: uiTheme.colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  progressStatLabel: {
    color: uiTheme.colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  mapHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  fullScreenButton: {
    minHeight: 44,
    borderRadius: uiTheme.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiTheme.colors.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    paddingHorizontal: 14,
  },
  fullScreenButtonText: {
    color: uiTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  mapFrame: {
    height: 220,
    borderRadius: uiTheme.radius.card,
    overflow: 'hidden',
    backgroundColor: uiTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  map: {
    flex: 1,
  },
  assetHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  countText: {
    minWidth: 36,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: uiTheme.colors.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    color: uiTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  addAssetButton: {
    minHeight: 44,
    borderRadius: uiTheme.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiTheme.colors.primary,
    paddingHorizontal: 14,
  },
  addAssetButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  assetList: {
    gap: 10,
  },
  assetRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    padding: 8,
  },
  assetRowMuted: {
    opacity: 0.56,
  },
  assetRowDisabled: {
    opacity: 0.68,
  },
  assetRowPressed: {
    backgroundColor: uiTheme.colors.surfacePressed,
    transform: [{ scale: 0.995 }],
  },
  thumbnailFrame: {
    width: 54,
    height: 54,
    borderRadius: uiTheme.radius.card,
    overflow: 'hidden',
    backgroundColor: uiTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  thumbnailPlaceholderText: {
    color: uiTheme.colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  assetTextWrap: {
    flex: 1,
    gap: 3,
  },
  assetName: {
    color: uiTheme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  assetMeta: {
    color: uiTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  rowArrow: {
    width: 18,
    color: uiTheme.colors.textMuted,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'right',
  },
  rowActionLabel: {
    minWidth: 54,
    color: uiTheme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    textAlign: 'right',
  },
  disabledButton: {
    opacity: 0.54,
  },
  buttonPressed: {
    opacity: 0.82,
  },
});

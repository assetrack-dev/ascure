import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import { API_BASE_URL, api, ApiError } from '../api';
import {
  Card,
  EmptyState,
  ErrorBanner,
  KeyValueRow,
  LoadingBlock,
  Screen,
  SectionTitle,
  StatusChip,
  SuccessBanner,
  uiTheme,
} from '../ui';
import { Asset, SiteVisit } from '../types';
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
  onBack: () => void;
  onOpenAddAsset: () => void;
  onOpenAssetMap: () => void;
  onOpenAssetDetail: (asset: Asset) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [visit, setVisit] = useState<SiteVisit | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadVisitData = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [visitResponse, assetList] = await Promise.all([
        api.getSiteVisit(token, visitId),
        api.getAssets(token, substationId),
      ]);

      setVisit(visitResponse);
      setAssets(assetList);
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
      <SuccessBanner message={successMessage} />
      {isLoading ? <LoadingBlock label="Loading visit and assets..." /> : null}

      {!isLoading && visit ? (
        <>
          <Card>
            <SectionTitle>Visit Summary</SectionTitle>
            <KeyValueRow label="Pencawang" value={`${visit.substation.code} - ${visit.substation.name}`} />
            <KeyValueRow label="Team" value={`${visit.team.code} - ${visit.team.name}`} />
            <KeyValueRow label="Started" value={formatDateTime(visit.startedAt)} />
            <KeyValueRow label="Created By" value={visit.createdBy?.name ?? 'Unknown'} />
            {visit.substation.location ? <KeyValueRow label="Location" value={visit.substation.location} /> : null}
            <StatusChip label={visit.status} tone="success" />
          </Card>

          <VisitAssetMap
            assets={assets}
            onOpenAsset={onOpenAssetDetail}
            onOpenFullScreen={onOpenAssetMap}
          />

          <Card>
            <View style={styles.assetHeader}>
              <SectionTitle>Assets</SectionTitle>
              <Pressable
                accessibilityRole="button"
                onPress={onOpenAddAsset}
                style={({ pressed }) => [styles.addAssetButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.addAssetButtonText}>+ Add</Text>
              </Pressable>
            </View>

            {assets.length === 0 ? (
              <EmptyState
                title="No assets found"
                description="Add the first asset for this pencawang before starting inspections."
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
        </>
      ) : null}
    </Screen>
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
  onPress,
}: {
  asset: Asset;
  visit: SiteVisit;
  onPress: () => void;
}) {
  const thumbnailUri = getAssetThumbnailUri(asset, visit);
  const noTiangRondaan = getNoTiangRondaan(asset);

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

      <Text style={styles.rowArrow}>{'>'}</Text>
    </Pressable>
  );
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
  buttonPressed: {
    opacity: 0.82,
  },
});

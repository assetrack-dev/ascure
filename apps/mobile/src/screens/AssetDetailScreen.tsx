import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api, ApiError, API_BASE_URL } from '../api';
import { AssetDetailImage, AssetDetailResponse } from '../types';
import { formatDateTime } from '../utils';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

export function AssetDetailScreen({
  token,
  visitId,
  assetId,
  onBack,
  onOpenInspection,
  onOpenInspectionHistory,
  onUnauthorized,
}: {
  token: string;
  visitId: string;
  assetId: string;
  onBack: () => void;
  onOpenInspection: (inspectionId: string) => void;
  onOpenInspectionHistory: (params: { assetId: string; assetCode?: string }) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [asset, setAsset] = useState<AssetDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingInspection, setIsStartingInspection] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadAssetDetail = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadFailed(false);
      setActionError(null);

      const response = await api.getAssetDetail(token, assetId);
      setAsset(response);
    } catch (error) {
      console.error('[ASSET DETAIL LOAD ERROR]', error);

      if (error instanceof ApiError && error.status === 401) {
        await onUnauthorized(error);
        return;
      }

      setAsset(null);
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [assetId, onUnauthorized, token]);

  useEffect(() => {
    loadAssetDetail();
  }, [loadAssetDetail]);

  const images = useMemo(() => asset?.latestInspection?.images ?? [], [asset]);

  async function handleStartInspection() {
    if (!asset) {
      return;
    }

    try {
      setIsStartingInspection(true);
      setActionError(null);

      const inspection = await api.createInspection(token, {
        siteVisitId: visitId,
        assetId,
        inspectionCycle: asset.latestInspection ? asset.latestInspection.cycleNumber + 1 : 1,
      });

      onOpenInspection(inspection.id);
    } catch (error) {
      console.error('[ASSET DETAIL START INSPECTION ERROR]', error);

      if (error instanceof ApiError && error.status === 401) {
        await onUnauthorized(error);
        return;
      }

      setActionError(error instanceof Error ? error.message : 'Unable to start inspection.');
    } finally {
      setIsStartingInspection(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.centerScreen}>
        <ActivityIndicator size="large" color="#0f5cd8" />
        <Text style={styles.loadingText}>Loading asset detail...</Text>
      </View>
    );
  }

  if (loadFailed || !asset) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.inlineButton}>
            <Text style={styles.inlineButtonText}>Back</Text>
          </Pressable>
        </View>
        <View style={styles.centerContent}>
          <Text style={styles.emptyTitle}>Asset not found</Text>
          <Text style={styles.emptyText}>This asset could not be loaded. Please refresh the visit and try again.</Text>
        </View>
      </View>
    );
  }

  const latestInspection = asset.latestInspection;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.title}>Asset Detail</Text>
          <Text style={styles.subtitle}>{asset.assetCode || 'No asset code available'}</Text>
        </View>
        <Pressable onPress={onBack} style={styles.inlineButton}>
          <Text style={styles.inlineButtonText}>Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {actionError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{actionError}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Asset Information</Text>
          <InfoRow label="Asset Code" value={asset.assetCode || 'No asset code available'} />
          <InfoRow label="Asset Type" value={asset.assetType || 'No asset type available'} />
          <InfoRow label="Status" value={formatLabel(asset.status) || 'No status available'} />
          <InfoRow label="Latitude" value={formatCoordinate(asset.latitude)} />
          <InfoRow label="Longitude" value={formatCoordinate(asset.longitude)} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Latest Submitted Inspection</Text>
          {latestInspection ? (
            <>
              <InfoRow label="Cycle" value={`Cycle ${latestInspection.cycleNumber}`} />
              <InfoRow label="Status" value={formatLabel(latestInspection.status)} />
              <InfoRow label="Submitted" value={formatDateTime(latestInspection.submittedAt)} />
              <Text style={styles.fieldLabel}>Remarks</Text>
              <Text style={latestInspection.remarks ? styles.bodyText : styles.placeholderText}>
                {latestInspection.remarks || 'No remarks recorded.'}
              </Text>
            </>
          ) : (
            <Text style={styles.placeholderText}>No submitted inspection yet.</Text>
          )}
        </View>

        <Pressable
          onPress={() =>
            onOpenInspectionHistory({
              assetId: asset.id,
              assetCode: asset.assetCode,
            })
          }
          style={({ pressed }) => [styles.historyButton, pressed && styles.pressedButton]}
        >
          <Text style={styles.historyButtonText}>View All Inspections</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Inspection Images</Text>
          {images.length === 0 ? (
            <Text style={styles.placeholderText}>No inspection images yet.</Text>
          ) : (
            images.map((image, index) => {
              const imageUri = getImageSourceUri(image);

              return (
                <View key={`${imageUri ?? 'missing-image'}-${index}`} style={styles.imageBlock}>
                  {image.type ? <Text style={styles.imageType}>{image.type}</Text> : null}
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <Text style={styles.placeholderText}>Image unavailable.</Text>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>

        <Pressable
          onPress={handleStartInspection}
          disabled={isStartingInspection}
          style={({ pressed }) => [
            styles.startButton,
            isStartingInspection && styles.disabledButton,
            pressed && !isStartingInspection && styles.pressedButton,
          ]}
        >
          {isStartingInspection ? <ActivityIndicator color="#ffffff" /> : null}
          <Text style={styles.startButtonText}>Start New Inspection</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function formatCoordinate(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'No coordinate available';
  }

  return value.toFixed(6);
}

function formatLabel(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getImageSourceUri(image: AssetDetailImage) {
  const source = image.uri || image.url;

  if (!source) {
    return null;
  }

  if (/^[a-z][a-z\d+\-.]*:/i.test(source)) {
    return source;
  }

  if (source.startsWith('/')) {
    return `${API_ORIGIN}${source}`;
  }

  return source;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4f7fb',
    paddingTop: Platform.OS === 'android' ? 24 : 16,
  },
  centerScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#f4f7fb',
    paddingHorizontal: 24,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  headerTitleWrap: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 15,
    color: '#526277',
  },
  inlineButton: {
    paddingVertical: 6,
  },
  inlineButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f5cd8',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 140,
    gap: 16,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#dce5f1',
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#0f172a',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  infoLabel: {
    flex: 1,
    fontSize: 14,
    color: '#607086',
  },
  infoValue: {
    flex: 1.2,
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    textAlign: 'right',
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#607086',
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#10233d',
  },
  placeholderText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#607086',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#607086',
    textAlign: 'center',
  },
  loadingText: {
    fontSize: 15,
    color: '#526277',
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 14,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#991b1b',
    fontWeight: '600',
  },
  imageBlock: {
    gap: 8,
  },
  imageType: {
    fontSize: 13,
    fontWeight: '700',
    color: '#607086',
  },
  image: {
    width: '100%',
    height: 220,
    borderRadius: 14,
    backgroundColor: '#e5edf8',
  },
  imagePlaceholder: {
    height: 120,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef4fb',
    borderWidth: 1,
    borderColor: '#d9e4f2',
  },
  historyButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#e5edf8',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  historyButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#10233d',
  },
  startButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#0f5cd8',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  disabledButton: {
    opacity: 0.6,
  },
  pressedButton: {
    transform: [{ scale: 0.99 }],
  },
});

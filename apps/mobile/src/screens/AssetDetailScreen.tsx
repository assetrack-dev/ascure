import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  StatusBar as NativeStatusBar,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { api, ApiError, API_BASE_URL } from '../api';
import { Asset, AssetDetailImage, AssetDetailResponse } from '../types';
import { formatDateTime } from '../utils';
import { HeaderIconButton, uiTheme } from '../ui';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

export function AssetDetailScreen({
  token,
  visitId,
  substationId,
  assetId,
  assetSnapshot,
  onBack,
  onOpenInspection,
  onOpenInspectionHistory,
  onOpenEditAsset,
  onOpenImagePreview,
  onUnauthorized,
}: {
  token: string;
  visitId?: string;
  substationId?: string;
  assetId: string;
  assetSnapshot?: Asset;
  onBack: () => void;
  onOpenInspection: (inspectionId: string) => void;
  onOpenInspectionHistory: (params: { assetId: string; assetCode?: string }) => void;
  onOpenEditAsset: (asset: Asset) => void;
  onOpenImagePreview: (params: { uri: string; title?: string }) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [asset, setAsset] = useState<AssetDetailResponse | null>(null);
  const [editableAsset, setEditableAsset] = useState<Asset | null>(assetSnapshot ?? null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingInspection, setIsStartingInspection] = useState(false);
  const [isMarkingNotFound, setIsMarkingNotFound] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { width: screenWidth } = useWindowDimensions();

  const loadAssetDetail = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadFailed(false);
      setActionError(null);

      const response = await api.getAssetDetail(token, assetId);
      const assetList =
        !assetSnapshot && substationId
          ? await loadEditableAssetList(token, substationId)
          : null;
      setAsset(response);
      setEditableAsset(assetSnapshot ?? assetList?.find((item) => item.id === assetId) ?? null);
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
  }, [assetId, assetSnapshot, onUnauthorized, substationId, token]);

  useEffect(() => {
    loadAssetDetail();
  }, [loadAssetDetail]);

  const images = useMemo(() => asset?.latestInspection?.images ?? [], [asset]);
  const imageCarouselWidth = Math.max(180, screenWidth - 72);

  async function handleStartInspection() {
    if (!asset || !visitId) {
      return;
    }

    try {
      setIsStartingInspection(true);
      setActionError(null);

      const activeTemplate = await api.getChecklistTemplateByAssetType(token, asset.assetType);

      if (activeTemplate.items.length === 0) {
        setActionError(
          'No active checklist template is available for this asset type. Ask an admin to activate one before starting an inspection.',
        );
        return;
      }

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

      setActionError(
        error instanceof ApiError && error.status === 404
          ? 'No active checklist template is available for this asset type. Ask an admin to activate one before starting an inspection.'
          : error instanceof Error
            ? error.message
            : 'Unable to start inspection.',
      );
    } finally {
      setIsStartingInspection(false);
    }
  }

  function handleEditAsset() {
    if (!editableAsset) {
      setActionError('Unable to load editable asset details.');
      return;
    }

    onOpenEditAsset(editableAsset);
  }

  async function handleMarkAssetNotFound() {
    if (!asset || asset.status === 'NOT_FOUND') {
      return;
    }

    try {
      setIsMarkingNotFound(true);
      setActionError(null);

      const updatedAsset = await api.updateAssetStatus(token, assetId, {
        status: 'NOT_FOUND',
      });

      setEditableAsset(updatedAsset);
      setAsset((currentAsset) =>
        currentAsset
          ? {
              ...currentAsset,
              status: updatedAsset.status,
            }
          : currentAsset,
      );
    } catch (error) {
      console.error('[ASSET DETAIL MARK NOT FOUND ERROR]', error);

      if (error instanceof ApiError && error.status === 401) {
        await onUnauthorized(error);
        return;
      }

      setActionError(error instanceof Error ? error.message : 'Unable to mark asset as not found.');
    } finally {
      setIsMarkingNotFound(false);
    }
  }

  function handleConfirmMarkAssetNotFound() {
    if (!asset || asset.status === 'NOT_FOUND') {
      return;
    }

    Alert.alert(
      'Mark asset as not found?',
      'The asset will remain in this pencawang list and be marked as Not Found.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Mark Not Found',
          style: 'destructive',
          onPress: () => {
            void handleMarkAssetNotFound();
          },
        },
      ],
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centerScreen}>
        <ExpoStatusBar style="dark" />
        <ActivityIndicator size="large" color={uiTheme.colors.primary} />
        <Text style={styles.loadingText}>Loading asset detail...</Text>
      </SafeAreaView>
    );
  }

  if (loadFailed || !asset) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ExpoStatusBar style="dark" />
        <View style={styles.screen}>
          <View style={styles.header}>
            <View style={styles.headerSide}>
              <HeaderIconButton icon="back" onPress={onBack} accessibilityLabel="Back" />
            </View>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.title}>Asset Detail</Text>
            </View>
            <View style={[styles.headerSide, styles.headerSideRight]}>
              <HeaderIconButton
                icon="refresh"
                onPress={loadAssetDetail}
                accessibilityLabel="Refresh"
              />
            </View>
          </View>
          <View style={styles.centerContent}>
            <Text style={styles.emptyTitle}>Asset not found</Text>
            <Text style={styles.emptyText}>This asset could not be loaded. Please refresh the visit and try again.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const latestInspection = asset.latestInspection;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerSide}>
            <HeaderIconButton icon="back" onPress={onBack} accessibilityLabel="Back" />
          </View>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.title}>Asset Detail</Text>
            <Text style={styles.subtitle}>{asset.assetCode || 'No asset code available'}</Text>
          </View>
          <View style={[styles.headerSide, styles.headerSideRight]}>
            <HeaderIconButton
              icon="refresh"
              onPress={loadAssetDetail}
              accessibilityLabel="Refresh"
            />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {actionError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{actionError}</Text>
          </View>
        ) : null}

        <View style={styles.actionPanel}>
          <Pressable
            onPress={handleEditAsset}
            disabled={!editableAsset}
            style={({ pressed }) => [
              styles.actionButton,
              styles.actionButtonSecondary,
              !editableAsset && styles.disabledButton,
              pressed && editableAsset && styles.pressedButton,
            ]}
          >
            <Text style={styles.actionButtonSecondaryText}>Edit</Text>
          </Pressable>

          <Pressable
            onPress={handleConfirmMarkAssetNotFound}
            disabled={asset.status === 'NOT_FOUND' || isMarkingNotFound}
            style={({ pressed }) => [
              styles.actionButton,
              styles.actionButtonGhost,
              (asset.status === 'NOT_FOUND' || isMarkingNotFound) && styles.disabledButton,
              pressed && asset.status !== 'NOT_FOUND' && !isMarkingNotFound && styles.pressedButton,
            ]}
          >
            {isMarkingNotFound ? <ActivityIndicator color={uiTheme.colors.textPrimary} /> : null}
            <Text style={styles.actionButtonGhostText}>Mark Not Found</Text>
          </Pressable>

          <Pressable
            onPress={handleStartInspection}
            disabled={!visitId || isStartingInspection}
            style={({ pressed }) => [
              styles.actionButton,
              styles.actionButtonPrimary,
              (!visitId || isStartingInspection) && styles.disabledButton,
              pressed && visitId && !isStartingInspection && styles.pressedButton,
            ]}
          >
            {isStartingInspection ? <ActivityIndicator color="#ffffff" /> : null}
            <Text style={styles.actionButtonPrimaryText}>Inspection</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Asset Information</Text>
          <InfoRow label="Asset Code" value={asset.assetCode || 'No asset code available'} />
          {asset.name ? <InfoRow label="Asset Name" value={asset.name} /> : null}
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

        {visitId ? (
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
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Inspection Images</Text>
          {images.length === 0 ? (
            <Text style={styles.placeholderText}>No inspection images yet.</Text>
          ) : (
            <ScrollView
              horizontal
              pagingEnabled={images.length > 1}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.imageCarouselContent}
            >
              {images.map((image, index) => {
                const imageUri = getImageSourceUri(image);

                return (
                  <View
                    key={`${imageUri ?? 'missing-image'}-${index}`}
                    style={[styles.imageBlock, { width: imageCarouselWidth }]}
                  >
                    <View style={styles.imageMetaRow}>
                      {image.type ? <Text style={styles.imageType}>{image.type}</Text> : <View />}
                      <Text style={styles.imageCounter}>{index + 1} of {images.length}</Text>
                    </View>
                    {imageUri ? (
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() =>
                          onOpenImagePreview({
                            uri: imageUri,
                            title: image.type || 'Inspection Image',
                          })
                        }
                      >
                        <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.imagePlaceholder}>
                        <Text style={styles.placeholderText}>Image unavailable.</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>

        </ScrollView>
      </View>
    </SafeAreaView>
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

async function loadEditableAssetList(token: string, substationId: string) {
  try {
    return await api.getAssets(token, substationId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }

    return null;
  }
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
  safeArea: {
    flex: 1,
    backgroundColor: uiTheme.colors.background,
    paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0,
  },
  screen: {
    flex: 1,
    backgroundColor: uiTheme.colors.background,
  },
  centerScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: uiTheme.colors.background,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  header: {
    minHeight: 44,
    paddingHorizontal: uiTheme.spacing.screen,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerSide: {
    width: 84,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  headerSideRight: {
    justifyContent: 'flex-end',
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: uiTheme.colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: uiTheme.colors.textSecondary,
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 140,
    gap: 16,
  },
  card: {
    backgroundColor: uiTheme.colors.card,
    borderRadius: uiTheme.radius.card,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: uiTheme.colors.textPrimary,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  infoLabel: {
    flex: 1,
    fontSize: 14,
    color: uiTheme.colors.textSecondary,
  },
  infoValue: {
    flex: 1.2,
    fontSize: 14,
    fontWeight: '500',
    color: uiTheme.colors.textPrimary,
    textAlign: 'right',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: uiTheme.colors.textSecondary,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    color: uiTheme.colors.textPrimary,
  },
  placeholderText: {
    fontSize: 14,
    lineHeight: 21,
    color: uiTheme.colors.textSecondary,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: uiTheme.colors.textPrimary,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 22,
    color: uiTheme.colors.textSecondary,
    textAlign: 'center',
  },
  loadingText: {
    fontSize: 15,
    color: uiTheme.colors.textSecondary,
  },
  errorBanner: {
    backgroundColor: uiTheme.colors.dangerSoft,
    borderRadius: uiTheme.radius.control,
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
  actionPanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    minHeight: 48,
    flexGrow: 1,
    flexBasis: 118,
    borderRadius: uiTheme.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
  },
  actionButtonPrimary: {
    backgroundColor: uiTheme.colors.primary,
  },
  actionButtonSecondary: {
    backgroundColor: uiTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  actionButtonGhost: {
    backgroundColor: uiTheme.colors.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  actionButtonPrimaryText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  actionButtonSecondaryText: {
    color: uiTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  actionButtonGhostText: {
    color: uiTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  imageBlock: {
    gap: 8,
  },
  imageCarouselContent: {
    gap: 12,
  },
  imageMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  imageType: {
    fontSize: 13,
    fontWeight: '600',
    color: uiTheme.colors.textSecondary,
  },
  imageCounter: {
    fontSize: 13,
    fontWeight: '600',
    color: uiTheme.colors.textPrimary,
  },
  image: {
    width: '100%',
    height: 220,
    borderRadius: uiTheme.radius.card,
    backgroundColor: uiTheme.colors.surfaceMuted,
  },
  imagePlaceholder: {
    height: 120,
    borderRadius: uiTheme.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  historyButton: {
    minHeight: 48,
    borderRadius: uiTheme.radius.control,
    backgroundColor: uiTheme.colors.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  historyButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: uiTheme.colors.textPrimary,
  },
  disabledButton: {
    opacity: 0.6,
  },
  pressedButton: {
    transform: [{ scale: 0.99 }],
  },
});

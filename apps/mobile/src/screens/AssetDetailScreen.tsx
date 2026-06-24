import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, ApiError, API_BASE_URL } from '../api';
import { cachedFetch, readCache, removeFromCachedArray, writeCache } from '../offlineCache';
import { dropOfflineAssetCreate, enqueueMutation, isTempId, mintTempId } from '../syncQueue';
import { buildOfflineInspectionForm } from '../offlineInspection';
import { useSession } from '../context/AuthContext';
import { useCapabilities } from '../useCapabilities';
import type { RootStackScreenProps } from '../navigation/types';
import {
  Asset,
  AssetDetailImage,
  AssetDetailResponse,
  InspectionItemResultValue,
  SiteVisit,
} from '../types';
import { formatDateTime } from '../utils';
import { HeaderIconButton, StatusChip } from '../ui';
import { Theme, useTheme } from '../theme';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

// Session cache of fetched asset details, keyed by assetId, so going back and
// re-entering a pole paints instantly from cache and refreshes in the
// background instead of showing a blocking full-screen spinner every time.
const assetDetailCache = new Map<string, AssetDetailResponse>();

function assetDetailFromSnapshot(snapshot: Asset): AssetDetailResponse {
  return {
    id: snapshot.id,
    assetCode: snapshot.assetCode,
    name: snapshot.name ?? null,
    assetType: snapshot.assetType?.name ?? '',
    assetTypeId: snapshot.assetTypeId,
    assetTypeCode: snapshot.assetType?.code,
    assetTypeName: snapshot.assetType?.name,
    status: snapshot.status,
    latitude: snapshot.latitude ?? null,
    longitude: snapshot.longitude ?? null,
    metadata: snapshot.metadata ?? null,
    location: snapshot.substation?.name ?? null,
    latestInspection: null,
  };
}

async function loadAssetDetailResponse(
  token: string,
  assetId: string,
  snapshot: Asset | null,
): Promise<AssetDetailResponse> {
  // An offline-created (temp) asset has no server detail yet — render it from the
  // snapshot captured at creation.
  if (isTempId(assetId)) {
    if (snapshot) {
      return assetDetailFromSnapshot(snapshot);
    }

    throw new ApiError('This asset has not synced to the server yet.', 0, null);
  }

  // Real assets: cache the detail so re-entry works offline; fall back to the
  // snapshot when the server is unreachable and nothing is cached.
  try {
    const { value } = await cachedFetch('asset-detail', assetId, () =>
      api.getAssetDetail(token, assetId),
    );

    return value;
  } catch (error) {
    if (error instanceof ApiError && error.status === 0 && snapshot) {
      return assetDetailFromSnapshot(snapshot);
    }

    throw error;
  }
}

export function AssetDetailScreen() {
  const navigation = useNavigation<RootStackScreenProps<'AssetDetail'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'AssetDetail'>['route']>();
  const { visitId, substationId, assetId, assetSnapshot, operationalSessionId, autoStartInspection } =
    route.params;
  const { token, user, handleUnauthorized } = useSession();
  // Starting an inspection is inspection-scope — hidden for maintenance accounts.
  const { canInspect } = useCapabilities();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [asset, setAsset] = useState<AssetDetailResponse | null>(
    () => assetDetailCache.get(assetId) ?? null,
  );
  const [editableAsset, setEditableAsset] = useState<Asset | null>(assetSnapshot ?? null);
  // Only block the whole screen on the very first load (nothing cached yet).
  const [isLoading, setIsLoading] = useState(() => !assetDetailCache.has(assetId));
  const [isStartingInspection, setIsStartingInspection] = useState(false);
  const [isMarkingNotFound, setIsMarkingNotFound] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { width: screenWidth } = useWindowDimensions();
  // Synchronous reentrancy guard — closes the double-tap window before the
  // disabled prop re-renders (which would otherwise mint two temp inspections).
  const startInspectionRef = useRef(false);

  const loadAssetDetail = useCallback(async () => {
    try {
      // Only show the blocking spinner when there's nothing cached to display.
      setIsLoading(!assetDetailCache.has(assetId));
      setLoadFailed(false);
      setActionError(null);

      // Fetch the detail and (when no snapshot) the editable list concurrently
      // instead of chaining two serial round-trips.
      const [response, assetList] = await Promise.all([
        loadAssetDetailResponse(token, assetId, assetSnapshot ?? null),
        !assetSnapshot && substationId
          ? loadEditableAssetList(token, substationId)
          : Promise.resolve(null),
      ]);
      setAsset(response);
      setEditableAsset(assetSnapshot ?? assetList?.find((item) => item.id === assetId) ?? null);

      // Warm this asset type's inspection template (same cache key as Start
      // Inspection) so it can be started offline later, even for a brand-new
      // asset type not yet seen in the visit's register.
      if (visitId && !isTempId(assetId)) {
        const warmTypeKey = assetSnapshot?.assetTypeId ?? response.assetTypeId ?? response.assetType;
        void cachedFetch(
          'inspection-template',
          `${visitId}:${operationalSessionId ?? 'none'}:${warmTypeKey}`,
          () =>
            api.resolveInspectionTemplate(token, {
              assetId,
              assetTypeId: response.assetTypeId,
              assetType: response.assetType,
              siteVisitId: visitId,
              operationalSessionId,
            }),
        ).catch(() => undefined);
      }
    } catch (error) {
      console.error('[ASSET DETAIL LOAD ERROR]', error);

      if (error instanceof ApiError && error.status === 401) {
        await handleUnauthorized(error);
        return;
      }

      // Keep any cached detail on screen through a transient failure; only fail
      // hard when there's nothing to show.
      if (!assetDetailCache.has(assetId)) {
        setAsset(null);
        setLoadFailed(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [assetId, assetSnapshot, handleUnauthorized, operationalSessionId, substationId, token, visitId]);

  useEffect(() => {
    loadAssetDetail();
  }, [loadAssetDetail]);

  // "Save & inspect" from Add Asset lands here with autoStartInspection — open
  // the inspection form automatically once the new pole has loaded (the
  // startInspectionRef guard keeps it to a single run).
  useEffect(() => {
    if (autoStartInspection && asset && canInspect && !startInspectionRef.current) {
      handleStartInspection();
    }
    // Depend on canInspect so a slow capability load doesn't drop the auto-start
    // (handleStartInspection no-ops until caps resolve; re-run when they do).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartInspection, asset, canInspect]);

  // Keep the session cache in sync with whatever detail is on screen (from a
  // load or an in-screen action) so the next re-entry paints instantly.
  useEffect(() => {
    if (asset) {
      assetDetailCache.set(assetId, asset);
    }
  }, [asset, assetId]);

  const images = useMemo(() => asset?.latestInspection?.images ?? [], [asset]);
  const imageCarouselWidth = Math.max(180, screenWidth - 72);

  async function handleStartInspection() {
    if (!canInspect || !asset || !visitId || startInspectionRef.current) {
      return;
    }

    startInspectionRef.current = true;

    try {
      setIsStartingInspection(true);
      setActionError(null);

      // Cache the resolved template per visit-scope + asset type. The server
      // resolves by asset type PLUS the visit's mainhead/branch scope, so a
      // type-only key could serve the wrong checklist; pinning to visitId (+
      // session) keeps it correct. Don't send a temp assetId to the resolver —
      // it would 404 once back online; assetTypeId + visit scope is enough.
      const assetTypeKey = editableAsset?.assetTypeId ?? asset.assetTypeId ?? asset.assetType;
      const templateCacheKey = `${visitId}:${operationalSessionId ?? 'none'}:${assetTypeKey}`;
      const { value: activeTemplate } = await cachedFetch('inspection-template', templateCacheKey, () =>
        api.resolveInspectionTemplate(token, {
          assetId: isTempId(assetId) ? undefined : assetId,
          assetTypeId: asset.assetTypeId,
          assetType: asset.assetType,
          siteVisitId: visitId,
          operationalSessionId,
        }),
      );

      if (activeTemplate.items.length === 0) {
        setActionError(
          'No active SAVR checklist template found for this MAINHEAD/Branch.',
        );
        return;
      }

      const inspectionCycle = asset.latestInspection ? asset.latestInspection.cycleNumber + 1 : 1;
      const createInput = {
        siteVisitId: visitId,
        assetId,
        operationalSessionId,
        inspectionCycle,
      };

      try {
        const inspection = await api.createInspection(token, createInput);
        navigation.navigate('InspectionForm', {
          inspectionId: inspection.id,
          visitId,
          substationId: substationId ?? '',
          operationalSessionId,
        });
      } catch (createError) {
        // Offline → mint a temp inspection, cache a synthesized form, queue the
        // create (after the asset's own create when the asset is also offline),
        // and open the form so the crew inspects now and syncs later.
        if (createError instanceof ApiError && createError.status === 0) {
          const tempInspectionId = mintTempId('inspection');
          const cachedVisit = (await readCache<SiteVisit>('site-visit', visitId))?.value ?? null;
          const syntheticForm = buildOfflineInspectionForm({
            inspectionId: tempInspectionId,
            assetId,
            detail: asset,
            snapshot: editableAsset,
            template: activeTemplate,
            visit: cachedVisit,
            inspectionCycle,
            operationalSessionId: operationalSessionId ?? null,
            user,
            nowIso: new Date().toISOString(),
          });

          await writeCache('inspection-form', tempInspectionId, syntheticForm);
          await enqueueMutation({
            type: 'CREATE_INSPECTION',
            payload: createInput as Record<string, unknown>,
            tempId: tempInspectionId,
            dependsOn: isTempId(assetId) ? [assetId] : [],
            label: `Inspection · ${asset.assetCode}`,
            sublabel: asset.assetTypeName ?? asset.assetType,
          });

          navigation.navigate('InspectionForm', {
            inspectionId: tempInspectionId,
            visitId,
            substationId: substationId ?? '',
            operationalSessionId,
          });
          return;
        }

        throw createError;
      }
    } catch (error) {
      console.error('[ASSET DETAIL START INSPECTION ERROR]', error);

      if (error instanceof ApiError && error.status === 401) {
        await handleUnauthorized(error);
        return;
      }

      setActionError(
        error instanceof ApiError && error.status === 404
          ? 'No active SAVR checklist template found for this MAINHEAD/Branch.'
          : error instanceof Error
            ? error.message
            : 'Unable to start inspection.',
      );
    } finally {
      startInspectionRef.current = false;
      setIsStartingInspection(false);
    }
  }

  function handleEditAsset() {
    if (isTempId(assetId)) {
      setActionError('This pole has not synced yet. Connect and let it sync before editing.');
      return;
    }

    if (!editableAsset) {
      setActionError('Unable to load editable asset details.');
      return;
    }

    navigation.navigate('AddAsset', {
      visitId,
      // No substationId param so the Pencawang picker stays editable — lets the
      // user move a pole to a different (nearby) Pencawang it was wrongly marked
      // to (tweak A).
      assetToEdit: editableAsset,
    });
  }

  async function handleMarkAssetNotFound() {
    if (!asset || asset.status === 'NOT_FOUND') {
      return;
    }

    if (isTempId(assetId)) {
      setActionError(
        'This pole has not synced yet. Connect and let it sync before changing its status.',
      );
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
        await handleUnauthorized(error);
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

  async function handleDeleteAsset() {
    try {
      setIsDeleting(true);
      setActionError(null);

      // An unsynced offline pole exists only locally — drop its queued create
      // (and any dependent queued inspection) and remove it from the caches
      // instead of sending a temp id to the server.
      if (isTempId(assetId)) {
        await dropOfflineAssetCreate(assetId);
        await Promise.all([
          visitId
            ? removeFromCachedArray<Asset>('site-visit-assets', visitId, assetId, (a) => a.id)
            : Promise.resolve(),
          substationId
            ? removeFromCachedArray<Asset>('assets', substationId, assetId, (a) => a.id)
            : Promise.resolve(),
        ]);
        navigation.goBack();
        return;
      }

      await api.deleteAsset(token, assetId);
      navigation.goBack();
    } catch (error) {
      console.error('[ASSET DETAIL DELETE ERROR]', error);

      if (error instanceof ApiError && error.status === 401) {
        await handleUnauthorized(error);
        return;
      }

      setActionError(error instanceof Error ? error.message : 'Unable to delete asset.');
      setIsDeleting(false);
    }
  }

  function handleConfirmDeleteAsset() {
    if (!asset) {
      return;
    }

    Alert.alert(
      'Delete this pole?',
      `${asset.assetCode || 'This pole'}${asset.name ? ` — ${asset.name}` : ''} and its inspections, photos, and links will be permanently deleted. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void handleDeleteAsset();
          },
        },
      ],
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centerScreen}>
        <ExpoStatusBar style="dark" />
        <ActivityIndicator size="large" color={theme.colors.primary} />
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
              <HeaderIconButton
                icon="back"
                onPress={() => navigation.goBack()}
                accessibilityLabel="Back"
              />
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
  // Show only answered findings — hide N/A and blank/unanswered checklist items.
  const answeredChecklistItems = (latestInspection?.items ?? []).filter(
    (item) => item.result === 'PASS' || item.result === 'FAIL',
  );
  const gpsAccuracyMeters = getMetadataNumber(asset.metadata, 'gpsAccuracyMeters');

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerSide}>
            <HeaderIconButton
              icon="back"
              onPress={() => navigation.goBack()}
              accessibilityLabel="Back"
            />
          </View>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.title}>Asset Detail</Text>
            <Text
              style={styles.subtitle}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {asset.assetCode || 'No asset code available'}
            </Text>
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
            {isMarkingNotFound ? <ActivityIndicator color={theme.colors.textPrimary} /> : null}
            <Text style={styles.actionButtonGhostText}>Mark Not Found</Text>
          </Pressable>

          {canInspect ? (
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
              {isStartingInspection ? (
                <ActivityIndicator color={theme.colors.textOnPrimary} />
              ) : null}
              <Text style={styles.actionButtonPrimaryText}>Inspection</Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={handleConfirmDeleteAsset}
            disabled={isDeleting}
            style={({ pressed }) => [
              styles.actionButton,
              styles.actionButtonDanger,
              isDeleting && styles.disabledButton,
              pressed && !isDeleting && styles.pressedButton,
            ]}
          >
            {isDeleting ? <ActivityIndicator color={theme.colors.danger} /> : null}
            <Text style={styles.actionButtonDangerText}>Delete</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Asset</Text>
          <InfoRow label="Asset Code" value={asset.assetCode || 'No asset code available'} />
          {asset.name ? <InfoRow label="Asset Name" value={asset.name} /> : null}
          <InfoRow label="Asset Type" value={asset.assetType || 'No asset type available'} />
          <View style={styles.statusLine}>
            <Text style={styles.infoLabel}>Status</Text>
            <StatusChip label={formatLabel(asset.status)} tone={getAssetStatusTone(asset.status)} />
          </View>
          <CoordinateReadout
            latitude={asset.latitude}
            longitude={asset.longitude}
            accuracyMeters={gpsAccuracyMeters}
          />
        </View>

        {typeof asset.latitude === 'number' && typeof asset.longitude === 'number' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Location</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open this asset's location in the map"
              onPress={() =>
                navigation.navigate('VisitAssetMap', {
                  visitId,
                  substationId,
                  focusAssetId: asset.id,
                  focusLatitude: asset.latitude as number,
                  focusLongitude: asset.longitude as number,
                })
              }
              style={({ pressed }) => [
                styles.miniMapWrap,
                pressed && styles.pressedButton,
              ]}
            >
              <MapView
                provider={PROVIDER_GOOGLE}
                style={styles.miniMap}
                pointerEvents="none"
                liteMode
                region={{
                  latitude: asset.latitude,
                  longitude: asset.longitude,
                  latitudeDelta: 0.004,
                  longitudeDelta: 0.004,
                }}
              >
                <Marker
                  coordinate={{
                    latitude: asset.latitude,
                    longitude: asset.longitude,
                  }}
                  title={asset.assetCode || undefined}
                />
              </MapView>
            </Pressable>
            <Text style={styles.miniMapHint}>Tap the map to open it at this asset.</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Latest Inspection</Text>
          {latestInspection ? (
            <>
              <InfoRow label="Cycle" value={`Cycle ${latestInspection.cycleNumber}`} />
              <InfoRow label="Status" value={formatLabel(latestInspection.status)} />
              <InfoRow label="Submitted" value={formatDateTime(latestInspection.submittedAt)} />
              {latestInspection.createdAt ? (
                <InfoRow label="Started" value={formatDateTime(latestInspection.createdAt)} />
              ) : null}
              <View style={styles.statusLine}>
                <Text style={styles.infoLabel}>Defects</Text>
                {latestInspection.totalDefects && latestInspection.totalDefects > 0 ? (
                  <StatusChip
                    label={`${latestInspection.totalDefects} defect${
                      latestInspection.totalDefects > 1 ? 's' : ''
                    }`}
                    tone="danger"
                  />
                ) : (
                  <StatusChip label="None" tone="success" />
                )}
              </View>

              <Text style={styles.fieldLabel}>Remarks</Text>
              <Text style={latestInspection.remarks ? styles.bodyText : styles.placeholderText}>
                {latestInspection.remarks || 'No remarks recorded.'}
              </Text>

              {answeredChecklistItems.length > 0 ? (
                <>
                  <Text style={styles.fieldLabel}>Checklist Answers</Text>
                  <View style={styles.checklistList}>
                    {answeredChecklistItems.map((item) => (
                      <View
                        key={item.id}
                        style={[styles.checklistRow, item.isDefect && styles.checklistRowDefect]}
                      >
                        <View style={styles.checklistTextWrap}>
                          <Text style={styles.checklistLabel}>{item.label}</Text>
                          {item.remark ? (
                            <Text style={styles.checklistRemark}>{item.remark}</Text>
                          ) : null}
                          {item.isDefect ? (
                            <Text style={styles.checklistDefectTag}>
                              {`Defect${item.severity ? ` · ${formatLabel(item.severity)}` : ''}`}
                            </Text>
                          ) : null}
                        </View>
                        <StatusChip
                          label={formatResult(item.result)}
                          tone={getResultTone(item.result)}
                        />
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              {latestInspection.status === 'SUBMITTED' && visitId ? (
                <Pressable
                  onPress={() =>
                    navigation.navigate('InspectionForm', {
                      inspectionId: latestInspection.id,
                      visitId,
                      substationId: substationId ?? '',
                      operationalSessionId,
                    })
                  }
                  style={({ pressed }) => [
                    styles.editInspectionButton,
                    pressed && styles.pressedButton,
                  ]}
                >
                  <Text style={styles.editInspectionButtonText}>
                    Edit Defects / Amend Inspection
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Text style={styles.placeholderText}>No submitted inspection.</Text>
          )}
        </View>

        {visitId ? (
          <Pressable
            onPress={() =>
              navigation.navigate('AssetInspectionHistory', {
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
          <Text style={styles.cardTitle}>Images</Text>
          {images.length === 0 ? (
            <Text style={styles.placeholderText}>No images.</Text>
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
                          navigation.navigate('ImagePreview', {
                            images: images.map((carouselImage) => ({
                              uri: getImageSourceUri(carouselImage) ?? '',
                              title: carouselImage.type || 'Inspection Image',
                            })),
                            index,
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function CoordinateReadout({
  latitude,
  longitude,
  accuracyMeters,
}: {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.coordinatePanel}>
      <Text style={styles.coordinateValue} numberOfLines={1}>
        {hasCoordinatePair(latitude, longitude)
          ? `Lat ${formatCoordinate(latitude)} · Lng ${formatCoordinate(longitude)}`
          : 'No GPS'}
      </Text>
      {accuracyMeters !== null ? (
        <Text style={styles.coordinateAccuracy}>GPS ±{Math.round(accuracyMeters)}m</Text>
      ) : null}
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
    return 'N/A';
  }

  return value.toFixed(6);
}

function hasCoordinatePair(latitude: number | null, longitude: number | null) {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude)
  );
}

function getMetadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const value = metadata[key];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getAssetStatusTone(status: Asset['status']) {
  if (status === 'ACTIVE') {
    return 'success' as const;
  }

  if (status === 'NOT_FOUND' || status === 'REMOVED') {
    return 'warning' as const;
  }

  return 'neutral' as const;
}

function formatResult(result: InspectionItemResultValue) {
  if (result === 'NA') {
    return 'N/A';
  }

  return result === 'PASS' ? 'Pass' : 'Fail';
}

function getResultTone(result: InspectionItemResultValue): 'success' | 'danger' | 'neutral' {
  if (result === 'PASS') {
    return 'success';
  }

  if (result === 'FAIL') {
    return 'danger';
  }

  return 'neutral';
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

const createStyles = (t: Theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: t.colors.background,
      paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0,
    },
    screen: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    centerScreen: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      backgroundColor: t.colors.background,
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
      paddingHorizontal: t.spacing.screen,
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
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: t.colors.textSecondary,
      textAlign: 'center',
    },
    // The asset code = NO TIANG RONDAAN. Field crew identify the pole by this, so
    // it's the dominant element in the header (the generic "Asset Detail" label is
    // demoted to a small eyebrow above it).
    subtitle: {
      fontSize: 48,
      lineHeight: 56,
      fontWeight: '800',
      color: t.colors.textPrimary,
      textAlign: 'center',
    },
    content: {
      paddingHorizontal: t.spacing.screen,
      paddingBottom: 128,
      gap: 12,
    },
    card: {
      backgroundColor: t.colors.card,
      borderRadius: t.radius.card,
      padding: 12,
      gap: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    cardTitle: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '600',
      color: t.colors.textPrimary,
    },
    miniMapWrap: {
      borderRadius: t.radius.card,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    miniMap: {
      width: '100%',
      height: 150,
    },
    miniMapHint: {
      fontSize: 12,
      lineHeight: 16,
      color: t.colors.textSecondary,
      textAlign: 'center',
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    infoLabel: {
      flex: 1,
      fontSize: 13,
      color: t.colors.textSecondary,
    },
    infoValue: {
      flex: 1.2,
      fontSize: 13,
      fontWeight: '500',
      color: t.colors.textPrimary,
      textAlign: 'right',
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: t.colors.textSecondary,
    },
    bodyText: {
      fontSize: 14,
      lineHeight: 20,
      color: t.colors.textPrimary,
    },
    placeholderText: {
      fontSize: 13,
      lineHeight: 19,
      color: t.colors.textSecondary,
    },
    checklistList: {
      marginTop: 6,
      gap: 8,
    },
    checklistRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
    },
    checklistRowDefect: {
      borderColor: t.colors.dangerBorder,
      backgroundColor: t.colors.dangerSoft,
    },
    checklistTextWrap: {
      flex: 1,
      gap: 2,
    },
    checklistLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: t.colors.textPrimary,
    },
    checklistRemark: {
      fontSize: 13,
      lineHeight: 18,
      color: t.colors.textSecondary,
    },
    checklistDefectTag: {
      fontSize: 12,
      fontWeight: '700',
      color: t.colors.danger,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: t.colors.textPrimary,
      textAlign: 'center',
    },
    emptyText: {
      fontSize: 15,
      lineHeight: 22,
      color: t.colors.textSecondary,
      textAlign: 'center',
    },
    loadingText: {
      fontSize: 15,
      color: t.colors.textSecondary,
    },
    errorBanner: {
      backgroundColor: t.colors.dangerSoft,
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: t.colors.dangerBorder,
      padding: 14,
    },
    errorText: {
      fontSize: 14,
      lineHeight: 20,
      color: t.colors.dangerText,
      fontWeight: '600',
    },
    actionPanel: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    actionButton: {
      minHeight: 42,
      flexGrow: 1,
      flexBasis: 118,
      borderRadius: t.radius.card,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 14,
    },
    actionButtonPrimary: {
      backgroundColor: t.colors.primary,
    },
    actionButtonSecondary: {
      backgroundColor: t.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    actionButtonGhost: {
      backgroundColor: t.colors.card,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    actionButtonPrimaryText: {
      color: t.colors.textOnPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    actionButtonSecondaryText: {
      color: t.colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    actionButtonGhostText: {
      color: t.colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    actionButtonDanger: {
      backgroundColor: t.colors.dangerSoft,
      borderWidth: 1,
      borderColor: t.colors.dangerBorder,
    },
    actionButtonDangerText: {
      color: t.colors.danger,
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
      color: t.colors.textSecondary,
    },
    imageCounter: {
      fontSize: 13,
      fontWeight: '600',
      color: t.colors.textPrimary,
    },
    image: {
      width: '100%',
      height: 190,
      borderRadius: t.radius.card,
      backgroundColor: t.colors.surfaceMuted,
    },
    imagePlaceholder: {
      height: 120,
      borderRadius: t.radius.card,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    historyButton: {
      minHeight: 44,
      borderRadius: t.radius.card,
      backgroundColor: t.colors.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    historyButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: t.colors.textPrimary,
    },
    editInspectionButton: {
      minHeight: 44,
      borderRadius: t.radius.card,
      backgroundColor: t.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
      marginTop: 16,
    },
    editInspectionButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: t.colors.textOnPrimary,
    },
    disabledButton: {
      opacity: 0.6,
    },
    pressedButton: {
      transform: [{ scale: 0.99 }],
    },
    statusLine: {
      minHeight: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    coordinatePanel: {
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 2,
    },
    coordinateValue: {
      color: t.colors.textPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    coordinateAccuracy: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
    },
  });

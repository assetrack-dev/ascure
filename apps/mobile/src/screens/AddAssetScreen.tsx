import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import {
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  StatusBar as NativeStatusBar,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { cachedFetch, prependToCachedArray } from '../offlineCache';
import { enqueueMutation, isTempId, mintTempId } from '../syncQueue';
import { assetMarkerColor } from '../assetDisplay';
import { MapCrosshair } from '../components/MapCrosshair';
import { getPositionWithTimeout } from '../location';
import { useSession } from '../context/AuthContext';
import { useCapabilities } from '../useCapabilities';
import type { RootStackScreenProps } from '../navigation/types';
import {
  AppButton,
  Card,
  EmptyState,
  ErrorBanner,
  InlineButton,
  LoadingBlock,
  Screen,
  SectionTitle,
  SelectCard,
  StatusChip,
  TextField,
} from '../ui';
import { Theme, useTheme } from '../theme';
import { Asset, AssetStatus, AssetType, Substation } from '../types';
import { normalizeOperationalPayloadText, normalizeOperationalText } from '../utils';
import { suggestNextPoleCode } from '../utils/feederSequence';
import { loadLastPoleCode, storeLastPoleCode } from '../storage';

type Coordinate = {
  latitude: number;
  longitude: number;
};

type CoordinateSource = 'current_gps' | 'map_picker' | 'manual';

type MapPickerState = {
  coordinate: Coordinate;
  accuracyMeters: number | null;
};

type SavrOperationalStatus = 'EXISTING' | 'NEW' | 'NOT_FOUND' | 'DEMOLISHED';

type SavrOperationalStatusOption = {
  label: string;
  value: SavrOperationalStatus;
  description: string;
};

const SAVR_OPERATIONAL_STATUS_OPTIONS: SavrOperationalStatusOption[] = [
  {
    label: 'Existing',
    value: 'EXISTING',
    description: 'Asset is present and already part of the route.',
  },
  {
    label: 'New',
    value: 'NEW',
    description: 'Newly found or installed asset for this visit.',
  },
  {
    label: 'Not Found',
    value: 'NOT_FOUND',
    description: 'Asset expected in the route but not found on site.',
  },
  {
    label: 'Demolished',
    value: 'DEMOLISHED',
    description: 'Asset has been removed or demolished in the field.',
  },
];

const DEFAULT_MAP_PICKER_COORDINATE: Coordinate = {
  latitude: 3.139,
  longitude: 101.6869,
};

const MAP_PICKER_DELTA = 0.004;

export function AddAssetScreen() {
  const navigation = useNavigation<RootStackScreenProps<'AddAsset'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'AddAsset'>['route']>();
  const {
    visitId: siteVisitId,
    substationId,
    assetToEdit,
    initialLatitude,
    initialLongitude,
  } = route.params;
  const { token, handleUnauthorized } = useSession();
  // Adding/editing an asset is an inspection-scope action — block maintenance
  // accounts (defense in depth; the Map add-asset entry is already hidden).
  const { canInspect, loading: capabilitiesLoading } = useCapabilities();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  function goToSavedAsset(asset: Asset) {
    navigation.replace('AssetDetail', {
      visitId: siteVisitId,
      substationId: asset.substationId || substationId,
      assetId: asset.id,
      assetSnapshot: asset,
    });
  }

  // Where to go after saving a NEW pole — the field fork (ADR 0003):
  //  - inspect : chain straight into the inspection form (Workflow 1)
  //  - another : back to the map to tag the next pole; it refreshes on focus
  //              and shows the new pole as a red (not-yet-inspected) pin (Workflow 2)
  //  - detail  : the asset detail (edit mode / default)
  type SaveIntent = 'inspect' | 'another' | 'detail';

  function proceedAfterSave(asset: Asset, intent: SaveIntent) {
    if (intent === 'inspect') {
      navigation.replace('AssetDetail', {
        visitId: siteVisitId,
        substationId: asset.substationId || substationId,
        assetId: asset.id,
        assetSnapshot: asset,
        autoStartInspection: true,
      });
      return;
    }

    if (intent === 'another') {
      navigation.goBack();
      return;
    }

    goToSavedAsset(asset);
  }

  const isEditMode = Boolean(assetToEdit);
  const initialMapLatitude =
    typeof initialLatitude === 'number' && Number.isFinite(initialLatitude) ? initialLatitude : null;
  const initialMapLongitude =
    typeof initialLongitude === 'number' && Number.isFinite(initialLongitude) ? initialLongitude : null;
  const hasInitialMapLocation =
    !isEditMode && initialMapLatitude !== null && initialMapLongitude !== null;
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
  const [substations, setSubstations] = useState<Substation[]>([]);
  const [selectedSubstationId, setSelectedSubstationId] = useState('');
  const [selectedAssetTypeId, setSelectedAssetTypeId] = useState('');
  const [assetCode, setAssetCode] = useState('');
  const [assetName, setAssetName] = useState('');
  const [operationalStatus, setOperationalStatus] = useState<SavrOperationalStatus>('EXISTING');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number | null>(null);
  const [coordinateSource, setCoordinateSource] = useState<CoordinateSource | null>(null);
  const [coordinateCapturedAt, setCoordinateCapturedAt] = useState<string | null>(null);
  const [mapPickerState, setMapPickerState] = useState<MapPickerState | null>(null);
  const [mapPickerAssets, setMapPickerAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isOpeningMapPicker, setIsOpeningMapPicker] = useState(false);
  const [isSubstationMenuOpen, setIsSubstationMenuOpen] = useState(false);
  const [isAssetTypeMenuOpen, setIsAssetTypeMenuOpen] = useState(false);
  const [isOperationalStatusMenuOpen, setIsOperationalStatusMenuOpen] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestedCode, setSuggestedCode] = useState<string | null>(null);

  const selectedSubstation = useMemo(
    () => substations.find((substation) => substation.id === selectedSubstationId) ?? null,
    [selectedSubstationId, substations],
  );

  const selectedAssetType = useMemo(
    () => assetTypes.find((assetType) => assetType.id === selectedAssetTypeId) ?? null,
    [assetTypes, selectedAssetTypeId],
  );

  const isSAVRWorkflow = useMemo(
    () => isSavrAssetType(selectedAssetType),
    [selectedAssetType],
  );

  const assetCodeLabel = isSAVRWorkflow ? 'NO TIANG RONDAAN' : 'Asset Code';
  const assetNameLabel = isSAVRWorkflow ? 'NO TIANG LAMA' : 'Asset Name (Optional)';
  const selectedOperationalStatusOption = useMemo(
    () =>
      SAVR_OPERATIONAL_STATUS_OPTIONS.find((option) => option.value === operationalStatus) ??
      SAVR_OPERATIONAL_STATUS_OPTIONS[0],
    [operationalStatus],
  );

  // Suggest the next NO TIANG RONDAAN from the last code entered in this
  // Pencawang (tappable chip; the field stays empty). New SAVR poles only —
  // skips edit mode and non-SAVR asset types.
  useEffect(() => {
    const target = substationId ?? selectedSubstationId;

    if (assetToEdit || !isSAVRWorkflow || !target) {
      setSuggestedCode(null);
      return;
    }

    let cancelled = false;

    loadLastPoleCode(target)
      .then((last) => {
        if (!cancelled) {
          setSuggestedCode(last ? suggestNextPoleCode(last) : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestedCode(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [assetToEdit, isSAVRWorkflow, substationId, selectedSubstationId]);

  useEffect(() => {
    setSelectedSubstationId(assetToEdit?.substationId ?? substationId ?? '');
    setSelectedAssetTypeId(assetToEdit?.assetTypeId ?? '');
    setAssetCode(assetToEdit?.assetCode ? normalizeOperationalText(assetToEdit.assetCode) : '');
    setAssetName(assetToEdit?.name ? normalizeOperationalText(assetToEdit.name) : '');
    setOperationalStatus(getInitialOperationalStatus(assetToEdit));
    setLatitude(
      assetToEdit?.latitude !== null && assetToEdit?.latitude !== undefined
        ? formatCoordinate(assetToEdit.latitude)
        : hasInitialMapLocation
          ? formatCoordinate(initialMapLatitude)
        : '',
    );
    setLongitude(
      assetToEdit?.longitude !== null && assetToEdit?.longitude !== undefined
        ? formatCoordinate(assetToEdit.longitude)
        : hasInitialMapLocation
          ? formatCoordinate(initialMapLongitude)
        : '',
    );
    setGpsAccuracyMeters(getMetadataNumber(assetToEdit?.metadata, 'gpsAccuracyMeters'));
    setCoordinateSource(
      assetToEdit
        ? getMetadataCoordinateSource(assetToEdit.metadata)
        : hasInitialMapLocation
          ? 'map_picker'
          : null,
    );
    setCoordinateCapturedAt(getMetadataString(assetToEdit?.metadata, 'coordinateCapturedAt'));
    setMapPickerState(null);
    setIsSubstationMenuOpen(false);
    setIsAssetTypeMenuOpen(false);
    setIsOperationalStatusMenuOpen(false);
    setError(null);
  }, [
    assetToEdit,
    hasInitialMapLocation,
    initialMapLatitude,
    initialMapLongitude,
    substationId,
  ]);

  const prefillCurrentLocation = useCallback(async () => {
    try {
      const permission = await Location.getForegroundPermissionsAsync();

      setHasLocationPermission(permission.granted);

      if (!permission.granted) {
        return;
      }

      const position = await getPositionWithTimeout({
        accuracy: Location.Accuracy.Balanced,
      });

      if (position) {
        applyGpsPosition(position, 'current_gps');
      }
    } catch {
      // Ignore passive GPS lookup failures so the form still loads cleanly.
    }
  }, []);

  const loadOptions = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      // Cache the reference data so the Add Asset form still renders offline
      // (these gate the Save button, so without them the form is unusable).
      const [assetTypeList, substationList] = await Promise.all([
        cachedFetch('asset-types', undefined, () => api.getAssetTypes(token)).then((r) => r.value),
        substationId
          ? Promise.resolve<Substation[]>([])
          : cachedFetch('substations', undefined, () => api.getSubstations(token)).then((r) => r.value),
      ]);

      setAssetTypes(assetTypeList);
      setSubstations(substationList);

      if (assetTypeList.length > 0) {
        setSelectedAssetTypeId((currentValue) =>
          assetTypeList.some((assetType) => assetType.id === currentValue)
            ? currentValue
            : assetTypeList[0].id,
        );
      }

      if (!substationId && substationList.length > 0) {
        setSelectedSubstationId((currentValue) =>
          substationList.some((substation) => substation.id === currentValue)
            ? currentValue
            : substationList[0].id,
        );
      }

      if (!isEditMode && !hasInitialMapLocation) {
        await prefillCurrentLocation();
      }
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await handleUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load asset options.');
    } finally {
      setIsLoading(false);
    }
  }, [
    hasInitialMapLocation,
    isEditMode,
    handleUnauthorized,
    prefillCurrentLocation,
    substationId,
    token,
  ]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  async function handleUseCurrentLocation() {
    try {
      setError(null);
      setIsLocating(true);

      const permission = await Location.requestForegroundPermissionsAsync();
      setHasLocationPermission(permission.granted);

      if (!permission.granted) {
        setError('Location permission was not granted. You can still enter coordinates manually.');
        return;
      }

      const position = await getPositionWithTimeout({
        accuracy: Location.Accuracy.Balanced,
      });

      if (!position) {
        setError('Could not get a GPS fix. Move to open sky or enter the coordinates manually.');
        return;
      }

      applyGpsPosition(position, 'current_gps');
    } catch (locationError) {
      setError(locationError instanceof Error ? locationError.message : 'Unable to read the current GPS location.');
    } finally {
      setIsLocating(false);
    }
  }

  async function handleOpenMapPicker() {
    try {
      setError(null);
      setIsOpeningMapPicker(true);

      const targetSubstationId = substationId ?? selectedSubstationId;
      const [currentLocation, neighbours] = await Promise.all([
        getCurrentLocationForMapPicker(),
        // Show existing poles in this Pencawang so the surveyor can place the
        // new pole relative to its neighbours (best-effort — never block the
        // picker if it fails).
        targetSubstationId
          ? api.getAssets(token, targetSubstationId).catch(() => [] as Asset[])
          : Promise.resolve<Asset[]>([]),
      ]);
      const formCoordinate = parseFormCoordinate(latitude, longitude);
      const coordinate = currentLocation?.coordinate ?? formCoordinate ?? DEFAULT_MAP_PICKER_COORDINATE;

      setMapPickerAssets(neighbours.filter((asset) => asset.id !== assetToEdit?.id));
      setMapPickerState({
        coordinate,
        accuracyMeters: currentLocation?.accuracyMeters ?? null,
      });
    } catch (mapError) {
      setError(mapError instanceof Error ? mapError.message : 'Unable to open the map picker.');
    } finally {
      setIsOpeningMapPicker(false);
    }
  }

  function handleConfirmMapCoordinate(params: {
    coordinate: Coordinate;
    accuracyMeters: number | null;
  }) {
    setLatitude(formatCoordinate(params.coordinate.latitude));
    setLongitude(formatCoordinate(params.coordinate.longitude));
    setGpsAccuracyMeters(params.accuracyMeters);
    setCoordinateSource('map_picker');
    setCoordinateCapturedAt(new Date().toISOString());
    setMapPickerState(null);
  }

  async function getCurrentLocationForMapPicker() {
    const permission = await Location.requestForegroundPermissionsAsync();

    setHasLocationPermission(permission.granted);

    if (!permission.granted) {
      return null;
    }

    const position = await getPositionWithTimeout({
      accuracy: Location.Accuracy.High,
    });

    if (!position) {
      return null;
    }

    return {
      coordinate: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
      accuracyMeters:
        typeof position.coords.accuracy === 'number' && Number.isFinite(position.coords.accuracy)
          ? position.coords.accuracy
          : null,
    };
  }

  function applyGpsPosition(position: Location.LocationObject, source: CoordinateSource) {
    setLatitude(formatCoordinate(position.coords.latitude));
    setLongitude(formatCoordinate(position.coords.longitude));
    setGpsAccuracyMeters(
      typeof position.coords.accuracy === 'number' && Number.isFinite(position.coords.accuracy)
        ? position.coords.accuracy
        : null,
    );
    setCoordinateSource(source);
    setCoordinateCapturedAt(new Date(position.timestamp).toISOString());
  }

  function handleManualLatitude(nextValue: string) {
    setLatitude(nextValue);
    setGpsAccuracyMeters(null);
    setCoordinateSource('manual');
    setCoordinateCapturedAt(null);
  }

  function handleManualLongitude(nextValue: string) {
    setLongitude(nextValue);
    setGpsAccuracyMeters(null);
    setCoordinateSource('manual');
    setCoordinateCapturedAt(null);
  }

  async function handleSubmit(intent: SaveIntent = 'detail') {
    // Defense in depth: never create/update during the capability-loading window
    // or for a non-inspection account (the screen guard hides the form, but this
    // closes the brief render race before caps resolve).
    if (capabilitiesLoading || !canInspect) {
      return;
    }

    const normalizedAssetCode = normalizeOperationalPayloadText(assetCode);
    const normalizedAssetName = normalizeOperationalPayloadText(assetName);

    if (!selectedAssetTypeId) {
      setError('Please select an asset type.');
      return;
    }

    const targetSubstationId = substationId ?? selectedSubstationId;

    if (!targetSubstationId) {
      setError('Please select a pencawang.');
      return;
    }

    if (!normalizedAssetCode) {
      setError(`Please enter ${assetCodeLabel}.`);
      return;
    }

    const parsedLatitude = parseCoordinate(latitude, -90, 90);

    if (parsedLatitude === 'invalid') {
      setError('Latitude must be a valid number between -90 and 90.');
      return;
    }

    const parsedLongitude = parseCoordinate(longitude, -180, 180);

    if (parsedLongitude === 'invalid') {
      setError('Longitude must be a valid number between -180 and 180.');
      return;
    }

    const latitudeValue =
      parsedLatitude === undefined
        ? isEditMode
          ? null
          : undefined
        : parsedLatitude;
    const longitudeValue =
      parsedLongitude === undefined
        ? isEditMode
          ? null
          : undefined
        : parsedLongitude;
    const assetMetadata = buildAssetMetadata({
      existingMetadata: assetToEdit?.metadata,
      coordinateSource,
      coordinateCapturedAt,
      gpsAccuracyMeters,
      operationalStatus: isSAVRWorkflow ? operationalStatus : null,
    });
    const targetAssetStatus = isSAVRWorkflow
      ? getAssetStatusForOperationalStatus(operationalStatus)
      : undefined;

    try {
      setError(null);
      setIsSubmitting(true);

      if (assetToEdit) {
        if (isTempId(assetToEdit.id)) {
          setError('This pole has not synced yet. Connect and let it sync before editing.');
          return;
        }

        let savedAsset = await api.updateAsset(token, assetToEdit.id, {
          assetTypeId: selectedAssetTypeId,
          // Allow moving the pole to a different Pencawang (tweak A).
          substationId: selectedSubstationId || undefined,
          assetCode: normalizedAssetCode,
          name: normalizedAssetName ?? '',
          latitude: latitudeValue,
          longitude: longitudeValue,
          metadata: assetMetadata,
        });

        if (targetAssetStatus && targetAssetStatus !== savedAsset.status) {
          savedAsset = await api.updateAssetStatus(token, assetToEdit.id, {
            status: targetAssetStatus,
          });
        }

        goToSavedAsset(savedAsset);
        return;
      }

      const createInput = {
        substationId: targetSubstationId,
        assetTypeId: selectedAssetTypeId,
        assetCode: normalizedAssetCode,
        name: normalizedAssetName,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        metadata: assetMetadata,
        status: targetAssetStatus,
        createdDuringVisitId: siteVisitId,
      };

      try {
        const savedAsset = await api.createAsset(token, createInput);
        await storeLastPoleCode(targetSubstationId, normalizedAssetCode);
        proceedAfterSave(savedAsset, intent);
      } catch (createError) {
        // Offline (server unreachable) → queue the create and optimistically open
        // the new pole so field work continues; it reconciles to a real id on
        // sync. Needs the resolved asset type (cached) to render the asset.
        if (createError instanceof ApiError && createError.status === 0 && selectedAssetType) {
          const tempId = mintTempId('asset');

          await enqueueMutation({
            type: 'CREATE_ASSET',
            payload: createInput as Record<string, unknown>,
            tempId,
            label: normalizedAssetCode,
            sublabel: selectedSubstation
              ? `${selectedSubstation.code} - ${selectedSubstation.name}`
              : undefined,
          });

          const optimisticAsset: Asset = {
            id: tempId,
            substationId: targetSubstationId,
            assetTypeId: selectedAssetTypeId,
            assetCode: normalizedAssetCode,
            name: normalizedAssetName ?? null,
            latitude: parsedLatitude ?? null,
            longitude: parsedLongitude ?? null,
            metadata: assetMetadata ?? null,
            status: targetAssetStatus ?? 'ACTIVE',
            createdDuringVisitId: siteVisitId ?? null,
            assetType: selectedAssetType,
            substation: selectedSubstation
              ? {
                  id: selectedSubstation.id,
                  code: selectedSubstation.code,
                  name: selectedSubstation.name,
                }
              : undefined,
            latestInspection: null,
          };

          // Surface the new pole in the cached registers (visit asset list + map).
          await Promise.all([
            siteVisitId
              ? prependToCachedArray('site-visit-assets', siteVisitId, optimisticAsset, (a) => a.id)
              : Promise.resolve(),
            prependToCachedArray('assets', targetSubstationId, optimisticAsset, (a) => a.id),
          ]);

          await storeLastPoleCode(targetSubstationId, normalizedAssetCode);
          proceedAfterSave(optimisticAsset, intent);
          return;
        }

        throw createError;
      }
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        await handleUnauthorized(submitError);
        return;
      }

      setError(
        submitError instanceof Error
          ? submitError.message
          : isEditMode
            ? 'Unable to update asset.'
            : 'Unable to add asset.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (mapPickerState) {
    return (
      <MapCoordinatePicker
        initialCoordinate={mapPickerState.coordinate}
        accuracyMeters={mapPickerState.accuracyMeters}
        assets={mapPickerAssets}
        onCancel={() => setMapPickerState(null)}
        onConfirm={handleConfirmMapCoordinate}
      />
    );
  }

  const isSaveDisabled =
    capabilitiesLoading ||
    isLoading ||
    isSubmitting ||
    assetTypes.length === 0 ||
    (!substationId && substations.length === 0);

  if (!capabilitiesLoading && !canInspect) {
    return (
      <Screen
        title={isEditMode ? 'Edit Asset' : 'Add Asset'}
        actions={<InlineButton label="Back" onPress={() => navigation.goBack()} />}
      >
        <Card>
          <EmptyState
            title="Inspection access required"
            description="Adding or editing an asset is an inspection task, and your account doesn't have inspection access."
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      title={isEditMode ? 'Edit Asset' : 'Add Asset'}
      actions={
        <>
          <InlineButton
            label="Back"
            onPress={() => navigation.goBack()}
            disabled={isSubmitting}
          />
          <InlineButton label="Refresh" onPress={loadOptions} disabled={isSubmitting || isLocating} />
        </>
      }
      keyboardAware
      footer={
        isEditMode ? (
          <AppButton
            label={isSubmitting ? 'Updating Asset...' : 'Update Asset'}
            onPress={() => handleSubmit('detail')}
            loading={isSubmitting}
            disabled={isSaveDisabled}
          />
        ) : (
          <View style={{ gap: 10 }}>
            <AppButton
              label={isSubmitting ? 'Saving...' : 'Save & inspect'}
              onPress={() => handleSubmit('inspect')}
              loading={isSubmitting}
              disabled={isSaveDisabled}
            />
            <AppButton
              label="Save & add another"
              onPress={() => handleSubmit('another')}
              variant="secondary"
              disabled={isSaveDisabled}
            />
          </View>
        )
      }
    >
      <ErrorBanner message={error} />
      {isLoading ? (
        <LoadingBlock label={isEditMode ? 'Loading asset types...' : 'Loading asset types and GPS...'} />
      ) : null}

      {!isLoading ? (
        <>
          {!substationId ? (
            <Card>
              <SectionTitle>Pencawang</SectionTitle>
              {substations.length === 0 ? (
                <EmptyState
                  title="No pencawang available"
                  description="The backend did not return any active substations for this tenant."
                />
              ) : (
                <>
                  <Pressable
                    onPress={() => setIsSubstationMenuOpen((currentValue) => !currentValue)}
                    style={({ pressed }) => [
                      styles.dropdownField,
                      isSubstationMenuOpen && styles.dropdownFieldOpen,
                      pressed && styles.dropdownFieldPressed,
                    ]}
                  >
                    <View style={styles.dropdownLabelWrap}>
                      <Text style={styles.dropdownLabel}>Selected Pencawang</Text>
                      <Text style={styles.dropdownValue}>
                        {selectedSubstation
                          ? `${selectedSubstation.code} - ${selectedSubstation.name}`
                          : 'Choose a pencawang'}
                      </Text>
                    </View>
                    <Text style={styles.dropdownCaret}>{isSubstationMenuOpen ? 'Hide' : 'Choose'}</Text>
                  </Pressable>

                  {isSubstationMenuOpen ? (
                    <View style={styles.dropdownOptions}>
                      {substations.map((substation) => (
                        <SelectCard
                          key={substation.id}
                          label={`${substation.code} - ${substation.name}`}
                          description={substation.location}
                          selected={selectedSubstationId === substation.id}
                          onPress={() => {
                            setSelectedSubstationId(substation.id);
                            setIsSubstationMenuOpen(false);
                          }}
                        />
                      ))}
                    </View>
                  ) : null}
                </>
              )}
            </Card>
          ) : null}

          <Card>
            <SectionTitle>Asset Type</SectionTitle>
            {assetTypes.length === 0 ? (
              <EmptyState
                title="No asset types available"
                description="The backend did not return any active asset types for this tenant."
              />
            ) : (
              <>
                <Pressable
                  onPress={() => setIsAssetTypeMenuOpen((currentValue) => !currentValue)}
                  style={({ pressed }) => [
                    styles.dropdownField,
                    isAssetTypeMenuOpen && styles.dropdownFieldOpen,
                    pressed && styles.dropdownFieldPressed,
                  ]}
                >
                  <View style={styles.dropdownLabelWrap}>
                    <Text style={styles.dropdownLabel}>Selected Asset Type</Text>
                    <Text style={styles.dropdownValue}>
                      {selectedAssetType
                        ? `${selectedAssetType.code} - ${selectedAssetType.name}`
                        : 'Choose an asset type'}
                    </Text>
                  </View>
                  <Text style={styles.dropdownCaret}>{isAssetTypeMenuOpen ? 'Hide' : 'Choose'}</Text>
                </Pressable>

                {isAssetTypeMenuOpen ? (
                  <View style={styles.dropdownOptions}>
                    {assetTypes.map((assetType) => (
                      <SelectCard
                        key={assetType.id}
                        label={`${assetType.code} - ${assetType.name}`}
                        selected={selectedAssetTypeId === assetType.id}
                        onPress={() => {
                          setSelectedAssetTypeId(assetType.id);
                          setIsAssetTypeMenuOpen(false);
                        }}
                      />
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </Card>

          <Card>
            <SectionTitle>Asset Details</SectionTitle>
            <TextField
              label={assetCodeLabel}
              value={assetCode}
              onChangeText={(nextValue) => setAssetCode(normalizeOperationalText(nextValue))}
              placeholder={
                isSAVRWorkflow ? 'Masukkan No Tiang Rondaan' : 'Enter the field asset code'
              }
              autoCapitalize="characters"
            />
            {suggestedCode && !assetCode ? (
              <Pressable
                onPress={() => setAssetCode(suggestedCode)}
                accessibilityRole="button"
                accessibilityLabel={`Use suggested NO TIANG RONDAAN ${suggestedCode}`}
                style={({ pressed }) => [
                  styles.suggestionChip,
                  pressed && styles.suggestionChipPressed,
                ]}
              >
                <Text style={styles.suggestionChipText} numberOfLines={1}>
                  Next: {suggestedCode}
                </Text>
                <Text style={styles.suggestionChipHint}>Tap to use</Text>
              </Pressable>
            ) : null}
            <TextField
              label={assetNameLabel}
              value={assetName}
              onChangeText={(nextValue) => setAssetName(normalizeOperationalText(nextValue))}
              placeholder={isSAVRWorkflow ? 'Masukkan No Tiang Lama jika ada' : 'Enter a readable asset name'}
              autoCapitalize="characters"
            />
          </Card>

          {isSAVRWorkflow ? (
            <Card>
              <SectionTitle>Operational Status</SectionTitle>
              <Pressable
                onPress={() => setIsOperationalStatusMenuOpen((currentValue) => !currentValue)}
                style={({ pressed }) => [
                  styles.dropdownField,
                  isOperationalStatusMenuOpen && styles.dropdownFieldOpen,
                  pressed && styles.dropdownFieldPressed,
                ]}
              >
                <View style={styles.dropdownLabelWrap}>
                  <Text style={styles.dropdownLabel}>Selected</Text>
                  <StatusChip
                    label={selectedOperationalStatusOption.label}
                    tone={getOperationalStatusTone(operationalStatus)}
                  />
                </View>
                <Text style={styles.dropdownCaret}>{isOperationalStatusMenuOpen ? 'Hide' : 'Change'}</Text>
              </Pressable>
              {isOperationalStatusMenuOpen ? (
                <View style={styles.statusOptionGrid}>
                  {SAVR_OPERATIONAL_STATUS_OPTIONS.map((option) => (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: operationalStatus === option.value }}
                      onPress={() => {
                        setOperationalStatus(option.value);
                        setIsOperationalStatusMenuOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.statusOptionButton,
                        operationalStatus === option.value && styles.statusOptionButtonSelected,
                        pressed && styles.dropdownFieldPressed,
                      ]}
                    >
                      <StatusChip
                        label={option.label}
                        tone={getOperationalStatusTone(option.value)}
                      />
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </Card>
          ) : null}

          <Card>
            <SectionTitle>GPS</SectionTitle>
            <View style={styles.coordinateSummaryRow}>
              <Text style={styles.coordinateSummaryText} numberOfLines={1}>
                {formatCoordinateSummary(latitude, longitude)}
              </Text>
              <Text style={styles.coordinateAccuracyText}>{formatGpsAccuracy(gpsAccuracyMeters)}</Text>
            </View>
            {hasInitialMapLocation ? <Text style={styles.coordinateSourceText}>Map selected</Text> : null}
            <View style={styles.coordinateInputRow}>
              <View style={styles.coordinateInputCell}>
                <TextField
                  label="Lat"
                  value={latitude}
                  onChangeText={handleManualLatitude}
                  placeholder="2.925900"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={styles.coordinateInputCell}>
                <TextField
                  label="Lng"
                  value={longitude}
                  onChangeText={handleManualLongitude}
                  placeholder="101.690000"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>
            <View style={styles.coordinateActionRow}>
              <View style={styles.coordinateActionCell}>
                <AppButton
                  label={isLocating ? 'Reading GPS...' : 'Use GPS'}
                  onPress={handleUseCurrentLocation}
                  variant="secondary"
                  loading={isLocating}
                  disabled={isSubmitting}
                />
              </View>
              <View style={styles.coordinateActionCell}>
                <AppButton
                  label={isOpeningMapPicker ? 'Opening...' : 'Map'}
                  onPress={handleOpenMapPicker}
                  variant="secondary"
                  loading={isOpeningMapPicker}
                  disabled={isSubmitting}
                />
              </View>
            </View>
            {hasLocationPermission === false ? (
              <Text style={styles.coordinateSourceText}>Location permission off. Manual entry works.</Text>
            ) : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function MapCoordinatePicker({
  initialCoordinate,
  accuracyMeters,
  assets,
  onCancel,
  onConfirm,
}: {
  initialCoordinate: Coordinate;
  accuracyMeters: number | null;
  assets: Asset[];
  onCancel: () => void;
  onConfirm: (params: { coordinate: Coordinate; accuracyMeters: number | null }) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // Uncontrolled region: only seed initialRegion and TRACK the centre via
  // onRegionChangeComplete. Previously this also passed region={region} AND
  // re-set it on every tap/drag, which fought the native gesture and made the
  // map slow/janky and taps feel inert.
  const [region, setRegion] = useState<Region>(() => createMapPickerRegion(initialCoordinate));

  const neighbourMarkers = useMemo(
    () =>
      assets.flatMap((asset) => {
        const lat = asset.latitude;
        const lng = asset.longitude;
        if (typeof lat !== 'number' || typeof lng !== 'number') {
          return [];
        }
        return [
          <Marker
            key={`pole-${asset.id}`}
            coordinate={{ latitude: lat, longitude: lng }}
            title={asset.assetCode}
            description={asset.name ?? asset.assetType?.name}
            pinColor={assetMarkerColor(asset)}
          />,
        ];
      }),
    [assets],
  );

  return (
    <SafeAreaView style={styles.mapPickerSafeArea}>
      <View style={styles.mapPickerScreen}>
        <View style={styles.mapPickerHeader}>
          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            style={({ pressed }) => [styles.mapPickerHeaderButton, pressed && styles.pressedButton]}
          >
            <Text style={styles.mapPickerHeaderButtonText}>Back</Text>
          </Pressable>
          <View style={styles.mapPickerHeaderTitleWrap}>
            <Text style={styles.mapPickerTitle}>Select Coordinates</Text>
            <Text style={styles.mapPickerSubtitle}>Pan so the crosshair marks the spot</Text>
          </View>
          <View style={styles.mapPickerHeaderSide} />
        </View>

        <View style={styles.mapPickerMapShell}>
          <MapView
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFillObject}
            initialRegion={region}
            mapType="satellite"
            showsUserLocation
            showsMyLocationButton
            onRegionChangeComplete={setRegion}
          >
            {neighbourMarkers}
          </MapView>
          {/* Fixed centre crosshair: the chosen location is the map centre, so
              the target isn't hidden under the finger. */}
          <MapCrosshair />
        </View>

        <View style={styles.mapPickerFooter}>
          <View style={styles.mapPickerCoordinatePanel}>
            <Text style={styles.mapPickerCoordinateLabel}>Centre location</Text>
            <Text style={styles.mapPickerCoordinateValue}>
              Lat {region.latitude.toFixed(6)} · Lng {region.longitude.toFixed(6)}
            </Text>
            <Text style={styles.mapPickerAccuracyText}>
              {formatGpsAccuracy(accuracyMeters)}
            </Text>
          </View>
          <AppButton
            label="Confirm Coordinates"
            onPress={() =>
              onConfirm({
                coordinate: { latitude: region.latitude, longitude: region.longitude },
                accuracyMeters,
              })
            }
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function formatCoordinate(value: number) {
  return value.toFixed(6);
}

function formatCoordinateSummary(latitude: string, longitude: string) {
  const latitudeLabel = latitude.trim() || 'N/A';
  const longitudeLabel = longitude.trim() || 'N/A';

  return `Lat ${latitudeLabel} · Lng ${longitudeLabel}`;
}

function formatGpsAccuracy(value: number | null) {
  return value === null ? 'GPS --' : `GPS ±${Math.round(value)}m`;
}

function parseCoordinate(
  rawValue: string,
  minimum: number,
  maximum: number,
) {
  const normalizedValue = rawValue.trim();

  if (!normalizedValue) {
    return undefined;
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue) || parsedValue < minimum || parsedValue > maximum) {
    return 'invalid' as const;
  }

  return parsedValue;
}

function parseFormCoordinate(latitude: string, longitude: string): Coordinate | null {
  const parsedLatitude = parseCoordinate(latitude, -90, 90);
  const parsedLongitude = parseCoordinate(longitude, -180, 180);

  if (
    typeof parsedLatitude === 'number' &&
    typeof parsedLongitude === 'number'
  ) {
    return {
      latitude: parsedLatitude,
      longitude: parsedLongitude,
    };
  }

  return null;
}

function createMapPickerRegion(coordinate: Coordinate): Region {
  return {
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    latitudeDelta: MAP_PICKER_DELTA,
    longitudeDelta: MAP_PICKER_DELTA,
  };
}

function isSavrAssetType(assetType: AssetType | null) {
  if (!assetType) {
    return false;
  }

  return [assetType.code, assetType.name].some((value) =>
    typeof value === 'string' && value.trim().toUpperCase().includes('SAVR'),
  );
}

function getInitialOperationalStatus(asset?: Asset): SavrOperationalStatus {
  const metadataStatus = normalizeOperationalStatus(
    getMetadataString(asset?.metadata, 'operationalStatus'),
  );

  if (metadataStatus) {
    return metadataStatus;
  }

  if (asset?.status === 'NOT_FOUND') {
    return 'NOT_FOUND';
  }

  if (asset?.status === 'REMOVED') {
    return 'DEMOLISHED';
  }

  return 'EXISTING';
}

function normalizeOperationalStatus(value: string | null): SavrOperationalStatus | null {
  const normalizedValue = value?.trim().toUpperCase();

  if (
    normalizedValue === 'EXISTING' ||
    normalizedValue === 'NEW' ||
    normalizedValue === 'NOT_FOUND' ||
    normalizedValue === 'DEMOLISHED'
  ) {
    return normalizedValue;
  }

  return null;
}

function getAssetStatusForOperationalStatus(status: SavrOperationalStatus): AssetStatus {
  if (status === 'NOT_FOUND') {
    return 'NOT_FOUND';
  }

  if (status === 'DEMOLISHED') {
    return 'REMOVED';
  }

  return 'ACTIVE';
}

function getOperationalStatusTone(status: SavrOperationalStatus) {
  if (status === 'NOT_FOUND' || status === 'DEMOLISHED') {
    return 'warning' as const;
  }

  return 'success' as const;
}

function buildAssetMetadata({
  existingMetadata,
  coordinateSource,
  coordinateCapturedAt,
  gpsAccuracyMeters,
  operationalStatus,
}: {
  existingMetadata?: Record<string, unknown> | null;
  coordinateSource: CoordinateSource | null;
  coordinateCapturedAt: string | null;
  gpsAccuracyMeters: number | null;
  operationalStatus: SavrOperationalStatus | null;
}) {
  const nextMetadata: Record<string, unknown> =
    existingMetadata && typeof existingMetadata === 'object'
      ? { ...existingMetadata }
      : {};

  if (coordinateSource) {
    nextMetadata.coordinateSource = coordinateSource;
  }

  if (coordinateCapturedAt) {
    nextMetadata.coordinateCapturedAt = coordinateCapturedAt;
  }

  if (gpsAccuracyMeters !== null || 'gpsAccuracyMeters' in nextMetadata) {
    nextMetadata.gpsAccuracyMeters = gpsAccuracyMeters;
  }

  if (operationalStatus) {
    nextMetadata.operationalStatus = operationalStatus;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}

function getMetadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const value = metadata[key];

  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function getMetadataCoordinateSource(
  metadata: Record<string, unknown> | null | undefined,
): CoordinateSource | null {
  const value = getMetadataString(metadata, 'coordinateSource');

  if (value === 'current_gps' || value === 'map_picker' || value === 'manual') {
    return value;
  }

  return null;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    suggestionChip: {
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.colors.infoBorder,
      backgroundColor: t.colors.infoSoft,
    },
    suggestionChipPressed: {
      backgroundColor: t.colors.surfacePressed,
    },
    suggestionChipText: {
      flexShrink: 1,
      fontSize: 15,
      fontWeight: '700',
      color: t.colors.infoText,
    },
    suggestionChipHint: {
      fontSize: 12,
      fontWeight: '600',
      color: t.colors.infoText,
      opacity: 0.8,
    },
    dropdownField: {
      minHeight: 52,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
      alignItems: 'center',
    },
    dropdownFieldOpen: {
      borderColor: t.colors.textPrimary,
      backgroundColor: t.colors.surfaceMuted,
    },
    dropdownFieldPressed: {
      opacity: 0.94,
    },
    pressedButton: {
      opacity: 0.82,
    },
    dropdownLabelWrap: {
      flex: 1,
      gap: 5,
    },
    dropdownLabel: {
      fontSize: 11,
      lineHeight: 15,
      fontWeight: '700',
      color: t.colors.textSecondary,
      textTransform: 'uppercase',
    },
    dropdownValue: {
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '700',
      color: t.colors.textPrimary,
    },
    dropdownCaret: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      color: t.colors.textPrimary,
    },
    dropdownOptions: {
      paddingTop: 8,
      gap: 8,
    },
    statusOptionGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingTop: 8,
    },
    statusOptionButton: {
      minHeight: 38,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
      flexGrow: 1,
      flexBasis: '47%',
    },
    statusOptionButtonSelected: {
      borderColor: t.colors.textPrimary,
      backgroundColor: t.colors.surfaceMuted,
    },
    coordinateSummaryRow: {
      minHeight: 38,
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    coordinateSummaryText: {
      flex: 1,
      color: t.colors.textPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    coordinateAccuracyText: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      textAlign: 'right',
    },
    coordinateSourceText: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
    },
    coordinateInputRow: {
      flexDirection: 'row',
      gap: 10,
    },
    coordinateInputCell: {
      flex: 1,
    },
    coordinateActionRow: {
      flexDirection: 'row',
      gap: 10,
    },
    coordinateActionCell: {
      flex: 1,
    },
    mapPickerSafeArea: {
      flex: 1,
      backgroundColor: t.colors.background,
      paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0,
    },
    mapPickerScreen: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    mapPickerHeader: {
      minHeight: 54,
      paddingHorizontal: t.spacing.screen,
      paddingBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    mapPickerHeaderButton: {
      minWidth: 72,
      minHeight: 40,
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.card,
      paddingHorizontal: 12,
    },
    mapPickerHeaderButtonText: {
      color: t.colors.textPrimary,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '700',
    },
    mapPickerHeaderTitleWrap: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    mapPickerTitle: {
      color: t.colors.textPrimary,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: '700',
      textAlign: 'center',
    },
    mapPickerSubtitle: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
      textAlign: 'center',
    },
    mapPickerHeaderSide: {
      width: 72,
    },
    mapPickerMapShell: {
      flex: 1,
      backgroundColor: t.colors.border,
    },
    mapPickerFooter: {
      borderTopWidth: 1,
      borderTopColor: t.colors.border,
      backgroundColor: t.colors.background,
      paddingHorizontal: t.spacing.screen,
      paddingVertical: 14,
      gap: 12,
    },
    mapPickerCoordinatePanel: {
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      padding: 12,
      gap: 4,
    },
    mapPickerCoordinateLabel: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
    },
    mapPickerCoordinateValue: {
      color: t.colors.textPrimary,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '800',
    },
    mapPickerAccuracyText: {
      color: t.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
  });

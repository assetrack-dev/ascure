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
import type { MapPressEvent, MarkerDragStartEndEvent, Region } from 'react-native-maps';
import { api, ApiError } from '../api';
import {
  AppButton,
  BodyText,
  Card,
  EmptyState,
  ErrorBanner,
  InlineButton,
  LoadingBlock,
  Screen,
  SectionTitle,
  SelectCard,
  TextField,
  uiTheme,
} from '../ui';
import { Asset, AssetStatus, AssetType, Substation } from '../types';
import { normalizeOperationalPayloadText, normalizeOperationalText } from '../utils';

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

export function AddAssetScreen({
  token,
  substationId,
  siteVisitId,
  assetToEdit,
  initialLatitude,
  initialLongitude,
  onBack,
  onSaved,
  onUnauthorized,
}: {
  token: string;
  substationId?: string;
  siteVisitId?: string;
  assetToEdit?: Asset;
  initialLatitude?: number;
  initialLongitude?: number;
  onBack: () => void;
  onSaved: (asset: Asset, successMessage: string) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
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
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isOpeningMapPicker, setIsOpeningMapPicker] = useState(false);
  const [isSubstationMenuOpen, setIsSubstationMenuOpen] = useState(false);
  const [isAssetTypeMenuOpen, setIsAssetTypeMenuOpen] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      applyGpsPosition(position, 'current_gps');
    } catch {
      // Ignore passive GPS lookup failures so the form still loads cleanly.
    }
  }, []);

  const loadOptions = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [assetTypeList, substationList] = await Promise.all([
        api.getAssetTypes(token),
        substationId ? Promise.resolve<Substation[]>([]) : api.getSubstations(token),
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
        await onUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load asset options.');
    } finally {
      setIsLoading(false);
    }
  }, [
    hasInitialMapLocation,
    isEditMode,
    onUnauthorized,
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

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

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

      const currentLocation = await getCurrentLocationForMapPicker();
      const formCoordinate = parseFormCoordinate(latitude, longitude);
      const coordinate = currentLocation?.coordinate ?? formCoordinate ?? DEFAULT_MAP_PICKER_COORDINATE;

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

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

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

  async function handleSubmit() {
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
        let savedAsset = await api.updateAsset(token, assetToEdit.id, {
          assetTypeId: selectedAssetTypeId,
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

        onSaved(savedAsset, `Asset ${normalizedAssetCode} updated successfully.`);
        return;
      }

      const savedAsset = await api.createAsset(token, {
        substationId: targetSubstationId,
        assetTypeId: selectedAssetTypeId,
        assetCode: normalizedAssetCode,
        name: normalizedAssetName,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        metadata: assetMetadata,
        status: targetAssetStatus,
        createdDuringVisitId: siteVisitId,
      });

      onSaved(savedAsset, `Asset ${normalizedAssetCode} added successfully.`);
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        await onUnauthorized(submitError);
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
        onCancel={() => setMapPickerState(null)}
        onConfirm={handleConfirmMapCoordinate}
      />
    );
  }

  return (
    <Screen
      title={isEditMode ? 'Edit Asset' : 'Add Asset'}
      subtitle={
        isEditMode
          ? 'Update the selected asset details for this shared site visit.'
          : 'Register a new asset for this shared site visit before starting an inspection.'
      }
      actions={
        <>
          <InlineButton label="Back" onPress={onBack} disabled={isSubmitting} />
          <InlineButton label="Refresh" onPress={loadOptions} disabled={isSubmitting || isLocating} />
        </>
      }
      keyboardAware
      footer={
        <AppButton
          label={
            isSubmitting
              ? isEditMode
                ? 'Updating Asset...'
                : 'Saving Asset...'
              : isEditMode
                ? 'Update Asset'
                : 'Save Asset'
          }
          onPress={handleSubmit}
          loading={isSubmitting}
          disabled={
            isLoading ||
            isSubmitting ||
            assetTypes.length === 0 ||
            (!substationId && substations.length === 0)
          }
        />
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
              <SectionTitle>Asset Operational Status</SectionTitle>
              <View style={styles.dropdownOptions}>
                {SAVR_OPERATIONAL_STATUS_OPTIONS.map((option) => (
                  <SelectCard
                    key={option.value}
                    label={option.label}
                    description={option.description}
                    selected={operationalStatus === option.value}
                    onPress={() => setOperationalStatus(option.value)}
                  />
                ))}
              </View>
            </Card>
          ) : null}

          <Card>
            <SectionTitle>Coordinates</SectionTitle>
            {hasInitialMapLocation ? <BodyText muted>Location selected from map</BodyText> : null}
            <BodyText muted>
              Use device GPS, select on satellite map, or enter coordinates manually.
            </BodyText>
            <TextField
              label="Latitude"
              value={latitude}
              onChangeText={handleManualLatitude}
              placeholder="e.g. 2.925900"
              keyboardType="numbers-and-punctuation"
            />
            <TextField
              label="Longitude"
              value={longitude}
              onChangeText={handleManualLongitude}
              placeholder="e.g. 101.690000"
              keyboardType="numbers-and-punctuation"
            />
            <View style={styles.coordinateMetaPanel}>
              <Text style={styles.coordinateMetaLabel}>GPS Accuracy</Text>
              <Text style={styles.coordinateMetaValue}>
                {gpsAccuracyMeters === null ? 'Not available' : `+/-${Math.round(gpsAccuracyMeters)} m`}
              </Text>
            </View>
            <AppButton
              label={isLocating ? 'Reading Current GPS...' : 'Use Current GPS'}
              onPress={handleUseCurrentLocation}
              variant="secondary"
              loading={isLocating}
              disabled={isSubmitting}
            />
            <AppButton
              label={isOpeningMapPicker ? 'Opening Map...' : 'Select on Map'}
              onPress={handleOpenMapPicker}
              variant="secondary"
              loading={isOpeningMapPicker}
              disabled={isSubmitting}
            />
            {hasLocationPermission === false ? (
              <BodyText muted>Location permission is off right now. Manual coordinates still work.</BodyText>
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
  onCancel,
  onConfirm,
}: {
  initialCoordinate: Coordinate;
  accuracyMeters: number | null;
  onCancel: () => void;
  onConfirm: (params: { coordinate: Coordinate; accuracyMeters: number | null }) => void;
}) {
  const [coordinate, setCoordinate] = useState(initialCoordinate);
  const [region, setRegion] = useState<Region>(() => createMapPickerRegion(initialCoordinate));

  function handleMapPress(event: MapPressEvent) {
    const nextCoordinate = event.nativeEvent.coordinate;

    setCoordinate(nextCoordinate);
    setRegion((currentRegion) => ({
      ...currentRegion,
      latitude: nextCoordinate.latitude,
      longitude: nextCoordinate.longitude,
    }));
  }

  function handleMarkerDragEnd(event: MarkerDragStartEndEvent) {
    const nextCoordinate = event.nativeEvent.coordinate;

    setCoordinate(nextCoordinate);
    setRegion((currentRegion) => ({
      ...currentRegion,
      latitude: nextCoordinate.latitude,
      longitude: nextCoordinate.longitude,
    }));
  }

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
            <Text style={styles.mapPickerSubtitle}>Satellite view</Text>
          </View>
          <View style={styles.mapPickerHeaderSide} />
        </View>

        <View style={styles.mapPickerMapShell}>
          <MapView
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFillObject}
            initialRegion={region}
            region={region}
            mapType="satellite"
            showsUserLocation
            showsMyLocationButton
            onPress={handleMapPress}
            onRegionChangeComplete={setRegion}
          >
            <Marker
              coordinate={coordinate}
              draggable
              title="Selected asset location"
              pinColor="#10b981"
              onDragEnd={handleMarkerDragEnd}
            />
          </MapView>
        </View>

        <View style={styles.mapPickerFooter}>
          <View style={styles.mapPickerCoordinatePanel}>
            <Text style={styles.mapPickerCoordinateLabel}>Selected GPS</Text>
            <Text style={styles.mapPickerCoordinateValue}>
              {coordinate.latitude.toFixed(6)}, {coordinate.longitude.toFixed(6)}
            </Text>
            <Text style={styles.mapPickerAccuracyText}>
              Accuracy: {accuracyMeters === null ? 'Not available' : `+/-${Math.round(accuracyMeters)} m`}
            </Text>
          </View>
          <AppButton
            label="Confirm Coordinates"
            onPress={() => onConfirm({ coordinate, accuracyMeters })}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function formatCoordinate(value: number) {
  return value.toFixed(6);
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

const styles = StyleSheet.create({
  dropdownField: {
    minHeight: 64,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#c7d5e8',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'center',
  },
  dropdownFieldOpen: {
    borderColor: '#0f5cd8',
    backgroundColor: '#eef4ff',
  },
  dropdownFieldPressed: {
    opacity: 0.94,
  },
  pressedButton: {
    opacity: 0.82,
  },
  dropdownLabelWrap: {
    flex: 1,
    gap: 6,
  },
  dropdownLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#607086',
  },
  dropdownValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  dropdownCaret: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f5cd8',
  },
  dropdownOptions: {
    paddingTop: 12,
    gap: 10,
  },
  coordinateMetaPanel: {
    minHeight: 48,
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.surfaceMuted,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  coordinateMetaLabel: {
    flex: 1,
    color: uiTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  coordinateMetaValue: {
    color: uiTheme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    textAlign: 'right',
  },
  mapPickerSafeArea: {
    flex: 1,
    backgroundColor: uiTheme.colors.background,
    paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0,
  },
  mapPickerScreen: {
    flex: 1,
    backgroundColor: uiTheme.colors.background,
  },
  mapPickerHeader: {
    minHeight: 54,
    paddingHorizontal: uiTheme.spacing.screen,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapPickerHeaderButton: {
    minWidth: 72,
    minHeight: 40,
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiTheme.colors.card,
    paddingHorizontal: 12,
  },
  mapPickerHeaderButtonText: {
    color: uiTheme.colors.textPrimary,
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
    color: uiTheme.colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  mapPickerSubtitle: {
    color: uiTheme.colors.textSecondary,
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
    backgroundColor: '#e5e7eb',
  },
  mapPickerFooter: {
    borderTopWidth: 1,
    borderTopColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.background,
    paddingHorizontal: uiTheme.spacing.screen,
    paddingVertical: 14,
    gap: 12,
  },
  mapPickerCoordinatePanel: {
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    padding: 12,
    gap: 4,
  },
  mapPickerCoordinateLabel: {
    color: uiTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  mapPickerCoordinateValue: {
    color: uiTheme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  mapPickerAccuracyText: {
    color: uiTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});

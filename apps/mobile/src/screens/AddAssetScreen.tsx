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
import { Feather } from '@expo/vector-icons';
import Mapbox from '@rnmapbox/maps';
import { SATELLITE_STYLE } from '../mapbox';
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
  BottomCTA,
  Card,
  EmptyState,
  ErrorBanner,
  InlineButton,
  LoadingBlock,
  Mono,
  Screen,
  SectionTitle,
  SelectCard,
  StatusChip,
  TextField,
} from '../ui';
import { Theme, useTheme } from '../theme';
import { Asset, AssetStatus, AssetType, Substation } from '../types';
import { normalizeOperationalPayloadText, normalizeOperationalText } from '../utils';
import { normalizePoleInput, suggestNextPoleCode } from '../utils/feederSequence';
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

// Rough delta->zoom: the old react-native-maps 0.004 delta ≈ Mapbox zoom 15.
const MAP_PICKER_ZOOM = 15;

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
  // SAVT route context, fetched from the visit. A SAVT survey numbers poles as a
  // running integer carrying the route's KOD TIANG (e.g. "MI - KUK 1"), unlike
  // SAVR's feeder grammar. Detected by the VISIT scope (authoritative), not the
  // asset type.
  const [visitScope, setVisitScope] = useState<string | null>(null);
  const [visitRouteCode, setVisitRouteCode] = useState<string | null>(null);

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

  const isSAVTWorkflow = visitScope === 'SAVT';
  // SAVR and SAVT share the pole-survey UI (NO TIANG LAMA + operational status).
  const isPoleSurvey = isSAVRWorkflow || isSAVTWorkflow;
  // The route line code ("KOD TIANG"), set once at check-in and normalized to
  // match how pole codes are stored (uppercased). Every SAVT pole code = this
  // prefix plus its No. Tiang, e.g. "MI - KUK 1".
  const routePrefix = useMemo(
    () => normalizeOperationalText(visitRouteCode ?? '').trim(),
    [visitRouteCode],
  );

  const assetCodeLabel = isSAVTWorkflow
    ? 'No. Tiang'
    : isSAVRWorkflow
      ? 'NO TIANG RONDAAN'
      : 'Asset Code';
  const assetNameLabel = isPoleSurvey ? 'NO TIANG LAMA' : 'Asset Name (Optional)';
  const selectedOperationalStatusOption = useMemo(
    () =>
      SAVR_OPERATIONAL_STATUS_OPTIONS.find((option) => option.value === operationalStatus) ??
      SAVR_OPERATIONAL_STATUS_OPTIONS[0],
    [operationalStatus],
  );
  // The active survey mode, shown as a read-only mono badge. The scope is derived
  // from the visit (SAVT) or the chosen asset type (SAVR) — not a free toggle.
  const scopeBadge = isSAVTWorkflow ? 'SAVT' : isSAVRWorkflow ? 'SAVR' : null;

  // Suggest the next NO TIANG RONDAAN from the last code entered in this
  // Pencawang (tappable chip; the field stays empty). New SAVR poles only —
  // skips edit mode and non-SAVR asset types.
  useEffect(() => {
    const target = substationId ?? selectedSubstationId;

    if (assetToEdit || !isSAVRWorkflow || isSAVTWorkflow || !target) {
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
  }, [assetToEdit, isSAVRWorkflow, isSAVTWorkflow, substationId, selectedSubstationId]);

  // SAVT "Next:" = the route's highest existing No. Tiang + 1 (poles can be added
  // out of order, so MAX not last). Branches ("/m") are typed manually. New SAVT
  // poles only; the field holds just the integer — the KOD TIANG is prefixed on
  // save. An empty route suggests "1".
  useEffect(() => {
    const target = substationId ?? selectedSubstationId;

    if (assetToEdit || !isSAVTWorkflow || !routePrefix || !target) {
      return;
    }

    let cancelled = false;

    api
      .getAssets(token, target)
      .then((assets) => {
        if (!cancelled) {
          setSuggestedCode(suggestNextSavtNoTiang(assets, routePrefix));
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
  }, [assetToEdit, isSAVTWorkflow, routePrefix, substationId, selectedSubstationId, token]);

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

  // SAVT edit: the stored code is the full "{KOD TIANG} {No. Tiang}" (e.g.
  // "MI - KUK 1"), but the field captures only the No. Tiang. Once the route
  // prefix resolves (the visit fetch lands after the rehydrate above), strip it
  // so the field shows just the number; save re-prefixes it. Touches only the code.
  useEffect(() => {
    if (!assetToEdit || !isSAVTWorkflow || !routePrefix) {
      return;
    }

    const code = normalizeOperationalText(assetToEdit.assetCode ?? '');
    const prefix = `${routePrefix} `.toUpperCase();

    if (code.toUpperCase().startsWith(prefix)) {
      setAssetCode(code.slice(prefix.length).trim());
    }
  }, [assetToEdit, isSAVTWorkflow, routePrefix]);

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

      // Fetch the visit's scope + KOD TIANG so a SAVT route numbers its poles as a
      // running integer carrying the route code. Non-fatal and cached, so the form
      // still loads (and works offline) when the visit can't be fetched.
      let visitOperationalScope: string | null = null;
      if (siteVisitId) {
        try {
          const { value: visit } = await cachedFetch('site-visit', siteVisitId, () =>
            api.getSiteVisit(token, siteVisitId),
          );
          visitOperationalScope = visit?.operationalScope ?? null;
          setVisitScope(visitOperationalScope);
          setVisitRouteCode(visit?.routeCode ?? null);
        } catch {
          // Leave SAVT numbering dormant; SAVR/generic asset entry is unaffected.
        }
      }

      if (assetTypeList.length > 0) {
        // On a scoped visit (e.g. SAVT) default the asset type to one matching that
        // scope, so the crew doesn't re-pick it on every pole — and the pole then
        // resolves that scope's checklist. New poles only; an edit keeps its own type.
        const preferredAssetTypeId =
          !isEditMode && visitOperationalScope
            ? pickDefaultAssetTypeId(assetTypeList, visitOperationalScope)
            : assetTypeList[0].id;
        setSelectedAssetTypeId((currentValue) =>
          assetTypeList.some((assetType) => assetType.id === currentValue)
            ? currentValue
            : preferredAssetTypeId,
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
    siteVisitId,
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
      // When EDITING an existing pole, open the picker on its SAVED location
      // (the form already holds it) so the crosshair lands on the pole — not
      // wherever the surveyor happens to be standing now. A brand-new pole still
      // defaults to the current GPS fix.
      const coordinate = isEditMode
        ? formCoordinate ?? currentLocation?.coordinate ?? DEFAULT_MAP_PICKER_COORDINATE
        : currentLocation?.coordinate ?? formCoordinate ?? DEFAULT_MAP_PICKER_COORDINATE;

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

    // SAVT poles store the full identity = route KOD TIANG + No. Tiang
    // (e.g. "MI - KUK 1") so they stay unique per Pencawang across routes. The
    // field holds only the No. Tiang; prefix it here, guarding against a value
    // that already carries the prefix.
    const composedAssetCode =
      isSAVTWorkflow && routePrefix
        ? normalizedAssetCode.toUpperCase().startsWith(`${routePrefix} `.toUpperCase())
          ? normalizedAssetCode
          : `${routePrefix} ${normalizedAssetCode}`
        : isSAVRWorkflow
          ? // Store SAVR pole codes in canonical NO TIANG RONDAAN form (single
            // spaces, upper-case, `FP<n>`/`&`/`/` spacing) so what's saved always
            // matches the pre-completion sequence check — no stray-space drift.
            normalizePoleInput(normalizedAssetCode)
          : normalizedAssetCode;

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
      operationalStatus: isPoleSurvey ? operationalStatus : null,
    });
    const targetAssetStatus = isPoleSurvey
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
          assetCode: composedAssetCode,
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
        assetCode: composedAssetCode,
        name: normalizedAssetName,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        metadata: assetMetadata,
        status: targetAssetStatus,
        createdDuringVisitId: siteVisitId,
      };

      try {
        const savedAsset = await api.createAsset(token, createInput);
        await storeLastPoleCode(targetSubstationId, composedAssetCode);
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
            label: composedAssetCode,
            sublabel: selectedSubstation
              ? `${selectedSubstation.code} - ${selectedSubstation.name}`
              : undefined,
          });

          const optimisticAsset: Asset = {
            id: tempId,
            substationId: targetSubstationId,
            assetTypeId: selectedAssetTypeId,
            assetCode: composedAssetCode,
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

          await storeLastPoleCode(targetSubstationId, composedAssetCode);
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

  const hasGpsFix = latitude.trim().length > 0 && longitude.trim().length > 0;

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
      bottomBar={
        isEditMode ? (
          <BottomCTA
            label={isSubmitting ? 'Updating asset...' : 'Update Asset'}
            onPress={() => handleSubmit('detail')}
            loading={isSubmitting}
            disabled={isSaveDisabled}
          />
        ) : (
          <BottomCTA
            label={isSubmitting ? 'Saving...' : 'Save & Inspect'}
            onPress={() => handleSubmit('inspect')}
            loading={isSubmitting}
            disabled={isSaveDisabled}
          />
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
                      {selectedSubstation ? (
                        <Mono size={14} color={theme.colors.textPrimary}>
                          {`${selectedSubstation.code} - ${selectedSubstation.name}`}
                        </Mono>
                      ) : (
                        <Text style={styles.dropdownValue}>Choose a pencawang</Text>
                      )}
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
            <View style={styles.sectionHeaderRow}>
              <SectionTitle>Asset Type</SectionTitle>
              {scopeBadge ? <StatusChip label={scopeBadge} tone="info" /> : null}
            </View>
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
                    {selectedAssetType ? (
                      <Mono size={14} color={theme.colors.textPrimary}>
                        {`${selectedAssetType.code} - ${selectedAssetType.name}`}
                      </Mono>
                    ) : (
                      <Text style={styles.dropdownValue}>Choose an asset type</Text>
                    )}
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
            {isSAVTWorkflow && routePrefix ? (
              <View style={styles.routeContext}>
                <Text style={styles.routeContextLabel}>KOD TIANG</Text>
                <Mono size={16} color={theme.colors.infoText}>
                  {routePrefix}
                </Mono>
              </View>
            ) : null}
            <TextField
              label={assetCodeLabel}
              value={assetCode}
              onChangeText={(nextValue) => setAssetCode(normalizeOperationalText(nextValue))}
              placeholder={
                isSAVTWorkflow
                  ? 'Masukkan No Tiang (cth. 1 atau 33/1)'
                  : isSAVRWorkflow
                    ? 'Masukkan No Tiang Rondaan'
                    : 'Enter the field asset code'
              }
              autoCapitalize="characters"
            />
            {suggestedCode && !assetCode ? (
              <Pressable
                onPress={() => setAssetCode(suggestedCode)}
                accessibilityRole="button"
                accessibilityLabel={`Use suggested ${assetCodeLabel} ${suggestedCode}`}
                style={({ pressed }) => [
                  styles.suggestionChip,
                  pressed && styles.suggestionChipPressed,
                ]}
              >
                <View style={styles.suggestionChipTextWrap}>
                  <Text style={styles.suggestionChipEyebrow}>NEXT</Text>
                  <Mono size={15} color={theme.colors.infoText}>
                    {suggestedCode}
                  </Mono>
                </View>
                <Text style={styles.suggestionChipHint}>Tap to use</Text>
              </Pressable>
            ) : null}
            <TextField
              label={assetNameLabel}
              value={assetName}
              onChangeText={(nextValue) => setAssetName(normalizeOperationalText(nextValue))}
              placeholder={isPoleSurvey ? 'Masukkan No Tiang Lama jika ada' : 'Enter a readable asset name'}
              autoCapitalize="characters"
            />
          </Card>

          {isPoleSurvey ? (
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
            {/* Confirmed GPS reads as a green card; coords + accuracy in mono. */}
            <View style={[styles.gpsCard, hasGpsFix ? styles.gpsCardConfirmed : styles.gpsCardPending]}>
              <View style={styles.gpsCardHeader}>
                <Feather
                  name={hasGpsFix ? 'check-circle' : 'map-pin'}
                  size={16}
                  color={hasGpsFix ? theme.colors.successText : theme.colors.textSecondary}
                />
                <Text
                  style={[
                    styles.gpsCardStatus,
                    { color: hasGpsFix ? theme.colors.successText : theme.colors.textSecondary },
                  ]}
                >
                  {hasGpsFix
                    ? hasInitialMapLocation
                      ? 'Map selected'
                      : 'GPS captured'
                    : isLocating
                      ? 'Reading GPS...'
                      : 'No GPS fix yet'}
                </Text>
                <Mono
                  size={12}
                  color={hasGpsFix ? theme.colors.successText : theme.colors.textMuted}
                >
                  {formatGpsAccuracy(gpsAccuracyMeters)}
                </Mono>
              </View>
              <Mono
                size={15}
                color={hasGpsFix ? theme.colors.textPrimary : theme.colors.textMuted}
              >
                {formatCoordinateSummary(latitude, longitude)}
              </Mono>
            </View>
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
                  label={isOpeningMapPicker ? 'Opening...' : 'Pick on map'}
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

          {/* Secondary save path lives in-content; the primary "Save & Inspect"
              is the docked BottomCTA. New poles only (edit has a single CTA). */}
          {!isEditMode ? (
            <AppButton
              label="Save pole only"
              onPress={() => handleSubmit('another')}
              variant="secondary"
              disabled={isSaveDisabled}
            />
          ) : null}
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
  // Uncontrolled camera: seed the centre once via Camera defaultSettings and
  // TRACK the centre via onMapIdle (the Mapbox analog of the old
  // onRegionChangeComplete). We only update on idle — not on every frame of the
  // pan — so state changes never fight the native gesture or make taps feel inert.
  const [centre, setCentre] = useState<Coordinate>(initialCoordinate);

  const neighbourMarkers = useMemo(
    () =>
      assets.flatMap((asset) => {
        const lat = asset.latitude;
        const lng = asset.longitude;
        if (typeof lat !== 'number' || typeof lng !== 'number') {
          return [];
        }
        return [
          // Mapbox coordinates are [longitude, latitude]. PointAnnotation needs a
          // child view (no pinColor prop) — a small dot tinted by asset status.
          <Mapbox.PointAnnotation
            key={`pole-${asset.id}`}
            id={`pole-${asset.id}`}
            coordinate={[lng, lat]}
          >
            <View
              style={[styles.neighbourPin, { backgroundColor: assetMarkerColor(asset) }]}
            />
          </Mapbox.PointAnnotation>,
        ];
      }),
    [assets, styles.neighbourPin],
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
          <Mapbox.MapView
            style={StyleSheet.absoluteFillObject}
            styleURL={SATELLITE_STYLE}
            scaleBarEnabled={false}
            compassEnabled={false}
            onMapIdle={(state) => {
              const [lng, lat] = state.properties.center as [number, number];
              if (Number.isFinite(lng) && Number.isFinite(lat)) {
                setCentre({ latitude: lat, longitude: lng });
              }
            }}
          >
            <Mapbox.Camera
              animationMode="none"
              defaultSettings={{
                centerCoordinate: [initialCoordinate.longitude, initialCoordinate.latitude],
                zoomLevel: MAP_PICKER_ZOOM,
              }}
            />
            <Mapbox.LocationPuck visible />
            {neighbourMarkers}
          </Mapbox.MapView>
          {/* Fixed centre crosshair: the chosen location is the map centre, so
              the target isn't hidden under the finger. */}
          <MapCrosshair />
        </View>

        <View style={styles.mapPickerFooter}>
          <View style={styles.mapPickerCoordinatePanel}>
            <Text style={styles.mapPickerCoordinateLabel}>Centre location</Text>
            <Mono size={14} color={theme.colors.textPrimary}>
              Lat {centre.latitude.toFixed(6)} · Lng {centre.longitude.toFixed(6)}
            </Mono>
            <Mono size={13} muted>
              {formatGpsAccuracy(accuracyMeters)}
            </Mono>
          </View>
          <AppButton
            label="Confirm Coordinates"
            onPress={() =>
              onConfirm({
                coordinate: { latitude: centre.latitude, longitude: centre.longitude },
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

  return `${latitudeLabel}, ${longitudeLabel}`;
}

function formatGpsAccuracy(value: number | null) {
  return value === null ? 'GPS --' : `±${Math.round(value)}m`;
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

function isSavrAssetType(assetType: AssetType | null) {
  if (!assetType) {
    return false;
  }

  return [assetType.code, assetType.name].some((value) =>
    typeof value === 'string' && value.trim().toUpperCase().includes('SAVR'),
  );
}

// Pick the asset type to default to for a scoped visit (e.g. SAVT). Prefer one
// whose operationalScope matches; fall back to a code/name keyword when the asset
// type hasn't been tagged with a scope; else the first type. Caller guards
// assetTypes.length > 0.
function pickDefaultAssetTypeId(
  assetTypes: AssetType[],
  visitScope: string,
): string {
  const byScope = assetTypes.find(
    (assetType) => assetType.operationalScope === visitScope,
  );

  if (byScope) {
    return byScope.id;
  }

  const byKeyword = assetTypes.find((assetType) =>
    assetTypeMatchesScopeKeyword(assetType, visitScope),
  );

  return (byKeyword ?? assetTypes[0]).id;
}

function assetTypeMatchesScopeKeyword(
  assetType: AssetType,
  visitScope: string,
): boolean {
  const haystack = `${assetType.code ?? ''} ${assetType.name ?? ''}`.toUpperCase();

  if (visitScope === 'SAVT') {
    return haystack.includes('SAVT') || haystack.includes('TINGGI');
  }

  if (visitScope === 'SAVR') {
    return haystack.includes('SAVR') || haystack.includes('RENDAH');
  }

  return haystack.includes(visitScope.toUpperCase());
}

// SAVT "Next:" suggestion = the route's highest existing No. Tiang + 1. The
// route's poles are this Pencawang's assets whose code starts with the route
// KOD TIANG prefix (e.g. "MI - KUK "); the trunk number is the leading integer
// of the remainder, so a branch like "33/1" still counts under trunk 33. An
// empty route suggests "1".
function suggestNextSavtNoTiang(assets: Asset[], routePrefix: string): string {
  const prefix = `${routePrefix} `.toUpperCase();
  let max = 0;

  for (const asset of assets) {
    const code = (asset.assetCode ?? '').toUpperCase();

    if (!code.startsWith(prefix)) {
      continue;
    }

    const match = code.slice(prefix.length).trim().match(/^(\d+)/);

    if (match) {
      const value = Number.parseInt(match[1], 10);

      if (Number.isFinite(value) && value > max) {
        max = value;
      }
    }
  }

  return String(max + 1);
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
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    suggestionChip: {
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: t.radius.chip,
      borderWidth: 1,
      borderColor: t.colors.infoBorder,
      backgroundColor: t.colors.infoSoft,
    },
    suggestionChipPressed: {
      backgroundColor: t.colors.surfacePressed,
    },
    suggestionChipTextWrap: {
      flexShrink: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    suggestionChipEyebrow: {
      fontSize: 11,
      fontFamily: t.fonts.monoMedium,
      letterSpacing: 1.2,
      color: t.colors.infoText,
      opacity: 0.8,
    },
    suggestionChipHint: {
      fontSize: 12,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
      color: t.colors.infoText,
      opacity: 0.8,
    },
    routeContext: {
      marginBottom: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: t.radius.chip,
      borderWidth: 1,
      borderColor: t.colors.infoBorder,
      backgroundColor: t.colors.infoSoft,
      gap: 2,
    },
    routeContextLabel: {
      fontSize: 11,
      fontFamily: t.fonts.monoMedium,
      letterSpacing: 1.2,
      color: t.colors.infoText,
      opacity: 0.8,
    },
    dropdownField: {
      minHeight: 52,
      borderRadius: t.radius.control,
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
      borderColor: t.colors.primary,
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
      fontFamily: t.fonts.monoMedium,
      letterSpacing: 1.2,
      color: t.colors.textMuted,
      textTransform: 'uppercase',
    },
    dropdownValue: {
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
      color: t.colors.textPrimary,
    },
    dropdownCaret: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
      color: t.colors.primary,
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
      borderRadius: t.radius.control,
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
      borderColor: t.colors.primary,
      backgroundColor: t.colors.surfaceMuted,
    },
    // Confirmed GPS card (handoff 2j) — green when a fix is captured.
    gpsCard: {
      borderRadius: t.radius.card,
      borderWidth: 1,
      padding: 12,
      gap: 8,
    },
    gpsCardConfirmed: {
      borderColor: t.colors.successBorder,
      backgroundColor: t.colors.successSoft,
    },
    gpsCardPending: {
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
    },
    gpsCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    gpsCardStatus: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
    },
    coordinateSourceText: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
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
      borderRadius: t.radius.control,
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
      fontFamily: t.fonts.bodyBold,
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
      fontFamily: t.fonts.display,
      textAlign: 'center',
    },
    mapPickerSubtitle: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
      textAlign: 'center',
    },
    mapPickerHeaderSide: {
      width: 72,
    },
    mapPickerMapShell: {
      flex: 1,
      backgroundColor: t.colors.border,
    },
    // Neighbour pole marker: a small status-tinted dot (Mapbox PointAnnotation
    // has no pinColor prop, so the colour is applied inline per asset).
    neighbourPin: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: '#ffffff',
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
      fontFamily: t.fonts.bodySemibold,
    },
  });

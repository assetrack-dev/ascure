import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Callout, Heatmap, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { LongPressEvent, Region } from 'react-native-maps';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { cachedFetch } from '../offlineCache';
import { assetMarkerColor } from '../assetDisplay';
import { MapCrosshair } from '../components/MapCrosshair';
import { getPositionWithTimeout } from '../location';
import { useSession } from '../context/AuthContext';
import { useCapabilities } from '../useCapabilities';
import type { AppDrawerScreenProps } from '../navigation/types';
import { AppButton, BodyText, ErrorBanner, LoadingBlock, Screen, SuccessBanner } from '../ui';
import { Theme, useTheme } from '../theme';
import { Asset, DefectDetail, DefectListItem } from '../types';
import { buildFeederLines, validateFeederSequences } from '../utils/feederSequence';
import type { AssetLike } from '../utils/feederSequence';

type Coordinate = {
  latitude: number;
  longitude: number;
};

type HeatmapPoint = Coordinate & {
  weight: number;
};

type MapFeederLine = ReturnType<typeof buildFeederLines>[number];
type DrawableMapFeederLine = MapFeederLine & {
  coordinates: [Coordinate, Coordinate];
};
type RenderedFeederLine = DrawableMapFeederLine & {
  displayCoordinates: Coordinate[];
};
type SequenceValidationResult = ReturnType<typeof validateFeederSequences>;
type DefectMapMarker = DefectListItem & Coordinate & DefectMapExtraData;
type DefectSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

type MapMode = 'assets' | 'defects';
type MapType = 'standard' | 'hybrid';
type MapFilterValue = 'all' | string;

type MapFilters = {
  mapMode: MapMode;
  selectedAssetType: MapFilterValue;
  selectedInspectionStatus: MapFilterValue;
  selectedDefectSeverity: MapFilterValue;
};

type MapModeOption = {
  label: string;
  value: MapMode;
};

type MapControlMenu = 'layers' | 'mapType' | null;

type AssetMapFilterData = Asset & {
  inspectionStatus?: string | null;
  latestInspectionStatus?: string | null;
  latestInspection?: {
    status?: string | null;
    completionStatus?: string | null;
  } | null;
};

type DefectMapFilterData = DefectMapMarker & {
  severity?: string | null;
  defectSeverity?: string | null;
};

type DefectMapExtraData = {
  assetName?: string | null;
  code?: string | null;
  defectCode?: string | null;
  defectTitle?: string | null;
  title?: string | null;
  description?: string | null;
  shortDescription?: string | null;
  checklistRemark?: string | null;
  priority?: string | null;
  severity?: string | null;
  defectSeverity?: string | null;
};

type SequenceWarningMarker = {
  assetId: string;
  assetCode: string;
  coordinate: Coordinate;
  messages: string[];
};

type MapControlDeckProps = {
  mapMode: MapMode;
  onChangeMapMode: (nextMapMode: MapMode) => void;
  mapType: MapType;
  onChangeMapType: (nextMapType: MapType) => void;
  showHeatmap: boolean;
  showFeederLines: boolean;
  showSequenceWarnings: boolean;
  onToggleHeatmap: () => void;
  onToggleFeederLines: () => void;
  onToggleSequenceWarnings: () => void;
  currentAccuracy: number | null;
  locationMessage: string | null;
  onRequestCurrentLocation: () => void;
};

const DEFAULT_REGION: Region = {
  latitude: 3.139,
  longitude: 101.6869,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

const CURRENT_LOCATION_REGION_DELTA = 0.005;
const DEFECT_HEATMAP_RADIUS = 42;
const DEFECT_HEATMAP_OPACITY = 0.78;
const DEFECT_HEATMAP_GRADIENT = {
  colors: ['#22c55e', '#facc15', '#dc2626'],
  startPoints: [0.2, 0.55, 1],
  colorMapSize: 256,
};
const ALL_FILTER_VALUE = 'all';
const INITIAL_MAP_FILTERS: MapFilters = {
  mapMode: 'assets',
  selectedAssetType: ALL_FILTER_VALUE,
  selectedInspectionStatus: ALL_FILTER_VALUE,
  selectedDefectSeverity: ALL_FILTER_VALUE,
};
const MAP_MODE_OPTIONS: MapModeOption[] = [
  { label: 'Assets', value: 'assets' },
  { label: 'Defects', value: 'defects' },
];
const FEEDER_LINE_COLORS: Record<string, string> = {
  A: '#22d3ee',
  B: '#f97316',
  C: '#22c55e',
  D: '#a855f7',
  E: '#ef4444',
  F: '#eab308',
};
const FALLBACK_FEEDER_LINE_COLORS = [
  '#0ea5e9',
  '#14b8a6',
  '#84cc16',
  '#f59e0b',
  '#ec4899',
  '#6366f1',
  '#64748b',
];
const FEEDER_LINE_OFFSET_AMOUNT = 0.000025;
const MAP_CONTROL_RADIUS = 8;

export function MapScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<AppDrawerScreenProps<'AssetMap'>['navigation']>();
  const route = useRoute<AppDrawerScreenProps<'AssetMap'>['route']>();
  const { visitId, substationId, focusAssetId, focusLatitude, focusLongitude, successMessage } =
    route.params ?? {};
  // When opened from the Asset Detail mini-map, centre on that asset instead of
  // the user's current location.
  const hasAssetFocus =
    typeof focusLatitude === 'number' && typeof focusLongitude === 'number';
  // This screen is reused both as the drawer's AssetMap and as a root-stack
  // VisitAssetMap pushed from VisitDetail. Only the drawer instance has
  // openDrawer; the pushed instance shows a Back button instead (issue #6).
  const canOpenDrawer =
    typeof (navigation as { openDrawer?: () => void }).openDrawer === 'function';
  const { token, handleUnauthorized } = useSession();
  // Adding an asset is an inspection-scope action — the map stays viewable for
  // everyone, but the drop-pin / add-asset entry points are inspection-only.
  const { canInspect } = useCapabilities();

  const handleOpenAssetDetail = useCallback(
    (asset: Asset) =>
      navigation.navigate('AssetDetail', {
        visitId,
        substationId: asset.substationId,
        assetId: asset.id,
        assetSnapshot: asset,
      }),
    [navigation, visitId],
  );
  const handleOpenDefectDetail = useCallback(
    (defectId: string) => navigation.navigate('DefectDetail', { defectId }),
    [navigation],
  );

  const mapRef = useRef<MapView | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [defectMarkers, setDefectMarkers] = useState<DefectMapMarker[]>([]);
  const [selectedCoordinate, setSelectedCoordinate] = useState<Coordinate | null>(null);
  const [currentCoordinate, setCurrentCoordinate] = useState<Coordinate | null>(null);
  const [currentAccuracy, setCurrentAccuracy] = useState<number | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [mapType, setMapType] = useState<MapType>('hybrid');
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showFeederLines, setShowFeederLines] = useState(false);
  const [showSequenceWarnings, setShowSequenceWarnings] = useState(false);
  const [mapFilters, setMapFilters] = useState<MapFilters>(INITIAL_MAP_FILTERS);
  const [region, setRegion] = useState<Region>(
    hasAssetFocus
      ? createCurrentLocationRegion({
          latitude: focusLatitude as number,
          longitude: focusLongitude as number,
        })
      : DEFAULT_REGION,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const {
    mapMode,
    selectedAssetType,
    selectedInspectionStatus,
    selectedDefectSeverity,
  } = mapFilters;

  const assetsWithCoordinates = useMemo(
    () => assets.filter((asset) => getAssetCoordinate(asset) !== null),
    [assets],
  );

  const filteredAssets = useMemo(
    () =>
      shouldShowAssetsForMode(mapMode)
        ? filterAssetsForMap(assets, selectedAssetType, selectedInspectionStatus)
        : [],
    [assets, mapMode, selectedAssetType, selectedInspectionStatus],
  );

  const filteredAssetsWithCoordinates = useMemo(
    () => filteredAssets.filter((asset) => getAssetCoordinate(asset) !== null),
    [filteredAssets],
  );

  const feederAssetInputs = useMemo(
    () => filteredAssets.map(createFeederAssetInput),
    [filteredAssets],
  );

  const sequenceAssetInputs = useMemo(() => assets.map(createFeederAssetInput), [assets]);

  const feederLines = useMemo(() => buildFeederLines(feederAssetInputs), [feederAssetInputs]);

  const renderedFeederLines = useMemo(
    () => buildRenderedFeederLines(feederLines),
    [feederLines],
  );

  const sequenceValidation = useMemo(
    () => validateFeederSequences(sequenceAssetInputs),
    [sequenceAssetInputs],
  );

  const sequenceWarningMarkers = useMemo(
    () => buildSequenceWarningMarkers(assets, sequenceValidation),
    [assets, sequenceValidation],
  );

  const filteredDefectMarkers = useMemo(
    () =>
      shouldShowDefectsForMode(mapMode)
        ? filterDefectsForMap(defectMarkers, selectedDefectSeverity)
        : [],
    [defectMarkers, mapMode, selectedDefectSeverity],
  );

  const defectHeatmapPoints = useMemo(
    () =>
      filteredDefectMarkers.reduce<HeatmapPoint[]>((points, defect) => {
        if (isResolvedDefect(defect)) {
          return points;
        }

        points.push({
          latitude: defect.latitude,
          longitude: defect.longitude,
          weight: getDefectHeatmapWeight(defect),
        });

        return points;
      }, []),
    [filteredDefectMarkers],
  );

  const hasVisibleMapMarkers =
    filteredAssetsWithCoordinates.length > 0 || filteredDefectMarkers.length > 0;

  const updateMapMode = useCallback((nextMapMode: MapMode) => {
    setMapFilters((currentFilters) =>
      currentFilters.mapMode === nextMapMode
        ? currentFilters
        : {
            ...currentFilters,
            mapMode: nextMapMode,
          },
    );
  }, []);

  const setMapReference = useCallback((nextMapRef: unknown) => {
    mapRef.current = nextMapRef as MapView | null;
  }, []);

  const centerMapOnCoordinate = useCallback((coordinate: Coordinate) => {
    const nextRegion = createCurrentLocationRegion(coordinate);

    mapRef.current?.animateToRegion(nextRegion, 600);
    setRegion(nextRegion);
  }, []);

  const requestCurrentLocation = useCallback(
    async (centerMap = false) => {
      try {
        setLocationMessage(null);

        const permission = await Location.requestForegroundPermissionsAsync();

        if (permission.status !== Location.PermissionStatus.GRANTED) {
          setCurrentCoordinate(null);
          setCurrentAccuracy(null);
          setLocationMessage('Location permission denied.');
          return null;
        }

        const location = await getPositionWithTimeout({
          accuracy: Location.Accuracy.High,
        });

        if (!location) {
          setLocationMessage('Unable to get current location.');
          return null;
        }

        const nextCoordinate = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };

        setCurrentCoordinate(nextCoordinate);
        setCurrentAccuracy(location.coords.accuracy);

        if (centerMap) {
          centerMapOnCoordinate(nextCoordinate);
        }

        return nextCoordinate;
      } catch {
        setLocationMessage('Unable to get current location.');
        return null;
      }
    },
    [centerMapOnCoordinate],
  );

  const loadMapData = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      try {
        if (!silent) {
          setIsLoading(true);
        }
        setError(null);

        const assetList = await loadAssetsForMap(token, substationId, visitId);
        setAssets(assetList);

        // A silent refresh (triggered when the screen regains focus) only needs
        // the asset list to recolor inspected poles — skip the per-defect detail
        // fan-out and the region re-fit so we don't re-pay an N+1 network cost on
        // weak field links, and the user's current pan/zoom is preserved. Defect
        // markers from the initial load persist in state.
        if (!silent) {
          const nextDefectMarkers = await loadDefectMarkers(token, assetList);
          setDefectMarkers(nextDefectMarkers);

          // When opened to focus a specific asset, keep that centre — don't
          // re-fit the camera to the whole substation once the poles arrive.
          if (!hasAssetFocus) {
            const nextRegion = createRegion([
              ...assetList.map(getAssetCoordinate).filter(isCoordinate),
              ...nextDefectMarkers.map((defect) => ({
                latitude: defect.latitude,
                longitude: defect.longitude,
              })),
            ]);
            setRegion(nextRegion);
          }
        }
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          await handleUnauthorized(loadError);
          return;
        }

        setError(
          loadError instanceof Error ? loadError.message : 'Unable to load map data.',
        );
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [handleUnauthorized, hasAssetFocus, substationId, token, visitId],
  );

  // Refetch when the Map regains focus (e.g. returning after submitting an
  // inspection) so inspected poles recolor without a manual refresh. The first
  // focus does a full load with region fit; later focuses refresh silently,
  // preserving the user's current view.
  const hasFocusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (hasFocusedOnceRef.current) {
        void loadMapData({ silent: true });
      } else {
        hasFocusedOnceRef.current = true;
        void loadMapData();
      }
    }, [loadMapData]),
  );

  useEffect(() => {
    void requestCurrentLocation();
  }, [requestCurrentLocation]);

  // Surface the post-submit confirmation once, then clear it from the route so
  // it doesn't reappear when the map regains focus (e.g. after opening a pole).
  useEffect(() => {
    if (!successMessage) {
      return;
    }
    setSubmitNotice(successMessage);
    navigation.setParams({ successMessage: undefined });
  }, [successMessage, navigation]);

  // Auto-dismiss the confirmation so the map view stays clean.
  useEffect(() => {
    if (!submitNotice) {
      return;
    }
    const handle = setTimeout(() => setSubmitNotice(null), 4000);
    return () => clearTimeout(handle);
  }, [submitNotice]);

  useEffect(() => {
    // Don't yank the view to current location when we were asked to focus a
    // specific asset.
    if (
      !hasAssetFocus &&
      !isLoading &&
      currentCoordinate &&
      !hasVisibleMapMarkers
    ) {
      centerMapOnCoordinate(currentCoordinate);
    }
  }, [centerMapOnCoordinate, currentCoordinate, hasAssetFocus, hasVisibleMapMarkers, isLoading]);

  // One-shot centre on the asset passed from Asset Detail (the initial region is
  // already set to it; this re-animates once the native map is mounted).
  const hasFocusedOnAssetRef = useRef(false);
  useEffect(() => {
    if (hasFocusedOnAssetRef.current || !hasAssetFocus) {
      return;
    }
    hasFocusedOnAssetRef.current = true;
    centerMapOnCoordinate({
      latitude: focusLatitude as number,
      longitude: focusLongitude as number,
    });
  }, [centerMapOnCoordinate, focusLatitude, focusLongitude, hasAssetFocus]);

  function handleLongPress(event: LongPressEvent) {
    if (!canInspect) {
      return;
    }
    const nextCoordinate = {
      latitude: event.nativeEvent.coordinate.latitude,
      longitude: event.nativeEvent.coordinate.longitude,
    };

    setSelectedCoordinate(nextCoordinate);
    setRegion((currentRegion) => ({
      ...currentRegion,
      latitude: nextCoordinate.latitude,
      longitude: nextCoordinate.longitude,
    }));
  }

  // Drop a draggable pin at the current map centre (region tracks the centre via
  // onRegionChangeComplete) so adding an asset is "drop + drag to place" rather
  // than hunting for a spot to long-press. Long-press still works as a shortcut.
  function handleDropPinAtCentre() {
    if (!canInspect) {
      return;
    }
    setSelectedCoordinate({
      latitude: region.latitude,
      longitude: region.longitude,
    });
  }

  const mapMarkers = useMemo(() => {
    const markers = filteredAssets.flatMap((asset) => {
      const coordinate = getAssetCoordinate(asset);

      if (!coordinate) {
        return [];
      }

      const focused = Boolean(focusAssetId && asset.id === focusAssetId);
      const markerColor = assetMarkerColor(asset);

      return [
        <AssetMarker
          // Colour + focus are in the key so a recolour (after inspecting) or a
          // focus change remounts the marker and re-snapshots its custom view.
          key={`asset-${asset.id}-${markerColor}-${focused ? 'focused' : ''}`}
          coordinate={coordinate}
          color={markerColor}
          // Highlight the asset we were opened to focus (from Asset Detail) so
          // it's distinguishable from its neighbours, and draw it on top.
          focused={focused}
          title={asset.assetCode}
          description={asset.name ?? asset.assetType.name}
          onPress={() => handleOpenAssetDetail(asset)}
        />,
      ];
    });

    if (!showHeatmap) {
      markers.push(
        ...filteredDefectMarkers.map((defect) => (
          <Marker
            key={`defect-${defect.id}`}
            coordinate={{
              latitude: defect.latitude,
              longitude: defect.longitude,
            }}
            anchor={{ x: 0.5, y: 1 }}
            centerOffset={{ x: 0, y: -20 }}
          >
            <DefectMarkerView defect={defect} />
            <Callout onPress={() => handleOpenDefectDetail(defect.id)}>
              <DefectCallout defect={defect} />
            </Callout>
          </Marker>
        )),
      );
    }

    if (showSequenceWarnings) {
      markers.push(
        ...sequenceWarningMarkers.map((warning) => (
          <Marker
            key={`sequence-warning-${warning.assetId}`}
            coordinate={warning.coordinate}
            anchor={{ x: 0.5, y: 1 }}
            centerOffset={{ x: 0, y: -18 }}
          >
            <SequenceWarningMarkerView />
            <Callout>
              <SequenceWarningCallout warning={warning} />
            </Callout>
          </Marker>
        )),
      );
    }

    if (selectedCoordinate) {
      markers.push(
        <Marker
          key="temporary-add-asset-pin"
          coordinate={selectedCoordinate}
          draggable
          title="New asset location"
          description="Confirm below to add an asset here."
          pinColor="#10b981"
          onDragEnd={(event) => setSelectedCoordinate(event.nativeEvent.coordinate)}
        />,
      );
    }

    return markers;
  }, [
    filteredAssets,
    filteredDefectMarkers,
    focusAssetId,
    handleOpenAssetDetail,
    handleOpenDefectDetail,
    selectedCoordinate,
    sequenceWarningMarkers,
    showHeatmap,
    showSequenceWarnings,
  ]);

  return (
    <Screen
      title="Map"
      leftAction={{
        icon: canOpenDrawer ? 'menu' : 'back',
        onPress: () =>
          canOpenDrawer
            ? (navigation as { openDrawer: () => void }).openDrawer()
            : navigation.goBack(),
        accessibilityLabel: canOpenDrawer ? 'Menu' : 'Back',
      }}
      rightAction={{
        icon: 'refresh',
        onPress: () => loadMapData(),
        accessibilityLabel: 'Refresh',
        disabled: isLoading,
      }}
      scroll={false}
    >
      <ErrorBanner message={error} />
      <SuccessBanner message={submitNotice} />

      <View style={styles.mapSummary}>
        <Text style={styles.mapSummaryText}>
          Assets: {filteredAssetsWithCoordinates.length}/{assetsWithCoordinates.length}
        </Text>
        <Text style={styles.mapSummaryText}>
          Defects: {filteredDefectMarkers.length}/{defectMarkers.length}
        </Text>
      </View>

      <View style={styles.mapShell}>
        {isLoading ? (
          <View style={styles.mapLoadingState}>
            <LoadingBlock label="Loading asset map..." />
          </View>
        ) : (
          <MapView
            ref={setMapReference}
            provider={PROVIDER_GOOGLE}
            style={{ flex: 1 }}
            region={region}
            mapType={mapType}
            showsUserLocation={true}
            showsMyLocationButton={false}
            followsUserLocation={false}
            onRegionChangeComplete={setRegion}
            onLongPress={handleLongPress}
          >
            {showHeatmap && defectHeatmapPoints.length > 0 ? (
              <Heatmap
                points={defectHeatmapPoints}
                gradient={DEFECT_HEATMAP_GRADIENT}
                radius={DEFECT_HEATMAP_RADIUS}
                opacity={DEFECT_HEATMAP_OPACITY}
              />
            ) : null}
            {showFeederLines &&
              renderedFeederLines.map((line) => (
                <Polyline
                  key={`feeder-line-${line.id}`}
                  coordinates={line.displayCoordinates}
                  strokeColor={getFeederLineColor(line.feeder)}
                  strokeWidth={3}
                  zIndex={4}
                />
              ))}
            {mapMarkers}
          </MapView>
        )}

        {/* Aiming crosshair: "Drop Pin to Add Asset" captures the map centre, so
            show a fixed centre target while no pin is placed yet. */}
        {!isLoading && !selectedCoordinate ? <MapCrosshair /> : null}

        {!isLoading ? (
          <>
            <MapControlDeck
              mapMode={mapMode}
              onChangeMapMode={updateMapMode}
              mapType={mapType}
              onChangeMapType={setMapType}
              showHeatmap={showHeatmap}
              showFeederLines={showFeederLines}
              showSequenceWarnings={showSequenceWarnings}
              onToggleHeatmap={() => setShowHeatmap((currentValue) => !currentValue)}
              onToggleFeederLines={() => setShowFeederLines((currentValue) => !currentValue)}
              onToggleSequenceWarnings={() =>
                setShowSequenceWarnings((currentValue) => !currentValue)
              }
              currentAccuracy={currentAccuracy}
              locationMessage={locationMessage}
              onRequestCurrentLocation={() => {
                void requestCurrentLocation(true);
              }}
            />
          </>
        ) : null}

        {canInspect && selectedCoordinate ? (
          <View style={styles.selectedPinPanel}>
            <Text style={styles.selectedPinTitle}>Drag pin to adjust location</Text>
            <BodyText muted>
              {selectedCoordinate.latitude.toFixed(6)}, {selectedCoordinate.longitude.toFixed(6)}
            </BodyText>
            <AppButton
              label="Add Asset Here"
              onPress={() =>
                navigation.navigate('AddAsset', {
                  visitId,
                  substationId,
                  initialLatitude: selectedCoordinate.latitude,
                  initialLongitude: selectedCoordinate.longitude,
                })
              }
            />
            <AppButton
              label="Clear Pin"
              variant="ghost"
              onPress={() => setSelectedCoordinate(null)}
            />
          </View>
        ) : null}

        {canInspect && !isLoading && !selectedCoordinate ? (
          <View style={styles.selectedPinPanel}>
            <AppButton label="Drop Pin to Add Asset" onPress={handleDropPinAtCentre} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function MapControlDeck({
  mapMode,
  onChangeMapMode,
  mapType,
  onChangeMapType,
  showHeatmap,
  showFeederLines,
  showSequenceWarnings,
  onToggleHeatmap,
  onToggleFeederLines,
  onToggleSequenceWarnings,
  currentAccuracy,
  locationMessage,
  onRequestCurrentLocation,
}: MapControlDeckProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [openMenu, setOpenMenu] = useState<MapControlMenu>(null);
  const hasActiveLayers = showHeatmap || showFeederLines || showSequenceWarnings;
  const mapTypeLabel = mapType === 'hybrid' ? 'Sat' : 'Map';

  function toggleMenu(nextMenu: Exclude<MapControlMenu, null>) {
    setOpenMenu((currentMenu) => (currentMenu === nextMenu ? null : nextMenu));
  }

  return (
    <View pointerEvents="box-none" style={styles.mapControlsOverlay}>
      <View style={styles.mapControlsStack}>
        <View style={styles.mapControlRail}>
          <MapFilterBar mapMode={mapMode} onChangeMapMode={onChangeMapMode} />

          <View style={styles.mapControlActions}>
            <MapMenuButton
              label="Layers"
              isActive={openMenu === 'layers' || hasActiveLayers}
              onPress={() => toggleMenu('layers')}
            />
            <MapMenuButton
              label={mapTypeLabel}
              isActive={openMenu === 'mapType'}
              onPress={() => toggleMenu('mapType')}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="My Location"
              onPress={onRequestCurrentLocation}
              hitSlop={6}
              style={({ pressed }) => [
                styles.locationButton,
                pressed ? styles.mapControlPressed : null,
              ]}
            >
              <Text style={styles.locationButtonText}>GPS</Text>
            </Pressable>
          </View>
        </View>

        {openMenu === 'layers' ? (
          <View style={styles.mapDropdownPanel}>
            <MapLayerMenuOption
              label="Heatmap"
              isActive={showHeatmap}
              activeColor="#166534"
              onPress={onToggleHeatmap}
            />
            <MapLayerMenuOption
              label="Lines"
              isActive={showFeederLines}
              activeColor="#0f5cd8"
              onPress={onToggleFeederLines}
            />
            <MapLayerMenuOption
              label="Warnings"
              isActive={showSequenceWarnings}
              activeColor="#b45309"
              onPress={onToggleSequenceWarnings}
            />
          </View>
        ) : null}

        {openMenu === 'mapType' ? (
          <View style={styles.mapDropdownPanel}>
            <MapTypeMenuOption
              label="Map"
              isActive={mapType === 'standard'}
              onPress={() => {
                onChangeMapType('standard');
                setOpenMenu(null);
              }}
            />
            <MapTypeMenuOption
              label="Satellite"
              isActive={mapType === 'hybrid'}
              onPress={() => {
                onChangeMapType('hybrid');
                setOpenMenu(null);
              }}
            />
          </View>
        ) : null}

        {currentAccuracy !== null || locationMessage ? (
          <View style={styles.mapStatusPanel}>
            {currentAccuracy !== null ? (
              <View style={styles.locationStatusPill}>
                <Text style={styles.locationStatusText}>
                  Accuracy {Math.round(currentAccuracy)}m
                </Text>
              </View>
            ) : null}

            {locationMessage ? (
              <View style={[styles.locationStatusPill, styles.locationStatusPillError]}>
                <Text style={[styles.locationStatusText, styles.locationStatusTextError]}>
                  {locationMessage}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function MapFilterBar({
  mapMode,
  onChangeMapMode,
}: {
  mapMode: MapMode;
  onChangeMapMode: (nextMapMode: MapMode) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.filterBar}>
      {MAP_MODE_OPTIONS.map((option) => {
        const isActive = mapMode === option.value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            onPress={() => onChangeMapMode(option.value)}
            hitSlop={4}
            style={({ pressed }) => [
              styles.filterButton,
              isActive ? styles.filterButtonActive : null,
              pressed ? styles.filterButtonPressed : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.filterButtonText, isActive ? styles.filterButtonTextActive : null]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MapMenuButton({
  label,
  isActive,
  onPress,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.mapMenuButton,
        isActive ? styles.mapMenuButtonActive : null,
        pressed && styles.mapControlPressed,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.mapMenuButtonText, isActive ? styles.mapMenuButtonTextActive : null]}
      >
        {label} v
      </Text>
    </Pressable>
  );
}

function MapLayerMenuOption({
  label,
  isActive,
  activeColor,
  onPress,
}: {
  label: string;
  isActive: boolean;
  activeColor: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: isActive }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.mapDropdownOption,
        pressed && styles.mapControlPressed,
      ]}
    >
      <View style={[styles.mapDropdownCheck, isActive ? { backgroundColor: activeColor } : null]} />
      <Text style={styles.mapDropdownOptionText}>{label}</Text>
      <Text
        style={[
          styles.mapDropdownStateText,
          isActive ? styles.mapDropdownStateTextActive : null,
        ]}
      >
        {isActive ? 'On' : 'Off'}
      </Text>
    </Pressable>
  );
}

function MapTypeMenuOption({
  label,
  isActive,
  onPress,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.mapDropdownOption,
        isActive ? styles.mapDropdownOptionSelected : null,
        pressed && styles.mapControlPressed,
      ]}
    >
      <View
        style={[
          styles.mapDropdownCheck,
          isActive ? styles.mapDropdownCheckSelected : null,
        ]}
      />
      <Text style={styles.mapDropdownOptionText}>{label}</Text>
    </Pressable>
  );
}

function SequenceWarningMarkerView() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.sequenceWarningMarkerContainer}>
      <View style={styles.sequenceWarningMarkerBadge}>
        <Text style={styles.sequenceWarningMarkerIcon}>⚠</Text>
      </View>
      <View style={styles.sequenceWarningMarkerPointer} />
    </View>
  );
}

function SequenceWarningCallout({ warning }: { warning: SequenceWarningMarker }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.sequenceWarningCallout}>
      <Text style={styles.sequenceWarningCalloutTitle}>{warning.assetCode}</Text>
      {warning.messages.map((message, index) => (
        <Text
          key={`${warning.assetId}-warning-${index}`}
          style={styles.sequenceWarningCalloutMessage}
        >
          {message}
        </Text>
      ))}
    </View>
  );
}

// Centre the dot exactly on the coordinate (unlike a teardrop pin whose tip
// marks the spot), so a small dot still reads as "this pole is here".
const ASSET_MARKER_ANCHOR = { x: 0.5, y: 0.5 };

function AssetMarker({
  coordinate,
  color,
  focused,
  title,
  description,
  onPress,
}: {
  coordinate: Coordinate;
  color: string;
  focused: boolean;
  title?: string;
  description?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // Snapshot the dot once it has laid out, then stop tracking so a substation
  // full of poles doesn't continuously re-rasterize every marker (the default
  // custom-marker behaviour, which lags on field devices). The marker's key
  // includes colour + focus, so a recolour remounts it and re-snapshots.
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  useEffect(() => {
    const handle = setTimeout(() => setTracksViewChanges(false), 250);
    return () => clearTimeout(handle);
  }, []);

  return (
    <Marker
      coordinate={coordinate}
      anchor={ASSET_MARKER_ANCHOR}
      title={title}
      description={description}
      tracksViewChanges={tracksViewChanges}
      zIndex={focused ? 10 : undefined}
      onPress={onPress}
    >
      <View style={styles.assetMarkerHitbox}>
        <View
          style={[
            styles.assetMarkerDot,
            { backgroundColor: color },
            focused && styles.assetMarkerDotFocused,
          ]}
        />
      </View>
    </Marker>
  );
}

function DefectMarkerView({ defect }: { defect: DefectMapMarker }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const markerColor = getDefectMarkerColor(defect);
  const markerTextColor = getDefectMarkerTextColor(defect);

  return (
    <View style={styles.defectMarkerContainer}>
      <View style={[styles.defectMarkerHalo, { borderColor: markerColor }]}>
        <View style={[styles.defectMarkerBadge, { backgroundColor: markerColor }]}>
          <Text style={[styles.defectMarkerIcon, { color: markerTextColor }]}>!</Text>
        </View>
      </View>
      <View style={[styles.defectMarkerPointer, { borderTopColor: markerColor }]} />
    </View>
  );
}

function DefectCallout({ defect }: { defect: DefectMapMarker }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const description = createDefectDescriptionPreview(defect);

  return (
    <View style={styles.defectCallout}>
      <Text style={styles.defectCalloutTitle}>{getDefectTitle(defect)}</Text>
      <View style={styles.defectCalloutRow}>
        <Text style={styles.defectCalloutLabel}>Severity</Text>
        <Text style={[styles.defectCalloutValue, { color: getDefectMarkerColor(defect) }]}>
          {getDefectSeverityLabel(defect)}
        </Text>
      </View>
      <View style={styles.defectCalloutRow}>
        <Text style={styles.defectCalloutLabel}>Status</Text>
        <Text style={styles.defectCalloutValue}>{formatDefectStatus(defect.status)}</Text>
      </View>
      <View style={styles.defectCalloutRow}>
        <Text style={styles.defectCalloutLabel}>Asset</Text>
        <Text style={styles.defectCalloutValue}>{getDefectLinkedAssetLabel(defect)}</Text>
      </View>
      {description ? (
        <View style={styles.defectCalloutDescriptionGroup}>
          <Text style={styles.defectCalloutLabel}>Description</Text>
          <Text style={styles.defectCalloutDescription}>{description}</Text>
        </View>
      ) : null}
    </View>
  );
}

async function loadAssetsForMap(token: string, substationId?: string, visitId?: string) {
  // Cache each map's asset set so the map renders its poles offline (serves the
  // last snapshot when the server is unreachable).
  if (substationId && visitId) {
    return (
      await cachedFetch('map-visit-assets', `${visitId}:${substationId}`, () =>
        api.getAssetsForVisit(token, visitId, substationId),
      )
    ).value;
  }

  if (substationId) {
    return (await cachedFetch('assets', substationId, () => api.getAssets(token, substationId)))
      .value;
  }

  return (
    await cachedFetch('map-all-assets', undefined, async () => {
      const substations = await api.getSubstations(token);
      const assetGroups = await Promise.all(
        substations.map((substation) => api.getAssets(token, substation.id)),
      );

      return assetGroups.flat();
    })
  ).value;
}

async function loadDefectMarkers(token: string, assets: Asset[]) {
  try {
    const assetLookup = new Map(assets.map((asset) => [asset.id, asset]));
    const { value: defects } = await cachedFetch('defects', undefined, () => api.getDefects(token));
    const relevantDefects = defects.filter((defect) => assetLookup.has(defect.assetId));
    const markers = await Promise.all(
      // The defect overlay is secondary — never let one marker (or an offline
      // gap) break the pole map; drop markers that can't resolve.
      relevantDefects.map((defect) =>
        createDefectMarker(token, defect, assetLookup).catch(() => null),
      ),
    );

    return markers.filter(isDefectMapMarker);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }

    return [];
  }
}

function buildSequenceWarningMarkers(
  assets: Asset[],
  sequenceValidation: SequenceValidationResult,
): SequenceWarningMarker[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const assetIdsByKey = new Map<string, string[]>();
  const warningsByAssetId = new Map<string, SequenceWarningMarker>();

  for (const entry of sequenceValidation.entries) {
    if (!entry.parsed.normalizedKey) {
      continue;
    }

    const assetIds = assetIdsByKey.get(entry.parsed.normalizedKey) ?? [];

    if (!assetIds.includes(entry.assetId)) {
      assetIds.push(entry.assetId);
    }

    assetIdsByKey.set(entry.parsed.normalizedKey, assetIds);
  }

  for (const issue of sequenceValidation.issues) {
    const targetAssetIds = getSequenceWarningTargetAssetIds(issue, assetIdsByKey);

    for (const assetId of targetAssetIds) {
      const asset = assetsById.get(assetId);
      const coordinate = getAssetCoordinate(asset);

      if (!asset || !coordinate) {
        continue;
      }

      const existingWarning = warningsByAssetId.get(assetId);

      if (existingWarning) {
        addUniqueMessage(existingWarning.messages, issue.message);
        continue;
      }

      warningsByAssetId.set(assetId, {
        assetId,
        assetCode: getAssetWarningCode(asset),
        coordinate,
        messages: [issue.message],
      });
    }
  }

  return Array.from(warningsByAssetId.values()).sort((left, right) =>
    left.assetCode.localeCompare(right.assetCode),
  );
}

function createFeederAssetInput(asset: Asset): AssetLike {
  const assetWithFlexibleCodeFields = asset as Asset & {
    code?: string | number | null;
    noTiangRondaan?: string | number | null;
  };

  return {
    id: asset.id,
    name: asset.name,
    code: assetWithFlexibleCodeFields.code ?? asset.assetCode,
    assetCode: asset.assetCode,
    noTiangRondaan: assetWithFlexibleCodeFields.noTiangRondaan ?? asset.assetCode,
    latitude: asset.latitude,
    longitude: asset.longitude,
  };
}

function getSequenceWarningTargetAssetIds(
  issue: SequenceValidationResult['issues'][number],
  assetIdsByKey: Map<string, string[]>,
) {
  const assetIds: string[] = [];

  for (const assetId of issue.assetIds ?? []) {
    addUniqueMessage(assetIds, assetId);
  }

  if (issue.assetId) {
    addUniqueMessage(assetIds, issue.assetId);
  }

  if (assetIds.length === 0 && issue.key) {
    for (const assetId of assetIdsByKey.get(issue.key) ?? []) {
      addUniqueMessage(assetIds, assetId);
    }
  }

  return assetIds;
}

function getAssetWarningCode(asset: Asset) {
  return normalizeDisplayText(asset.assetCode) ?? normalizeDisplayText(asset.name) ?? `Asset ${asset.id}`;
}

function getFeederLineColor(feeder: string): string {
  const normalizedFeeder = normalizeDisplayText(feeder)?.toUpperCase() ?? '';
  const configuredColor = FEEDER_LINE_COLORS[normalizedFeeder];

  if (configuredColor) {
    return configuredColor;
  }

  if (!normalizedFeeder) {
    return FALLBACK_FEEDER_LINE_COLORS[0];
  }

  let hash = 0;

  for (let index = 0; index < normalizedFeeder.length; index += 1) {
    hash = (hash * 31 + normalizedFeeder.charCodeAt(index)) | 0;
  }

  return FALLBACK_FEEDER_LINE_COLORS[Math.abs(hash) % FALLBACK_FEEDER_LINE_COLORS.length];
}

function offsetLineCoordinates(
  coords: { latitude: number; longitude: number }[],
  offsetIndex: number,
): { latitude: number; longitude: number }[] {
  if (offsetIndex <= 0 || coords.length < 2) {
    return coords.map((coordinate) => ({ ...coordinate }));
  }

  const firstCoordinate = coords[0];
  const lastCoordinate = coords[coords.length - 1];
  const dx = lastCoordinate.longitude - firstCoordinate.longitude;
  const dy = lastCoordinate.latitude - firstCoordinate.latitude;
  const lineLength = Math.sqrt(dx * dx + dy * dy);
  const offsetAmount = FEEDER_LINE_OFFSET_AMOUNT * offsetIndex;

  if (lineLength === 0) {
    return coords.map((coordinate) => ({
      latitude: coordinate.latitude + offsetAmount,
      longitude: coordinate.longitude,
    }));
  }

  const normalizedDx = dx / lineLength;
  const normalizedDy = dy / lineLength;
  const perpX = -normalizedDy;
  const perpY = normalizedDx;
  const perpendicularLength = Math.sqrt(perpX * perpX + perpY * perpY);
  const normalizedPerpX = perpendicularLength === 0 ? 0 : perpX / perpendicularLength;
  const normalizedPerpY = perpendicularLength === 0 ? 0 : perpY / perpendicularLength;

  return coords.map((coordinate) => ({
    latitude: coordinate.latitude + normalizedPerpY * offsetAmount,
    longitude: coordinate.longitude + normalizedPerpX * offsetAmount,
  }));
}

function buildRenderedFeederLines(feederLines: MapFeederLine[]): RenderedFeederLine[] {
  const drawableLines = feederLines.filter(isDrawableFeederLine);
  const linesByCoordinates = new Map<string, DrawableMapFeederLine[]>();
  const renderedLines: RenderedFeederLine[] = [];

  for (const line of drawableLines) {
    const coordinateKey = getLineCoordinateKey(line.coordinates);
    const matchingLines = linesByCoordinates.get(coordinateKey) ?? [];
    matchingLines.push(line);
    linesByCoordinates.set(coordinateKey, matchingLines);
  }

  for (const matchingLines of linesByCoordinates.values()) {
    const sortedLines = matchingLines.slice().sort(compareFeederLinesForOffset);
    const uniqueFeeders = getUniqueSortedFeeders(sortedLines);

    for (const line of sortedLines) {
      const offsetIndex = Math.max(uniqueFeeders.indexOf(line.feeder), 0);

      renderedLines.push({
        ...line,
        displayCoordinates: offsetLineCoordinates(line.coordinates, offsetIndex),
      });
    }
  }

  return renderedLines.sort(compareFeederLinesForOffset);
}

function getLineCoordinateKey(coords: [Coordinate, Coordinate]): string {
  const firstKey = getCoordinateKey(coords[0]);
  const secondKey = getCoordinateKey(coords[1]);

  return firstKey <= secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
}

function getCoordinateKey(coordinate: Coordinate): string {
  return `${coordinate.latitude.toFixed(7)},${coordinate.longitude.toFixed(7)}`;
}

function getUniqueSortedFeeders(lines: DrawableMapFeederLine[]): string[] {
  return Array.from(new Set(lines.map((line) => line.feeder))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function compareFeederLinesForOffset(left: MapFeederLine, right: MapFeederLine): number {
  const feederComparison = left.feeder.localeCompare(right.feeder);

  if (feederComparison !== 0) {
    return feederComparison;
  }

  return left.id.localeCompare(right.id);
}

function shouldShowAssetsForMode(mapMode: MapMode) {
  return mapMode === 'assets';
}

function shouldShowDefectsForMode(mapMode: MapMode) {
  return mapMode === 'defects';
}

function filterAssetsForMap(
  assets: Asset[],
  selectedAssetType: MapFilterValue,
  selectedInspectionStatus: MapFilterValue,
) {
  return assets.filter(
    (asset) =>
      matchesAssetTypeFilter(asset, selectedAssetType) &&
      matchesFilterValue(getAssetInspectionStatusFilterValue(asset), selectedInspectionStatus),
  );
}

function filterDefectsForMap(
  defects: DefectMapMarker[],
  selectedDefectSeverity: MapFilterValue,
) {
  return defects.filter((defect) =>
    matchesFilterValue(getDefectSeverityFilterValue(defect), selectedDefectSeverity),
  );
}

function matchesAssetTypeFilter(asset: Asset, selectedAssetType: MapFilterValue) {
  if (selectedAssetType === ALL_FILTER_VALUE) {
    return true;
  }

  return [
    asset.assetTypeId,
    asset.assetType.id,
    asset.assetType.code,
    asset.assetType.name,
  ].some((filterValue) => matchesFilterValue(filterValue, selectedAssetType));
}

function getAssetInspectionStatusFilterValue(asset: Asset) {
  const filterableAsset = asset as AssetMapFilterData;

  return (
    filterableAsset.inspectionStatus ??
    filterableAsset.latestInspectionStatus ??
    filterableAsset.latestInspection?.completionStatus ??
    filterableAsset.latestInspection?.status ??
    null
  );
}

function getDefectSeverityFilterValue(defect: DefectMapMarker) {
  const filterableDefect = defect as DefectMapFilterData;

  return filterableDefect.severity ?? filterableDefect.defectSeverity ?? defect.priority ?? null;
}

function matchesFilterValue(value: unknown, selectedValue: MapFilterValue) {
  if (selectedValue === ALL_FILTER_VALUE) {
    return true;
  }

  const normalizedValue = normalizeFilterValue(value);
  const normalizedSelectedValue = normalizeFilterValue(selectedValue);

  return (
    normalizedValue !== null &&
    normalizedSelectedValue !== null &&
    normalizedValue === normalizedSelectedValue
  );
}

function normalizeFilterValue(value: unknown) {
  if (typeof value === 'number') {
    return String(value).trim().toLowerCase();
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();

  return trimmedValue ? trimmedValue.toLowerCase() : null;
}

async function createDefectMarker(
  token: string,
  defect: DefectListItem,
  assetLookup: Map<string, Asset>,
): Promise<DefectMapMarker | null> {
  try {
    const detail = await api.getDefectDetail(token, defect.id);
    const asset = assetLookup.get(defect.assetId);
    const detailExtraData = detail as DefectDetail & DefectMapExtraData;
    const defectExtraData = defect as DefectListItem & DefectMapExtraData;
    const imageCoordinate = getFirstImageCoordinate(detail);
    const assetCoordinate = getAssetCoordinate(asset);
    const coordinate = imageCoordinate ?? assetCoordinate;

    if (!coordinate) {
      return null;
    }

    return {
      ...defect,
      assetCode: defect.assetCode ?? detail.assetCode ?? asset?.assetCode,
      assetName: asset?.name ?? null,
      assetType: defect.assetType ?? detail.assetType ?? asset?.assetType.name,
      checklistRemark: detail.checklistRemark,
      severity: detailExtraData.severity ?? defectExtraData.severity ?? null,
      defectSeverity: detailExtraData.defectSeverity ?? defectExtraData.defectSeverity ?? null,
      priority: detailExtraData.priority ?? defectExtraData.priority ?? null,
      description: detailExtraData.description ?? defectExtraData.description ?? null,
      shortDescription: detailExtraData.shortDescription ?? defectExtraData.shortDescription ?? null,
      code: detailExtraData.code ?? defectExtraData.code ?? null,
      defectCode: detailExtraData.defectCode ?? defectExtraData.defectCode ?? null,
      defectTitle: detailExtraData.defectTitle ?? defectExtraData.defectTitle ?? null,
      title: detailExtraData.title ?? defectExtraData.title ?? null,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }

    return null;
  }
}

function getFirstImageCoordinate(detail: DefectDetail) {
  for (const image of detail.images) {
    const coordinate = createCoordinate(image.latitude, image.longitude);

    if (coordinate) {
      return coordinate;
    }
  }

  return null;
}

function getAssetCoordinate(asset?: Asset) {
  if (!asset) {
    return null;
  }

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

function createCurrentLocationRegion(coordinate: Coordinate): Region {
  return {
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    latitudeDelta: CURRENT_LOCATION_REGION_DELTA,
    longitudeDelta: CURRENT_LOCATION_REGION_DELTA,
  };
}

function createRegion(coordinates: Coordinate[]) {
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

function getDefectMarkerColor(defect: DefectMapMarker) {
  if (isResolvedDefect(defect)) {
    return '#6b7280';
  }

  switch (getDefectSeverity(defect)) {
    case 'critical':
    case 'high':
      return '#dc2626';
    case 'medium':
      return '#f97316';
    case 'low':
      return '#facc15';
    default:
      return '#f97316';
  }
}

function getDefectMarkerTextColor(defect: DefectMapMarker) {
  return !isResolvedDefect(defect) && getDefectSeverity(defect) === 'low' ? '#111827' : '#ffffff';
}

function getDefectSeverityLabel(defect: DefectMapMarker) {
  switch (getDefectSeverity(defect)) {
    case 'critical':
      return 'Critical';
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    default:
      return 'Unspecified';
  }
}

function getDefectHeatmapWeight(defect: DefectMapMarker) {
  switch (getDefectSeverity(defect)) {
    case 'critical':
      return 1;
    case 'high':
      return 0.8;
    case 'medium':
      return 0.5;
    case 'low':
      return 0.2;
    default:
      return 0.5;
  }
}

function getDefectSeverity(defect: DefectMapMarker): DefectSeverity {
  const normalizedSeverity = normalizeDefectValue(
    defect.severity ?? defect.defectSeverity ?? defect.priority,
  );

  if (!normalizedSeverity) {
    return 'unknown';
  }

  if (
    normalizedSeverity === 'critical' ||
    normalizedSeverity === 'crit' ||
    normalizedSeverity === 'severe' ||
    normalizedSeverity.includes('critical')
  ) {
    return 'critical';
  }

  if (
    normalizedSeverity === 'high' ||
    normalizedSeverity === 'major' ||
    normalizedSeverity.includes('high')
  ) {
    return 'high';
  }

  if (
    normalizedSeverity === 'medium' ||
    normalizedSeverity === 'moderate' ||
    normalizedSeverity === 'med' ||
    normalizedSeverity.includes('medium')
  ) {
    return 'medium';
  }

  if (
    normalizedSeverity === 'low' ||
    normalizedSeverity === 'minor' ||
    normalizedSeverity.includes('low')
  ) {
    return 'low';
  }

  return 'unknown';
}

function isResolvedDefect(defect: DefectMapMarker) {
  const normalizedStatus = normalizeDefectValue(defect.status);

  return normalizedStatus === 'closed' || normalizedStatus === 'resolved';
}

function getDefectTitle(defect: DefectMapMarker) {
  const code = normalizeDisplayText(defect.defectCode ?? defect.code);
  const title =
    normalizeDisplayText(defect.defectTitle ?? defect.title) ?? normalizeDisplayText(defect.label);

  if (code && title && code !== title) {
    return `${code} - ${title}`;
  }

  return title ?? code ?? `Defect ${defect.id.slice(0, 8)}`;
}

function getDefectLinkedAssetLabel(defect: DefectMapMarker) {
  const assetName = normalizeDisplayText(defect.assetName);
  const assetCode = normalizeDisplayText(defect.assetCode);

  if (assetName && assetCode && assetName !== assetCode) {
    return `${assetName} (${assetCode})`;
  }

  return assetName ?? assetCode ?? 'Unknown asset';
}

function createDefectDescriptionPreview(defect: DefectMapMarker) {
  const description = normalizeDisplayText(
    defect.shortDescription ?? defect.description ?? defect.remark ?? defect.checklistRemark,
  );

  if (!description) {
    return null;
  }

  return description.length > 140 ? `${description.slice(0, 137).trim()}...` : description;
}

function formatDefectStatus(status: string) {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeDisplayText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeDefectValue(value: unknown) {
  return normalizeDisplayText(value)?.toLowerCase().replace(/[\s-]+/g, '_') ?? null;
}

function isDrawableFeederLine(line: MapFeederLine): line is DrawableMapFeederLine {
  return (
    Array.isArray(line.coordinates) &&
    line.coordinates.length === 2 &&
    line.coordinates.every(isCoordinate)
  );
}

function isCoordinate(value: unknown): value is Coordinate {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const coordinate = value as Partial<Coordinate>;

  return (
    typeof coordinate.latitude === 'number' &&
    typeof coordinate.longitude === 'number' &&
    Number.isFinite(coordinate.latitude) &&
    Number.isFinite(coordinate.longitude)
  );
}

function isDefectMapMarker(value: DefectMapMarker | null): value is DefectMapMarker {
  return value !== null;
}

function addUniqueMessage(messages: string[], message: string) {
  if (!messages.includes(message)) {
    messages.push(message);
  }
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    mapSummary: {
      backgroundColor: t.colors.card,
      borderRadius: t.radius.card,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    mapSummaryText: {
      fontSize: 13,
      color: t.colors.textSecondary,
      fontWeight: '600',
    },
    mapShell: {
      flex: 1,
      minHeight: 420,
      borderRadius: t.radius.card,
      overflow: 'hidden',
    },
    mapLoadingState: {
      flex: 1,
      minHeight: 420,
      backgroundColor: t.colors.background,
      justifyContent: 'center',
    },
    mapControlsOverlay: {
      position: 'absolute',
      top: 10,
      left: 10,
      right: 10,
      alignItems: 'flex-start',
    },
    mapControlsStack: {
      width: '100%',
      maxWidth: 340,
      gap: 6,
    },
    mapControlRail: {
      maxWidth: 340,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: t.colors.card,
      borderRadius: MAP_CONTROL_RADIUS,
      borderWidth: 1,
      borderColor: t.colors.border,
      padding: 6,
      shadowColor: t.colors.shadow,
      shadowOffset: {
        width: 0,
        height: 3,
      },
      shadowOpacity: 0.1,
      shadowRadius: 7,
      elevation: 2,
    },
    filterBar: {
      flex: 1,
      minWidth: 104,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    filterButton: {
      flex: 1,
      minWidth: 0,
      minHeight: 34,
      borderRadius: MAP_CONTROL_RADIUS,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
      paddingHorizontal: 8,
      paddingVertical: 7,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterButtonActive: {
      backgroundColor: t.colors.primary,
      borderColor: t.colors.primary,
    },
    filterButtonPressed: {
      opacity: 0.82,
    },
    filterButtonText: {
      color: t.colors.textPrimary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      flexShrink: 1,
    },
    filterButtonTextActive: {
      color: t.colors.textOnPrimary,
    },
    mapControlActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    mapMenuButton: {
      minHeight: 34,
      minWidth: 48,
      borderRadius: MAP_CONTROL_RADIUS,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 7,
      paddingVertical: 7,
    },
    mapMenuButtonActive: {
      backgroundColor: t.colors.primary,
      borderColor: t.colors.primary,
    },
    mapMenuButtonText: {
      color: t.colors.textPrimary,
      fontSize: 11,
      lineHeight: 16,
      fontWeight: '700',
      flexShrink: 1,
    },
    mapMenuButtonTextActive: {
      color: t.colors.textOnPrimary,
    },
    mapDropdownPanel: {
      alignSelf: 'flex-end',
      width: 190,
      backgroundColor: t.colors.card,
      borderRadius: MAP_CONTROL_RADIUS,
      borderWidth: 1,
      borderColor: t.colors.border,
      padding: 6,
      gap: 4,
      shadowColor: t.colors.shadow,
      shadowOffset: {
        width: 0,
        height: 4,
      },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 3,
    },
    mapDropdownOption: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: MAP_CONTROL_RADIUS,
      paddingHorizontal: 9,
      paddingVertical: 8,
    },
    mapDropdownOptionSelected: {
      backgroundColor: t.colors.surfacePressed,
    },
    mapDropdownCheck: {
      width: 14,
      height: 14,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: 'transparent',
    },
    mapDropdownCheckSelected: {
      backgroundColor: t.colors.primary,
      borderColor: t.colors.primary,
    },
    mapDropdownOptionText: {
      flex: 1,
      color: t.colors.textPrimary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '700',
    },
    mapDropdownStateText: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
    },
    mapDropdownStateTextActive: {
      color: t.colors.textPrimary,
    },
    mapControlPressed: {
      opacity: 0.82,
    },
    mapStatusPanel: {
      alignSelf: 'flex-start',
      maxWidth: 300,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 5,
      backgroundColor: t.colors.card,
      borderRadius: MAP_CONTROL_RADIUS,
      borderWidth: 1,
      borderColor: t.colors.border,
      padding: 5,
      shadowColor: t.colors.shadow,
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.08,
      shadowRadius: 5,
      elevation: 1,
    },
    locationButton: {
      width: 34,
      minHeight: 34,
      borderRadius: MAP_CONTROL_RADIUS,
      borderWidth: 1,
      borderColor: t.colors.primary,
      backgroundColor: t.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 5,
      paddingVertical: 7,
    },
    locationButtonText: {
      color: t.colors.textOnPrimary,
      fontSize: 10,
      lineHeight: 14,
      fontWeight: '700',
    },
    locationStatusPill: {
      minHeight: 30,
      borderRadius: MAP_CONTROL_RADIUS,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
      paddingHorizontal: 8,
      paddingVertical: 6,
      justifyContent: 'center',
    },
    locationStatusPillError: {
      maxWidth: 230,
      borderColor: t.colors.dangerBorder,
      backgroundColor: t.colors.dangerSoft,
    },
    locationStatusText: {
      color: t.colors.textPrimary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
    },
    locationStatusTextError: {
      color: t.colors.dangerText,
    },
    selectedPinPanel: {
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: 12,
      backgroundColor: t.colors.card,
      borderRadius: MAP_CONTROL_RADIUS,
      padding: 14,
      gap: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
      shadowColor: t.colors.shadow,
      shadowOffset: {
        width: 0,
        height: 4,
      },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 3,
    },
    selectedPinTitle: {
      fontSize: 15,
      lineHeight: 20,
      color: t.colors.textPrimary,
      fontWeight: '700',
    },
    sequenceWarningMarkerContainer: {
      width: 44,
      height: 50,
      alignItems: 'center',
    },
    sequenceWarningMarkerBadge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 3,
      borderColor: '#ffffff',
      backgroundColor: '#f59e0b',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000000',
      shadowOffset: {
        width: 0,
        height: 3,
      },
      shadowOpacity: 0.34,
      shadowRadius: 5,
      elevation: 8,
    },
    sequenceWarningMarkerIcon: {
      color: '#111827',
      fontSize: 21,
      lineHeight: 25,
      fontWeight: '900',
    },
    sequenceWarningMarkerPointer: {
      width: 0,
      height: 0,
      marginTop: -2,
      borderLeftWidth: 8,
      borderRightWidth: 8,
      borderTopWidth: 12,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderTopColor: '#f59e0b',
    },
    sequenceWarningCallout: {
      width: 270,
      gap: 7,
      paddingVertical: 2,
    },
    sequenceWarningCalloutTitle: {
      color: t.colors.textPrimary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '700',
    },
    sequenceWarningCalloutMessage: {
      color: t.colors.warningText,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    assetMarkerHitbox: {
      // Transparent padding keeps the small dot easy to tap.
      width: 30,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    assetMarkerDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: '#ffffff',
      shadowColor: '#000000',
      shadowOffset: {
        width: 0,
        height: 1,
      },
      shadowOpacity: 0.35,
      shadowRadius: 2,
      elevation: 4,
    },
    assetMarkerDotFocused: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 3,
      borderColor: '#7c3aed',
    },
    defectMarkerContainer: {
      width: 44,
      height: 52,
      alignItems: 'center',
    },
    defectMarkerHalo: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 3,
      backgroundColor: '#ffffff',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000000',
      shadowOffset: {
        width: 0,
        height: 3,
      },
      shadowOpacity: 0.34,
      shadowRadius: 5,
      elevation: 8,
    },
    defectMarkerBadge: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    defectMarkerIcon: {
      fontSize: 21,
      lineHeight: 24,
      fontWeight: '900',
    },
    defectMarkerPointer: {
      width: 0,
      height: 0,
      marginTop: -2,
      borderLeftWidth: 8,
      borderRightWidth: 8,
      borderTopWidth: 12,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
    },
    defectCallout: {
      width: 260,
      gap: 8,
      paddingVertical: 2,
    },
    defectCalloutTitle: {
      color: t.colors.textPrimary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '700',
    },
    defectCalloutRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    defectCalloutLabel: {
      width: 74,
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
    },
    defectCalloutValue: {
      flex: 1,
      color: t.colors.textPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
    defectCalloutDescriptionGroup: {
      gap: 3,
      paddingTop: 2,
    },
    defectCalloutDescription: {
      color: t.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
  });

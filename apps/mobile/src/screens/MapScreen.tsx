import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { Pressable, Text, View } from 'react-native';
import MapView, { LongPressEvent, Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { api, ApiError } from '../api';
import { AppButton, BodyText, ErrorBanner, InlineButton, LoadingBlock, Screen } from '../ui';
import { Asset, DefectDetail, DefectListItem } from '../types';

type Coordinate = {
  latitude: number;
  longitude: number;
};

type DefectMapMarker = DefectListItem & Coordinate;

const DEFAULT_REGION: Region = {
  latitude: 3.139,
  longitude: 101.6869,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

const CURRENT_LOCATION_REGION_DELTA = 0.005;

console.log('MAP API KEY:', process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY);

export function MapScreen({
  token,
  visitId,
  substationId,
  onBack,
  onAddAssetHere,
  onOpenAssetDetail,
  onOpenDefectDetail,
  onUnauthorized,
}: {
  token: string;
  visitId?: string;
  substationId?: string;
  onBack: () => void;
  onAddAssetHere: (params: {
    visitId?: string;
    substationId?: string;
    latitude: number;
    longitude: number;
  }) => void;
  onOpenAssetDetail: (asset: Asset) => void;
  onOpenDefectDetail: (defectId: string) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const mapRef = useRef<MapView | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [defectMarkers, setDefectMarkers] = useState<DefectMapMarker[]>([]);
  const [selectedCoordinate, setSelectedCoordinate] = useState<Coordinate | null>(null);
  const [currentCoordinate, setCurrentCoordinate] = useState<Coordinate | null>(null);
  const [currentAccuracy, setCurrentAccuracy] = useState<number | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [mapType, setMapType] = useState<'standard' | 'hybrid'>('hybrid');
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const assetsWithCoordinates = useMemo(
    () => assets.filter((asset) => getAssetCoordinate(asset) !== null),
    [assets],
  );

  const hasAssetOrDefectMarkers = assetsWithCoordinates.length > 0 || defectMarkers.length > 0;

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

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
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

  const loadMapData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const assetList = await loadAssetsForMap(token, substationId);
      const nextDefectMarkers = await loadDefectMarkers(token, assetList);
      const nextRegion = createRegion([
        ...assetList.map(getAssetCoordinate).filter(isCoordinate),
        ...nextDefectMarkers.map((defect) => ({
          latitude: defect.latitude,
          longitude: defect.longitude,
        })),
      ]);

      setAssets(assetList);
      setDefectMarkers(nextDefectMarkers);
      setRegion(nextRegion);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await onUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load map data.');
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized, substationId, token]);

  useEffect(() => {
    loadMapData();
  }, [loadMapData]);

  useEffect(() => {
    void requestCurrentLocation();
  }, [requestCurrentLocation]);

  useEffect(() => {
    if (!isLoading && currentCoordinate && !hasAssetOrDefectMarkers) {
      centerMapOnCoordinate(currentCoordinate);
    }
  }, [centerMapOnCoordinate, currentCoordinate, hasAssetOrDefectMarkers, isLoading]);

  function handleLongPress(event: LongPressEvent) {
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

  return (
    <Screen
      title="Asset Map"
      subtitle={
        substationId
          ? 'Long press the map to place a new asset pin for this pencawang.'
          : 'Long press the map to place a new asset pin.'
      }
      actions={
        <>
          <InlineButton label="Back" onPress={onBack} />
          <InlineButton label="Refresh" onPress={loadMapData} disabled={isLoading} />
        </>
      }
      scroll={false}
    >
      <ErrorBanner message={error} />

      <View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderWidth: 1,
          borderColor: '#dce5f1',
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 14, color: '#607086', fontWeight: '700' }}>
          Assets: {assetsWithCoordinates.length}
        </Text>
        <Text style={{ fontSize: 14, color: '#607086', fontWeight: '700' }}>
          Defects: {defectMarkers.length}
        </Text>
      </View>

      <View style={{ flex: 1, minHeight: 420, borderRadius: 16, overflow: 'hidden' }}>
        {isLoading ? (
          <View
            style={{
              flex: 1,
              minHeight: 420,
              backgroundColor: '#eef4fb',
              justifyContent: 'center',
            }}
          >
            <LoadingBlock label="Loading asset map..." />
          </View>
        ) : (
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={{ flex: 1 }}
            region={region}
            mapType={mapType}
            showsUserLocation={true}
            showsMyLocationButton={true}
            followsUserLocation={false}
            onRegionChangeComplete={setRegion}
            onLongPress={handleLongPress}
          >
            {assets.map((asset) => {
              const coordinate = getAssetCoordinate(asset);

              if (!coordinate) {
                return null;
              }

              return (
                <Marker
                  key={asset.id}
                  coordinate={coordinate}
                  title={asset.assetCode}
                  description={asset.name ?? asset.assetType.name}
                  pinColor="#0f5cd8"
                  onPress={() => onOpenAssetDetail(asset)}
                />
              );
            })}

            {defectMarkers.map((defect) => (
              <Marker
                key={defect.id}
                coordinate={{
                  latitude: defect.latitude,
                  longitude: defect.longitude,
                }}
                title={defect.assetCode ? `Defect - ${defect.assetCode}` : 'Defect'}
                description={defect.label}
                pinColor="#d97706"
                onPress={() => onOpenDefectDetail(defect.id)}
              />
            ))}

            {selectedCoordinate ? (
              <Marker
                coordinate={selectedCoordinate}
                draggable
                title="New asset location"
                description="Confirm below to add an asset here."
                pinColor="#10b981"
                onDragEnd={(event) => setSelectedCoordinate(event.nativeEvent.coordinate)}
              />
            ) : null}
          </MapView>
        )}

        {!isLoading ? (
          <>
            <View
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                alignItems: 'flex-start',
                gap: 6,
              }}
            >
              <Pressable
                onPress={() => {
                  void requestCurrentLocation(true);
                }}
                style={({ pressed }) => ({
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: '#c7d5e8',
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  opacity: pressed ? 0.82 : 1,
                })}
              >
                <Text style={{ color: '#33516f', fontSize: 13, fontWeight: '800' }}>
                  My Location
                </Text>
              </Pressable>

              {currentAccuracy !== null ? (
                <View
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: '#c7d5e8',
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                  }}
                >
                  <Text style={{ color: '#33516f', fontSize: 12, fontWeight: '700' }}>
                    Accuracy: {Math.round(currentAccuracy)}m
                  </Text>
                </View>
              ) : null}

              {locationMessage ? (
                <View
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: '#f3b4b4',
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    maxWidth: 220,
                  }}
                >
                  <Text style={{ color: '#b42318', fontSize: 12, fontWeight: '700' }}>
                    {locationMessage}
                  </Text>
                </View>
              ) : null}
            </View>

            <View
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                flexDirection: 'row',
                backgroundColor: '#ffffff',
                borderRadius: 12,
                borderWidth: 1,
                borderColor: '#c7d5e8',
                overflow: 'hidden',
              }}
            >
              <Pressable
                onPress={() => setMapType('standard')}
                style={({ pressed }) => ({
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: mapType === 'standard' ? '#0f5cd8' : '#ffffff',
                  opacity: pressed ? 0.82 : 1,
                })}
              >
                <Text
                  style={{
                    color: mapType === 'standard' ? '#ffffff' : '#33516f',
                    fontSize: 13,
                    fontWeight: '800',
                  }}
                >
                  Map
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMapType('hybrid')}
                style={({ pressed }) => ({
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: mapType === 'hybrid' ? '#0f5cd8' : '#ffffff',
                  opacity: pressed ? 0.82 : 1,
                })}
              >
                <Text
                  style={{
                    color: mapType === 'hybrid' ? '#ffffff' : '#33516f',
                    fontSize: 13,
                    fontWeight: '800',
                  }}
                >
                  Satellite
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {selectedCoordinate ? (
          <View
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 12,
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 14,
              gap: 10,
              borderWidth: 1,
              borderColor: '#c7d5e8',
            }}
          >
            <Text style={{ fontSize: 15, color: '#0f172a', fontWeight: '800' }}>
              Drag pin to adjust location
            </Text>
            <BodyText muted>
              {selectedCoordinate.latitude.toFixed(6)}, {selectedCoordinate.longitude.toFixed(6)}
            </BodyText>
            <AppButton
              label="Add Asset Here"
              onPress={() =>
                onAddAssetHere({
                  visitId,
                  substationId,
                  latitude: selectedCoordinate.latitude,
                  longitude: selectedCoordinate.longitude,
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
      </View>
    </Screen>
  );
}

async function loadAssetsForMap(token: string, substationId?: string) {
  if (substationId) {
    return api.getAssets(token, substationId);
  }

  const substations = await api.getSubstations(token);
  const assetGroups = await Promise.all(
    substations.map((substation) => api.getAssets(token, substation.id)),
  );

  return assetGroups.flat();
}

async function loadDefectMarkers(token: string, assets: Asset[]) {
  const assetLookup = new Map(assets.map((asset) => [asset.id, asset]));
  const defects = await api.getDefects(token);
  const relevantDefects = defects.filter((defect) => assetLookup.has(defect.assetId));
  const markers = await Promise.all(
    relevantDefects.map((defect) => createDefectMarker(token, defect, assetLookup)),
  );

  return markers.filter(isDefectMapMarker);
}

async function createDefectMarker(
  token: string,
  defect: DefectListItem,
  assetLookup: Map<string, Asset>,
) {
  try {
    const detail = await api.getDefectDetail(token, defect.id);
    const imageCoordinate = getFirstImageCoordinate(detail);
    const assetCoordinate = getAssetCoordinate(assetLookup.get(defect.assetId));
    const coordinate = imageCoordinate ?? assetCoordinate;

    if (!coordinate) {
      return null;
    }

    return {
      ...defect,
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

function isCoordinate(value: Coordinate | null): value is Coordinate {
  return value !== null;
}

function isDefectMapMarker(value: DefectMapMarker | null): value is DefectMapMarker {
  return value !== null;
}

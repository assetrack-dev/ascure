import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import Mapbox, { type Camera as MapboxCamera } from '@rnmapbox/maps';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RootStackScreenProps } from '../navigation/types';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Screen,
  StatusSpineTile,
  SuccessBanner,
  WarningBanner,
  type SpineTone,
} from '../ui';
import { Theme, useTheme } from '../theme';
import { SATELLITE_STYLE, downloadOfflineRegion, hasMapboxToken } from '../mapbox';
import { getPositionWithTimeout } from '../location';
import {
  overlayKejanggalan,
  pendingFindingItems,
  type OverlaidKejanggalan,
} from '../maintenance/maintenanceLocal';
import { downloadPackPhotos, formatBytes, planPackPhotos, usePackPhotos } from '../maintenance/packPhotos';
import { useWorkPack } from '../maintenance/useWorkPack';
import {
  CATEGORY_LABEL,
  STATE_LABEL,
  type MaintenanceCategory,
  type PolePhoto,
  type WorkPole,
  type WorkState,
} from '../maintenance/types';

type View_ = 'LIST' | 'MAP';
type Filter = 'OPEN' | 'ALL' | 'SUBMITTED';
type WorkType = 'ALL' | MaintenanceCategory;
/** NONE = no Kejanggalan (of the chosen work type) on this pole. */
type PoleState = WorkState | 'NONE';

/** Map / tile colour per pole state (worst Kejanggalan wins). */
const STATE_COLOR: Record<WorkState, string> = {
  TODO: '#DC2626',
  IN_PROGRESS: '#D98A0B',
  SUBMITTED: '#2563EB',
  CLOSED: '#15A34A',
};
const NONE_COLOR = '#F1F5F9';
const STATE_SPINE: Record<WorkState, SpineTone> = {
  TODO: 'red',
  IN_PROGRESS: 'amber',
  SUBMITTED: 'blue',
  CLOSED: 'green',
};
const STATE_ORDER: WorkState[] = ['TODO', 'IN_PROGRESS', 'SUBMITTED', 'CLOSED'];
/** Draw order on the map: work to do on top. */
const SORT_KEY: Record<PoleState, number> = { TODO: 4, IN_PROGRESS: 3, SUBMITTED: 2, CLOSED: 1, NONE: 0 };
const WORK_TYPES: MaintenanceCategory[] = ['RENTIS', 'SELENGGARAAN', 'CAT_TIANG'];

type PoleRow = WorkPole & {
  photos: PolePhoto[];
  /** Every Kejanggalan on the pole (server + added on this phone). */
  items: OverlaidKejanggalan[];
  /** The ones of the chosen work type. */
  matching: OverlaidKejanggalan[];
  state: PoleState;
  openCount: number;
  distanceM: number | null;
  labels: string[];
};

const isOpen = (item: OverlaidKejanggalan) => item.displayState === 'TODO' || item.displayState === 'IN_PROGRESS';

/**
 * One Pencawang package in maintenance mode (docs/PLAN-maintenance-flow.md
 * §7.1 / §14): every pole of the crew — with or without Kejanggalan — as a list
 * or a map, filtered by work type, with the crew's own location and the nearest
 * pole's survey photos; one-tap "save for offline" (work pack + photos + tiles).
 */
export function MaintenancePackageScreen() {
  const navigation = useNavigation<RootStackScreenProps<'MaintenancePackage'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'MaintenancePackage'>['route']>();
  const { siteVisitId, title } = route.params;
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { pack, local, fromCache, cachedAt, isLoading, error, reload } = useWorkPack(siteVisitId);
  const { resolve: photoUri, refresh: refreshSavedPhotos } = usePackPhotos(siteVisitId);
  const cameraRef = useRef<MapboxCamera>(null);
  const [mode, setMode] = useState<View_>('LIST');
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [workType, setWorkType] = useState<WorkType>('ALL');
  const [here, setHere] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationGranted, setLocationGranted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Plan §13 — picking a pole to add a Kejanggalan that was not in the survey.
  const [picking, setPicking] = useState(false);
  const [pickQuery, setPickQuery] = useState('');

  // Follow the crew while this screen is open (nearest pole, distances).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let subscription: Location.LocationSubscription | null = null;
      void (async () => {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted || cancelled) return;
        setLocationGranted(true);
        const fix = await getPositionWithTimeout({ timeoutMs: 4000 });
        if (cancelled) return;
        if (fix) setHere({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
        const watch = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 2000 },
          (position) => setHere({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        ).catch(() => null);
        if (cancelled) watch?.remove();
        else subscription = watch;
      })();
      return () => {
        cancelled = true;
        subscription?.remove();
      };
    }, [locationGranted]),
  );

  const rows: PoleRow[] = useMemo(() => {
    if (!pack) return [];
    const surveyed = pack.surveyedPoles ?? [];
    const photosOf = new Map(surveyed.map((pole) => [pole.assetId, pole.photos ?? []]));
    const packPoleIds = new Set(pack.poles.map((pole) => pole.assetId));
    // Every pole of the crew (I24): with work, plus the surveyed poles with none
    // yet — a Kejanggalan can be added there (§13).
    const poles: WorkPole[] = [
      ...pack.poles,
      ...surveyed
        .filter((pole) => !packPoleIds.has(pole.assetId))
        .map((pole) => ({
          assetId: pole.assetId,
          assetCode: pole.assetCode,
          refCode: pole.refCode,
          noTiangLama: pole.noTiangLama,
          latitude: pole.latitude,
          longitude: pole.longitude,
          counts: { TODO: 0, IN_PROGRESS: 0, SUBMITTED: 0, CLOSED: 0 },
          photos: pole.photos,
          kejanggalan: [],
        })),
    ];
    return poles.map((pole) => {
      const items = [...pole.kejanggalan, ...pendingFindingItems(local, pack, pole.assetId)].map((item) =>
        overlayKejanggalan(item, local),
      );
      const matching = workType === 'ALL' ? items : items.filter((item) => item.category === workType);
      const state: PoleState =
        matching.length === 0
          ? 'NONE'
          : STATE_ORDER.find((candidate) => matching.some((item) => item.displayState === candidate)) ?? 'CLOSED';
      return {
        ...pole,
        photos: pole.photos ?? photosOf.get(pole.assetId) ?? [],
        items,
        matching,
        state,
        openCount: matching.filter(isOpen).length,
        distanceM:
          here && pole.latitude !== null && pole.longitude !== null
            ? distanceMeters(here, { latitude: pole.latitude, longitude: pole.longitude })
            : null,
        labels: [...new Set(matching.map((item) => item.remark || item.label))],
      };
    });
  }, [here, local, pack, workType]);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) =>
      row.state === 'NONE'
        ? false
        : filter === 'ALL'
          ? true
          : filter === 'OPEN'
            ? row.openCount > 0
            : row.state === 'SUBMITTED',
    );
    // Nearest first when we know where the crew is; else pole order.
    return here
      ? [...filtered].sort((left, right) => (left.distanceM ?? Infinity) - (right.distanceM ?? Infinity))
      : filtered;
  }, [filter, here, rows]);

  const totals = useMemo(() => {
    const counts: Record<WorkState, number> = { TODO: 0, IN_PROGRESS: 0, SUBMITTED: 0, CLOSED: 0 };
    rows.forEach((row) => row.matching.forEach((item) => (counts[item.displayState] += 1)));
    return counts;
  }, [rows]);

  /** Poles with open work, per work type (filter chip badges). */
  const openPolesByType = useMemo(() => {
    const counts: Record<WorkType, number> = { ALL: 0, RENTIS: 0, SELENGGARAAN: 0, CAT_TIANG: 0 };
    rows.forEach((row) => {
      const open = row.items.filter(isOpen);
      if (open.length > 0) counts.ALL += 1;
      WORK_TYPES.forEach((type) => {
        if (open.some((item) => item.category === type)) counts[type] += 1;
      });
    });
    return counts;
  }, [rows]);

  const nearest = useMemo(() => {
    let best: PoleRow | null = null;
    for (const row of rows) {
      if (row.distanceM === null) continue;
      if (!best || row.distanceM < (best.distanceM ?? Infinity)) best = row;
    }
    return best;
  }, [rows]);
  const selected = selectedId ? rows.find((row) => row.assetId === selectedId) ?? null : null;
  const cardRow = selected ?? nearest;

  const openPole = (assetId: string) =>
    navigation.navigate('MaintenancePole', {
      siteVisitId,
      assetId,
      ...(workType === 'ALL' ? {} : { workType }),
    });

  const openPhotos = (photos: PolePhoto[], index: number, code: string) =>
    navigation.navigate('ImagePreview', {
      images: photos.map((photo) => ({ uri: photoUri(photo.url), title: photo.label ?? `Survey photo · ${code}` })),
      index,
    });

  const locateMe = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Location is off', 'Allow ASCURE to use your location to see where you are on the map.');
      return;
    }
    setLocationGranted(true);
    setSelectedId(null);
    const fix = await getPositionWithTimeout({ accuracy: Location.Accuracy.High, timeoutMs: 6000 });
    const position = fix ? { latitude: fix.coords.latitude, longitude: fix.coords.longitude } : here;
    if (!position) {
      Alert.alert('No GPS fix yet', 'Move to open sky and try again.');
      return;
    }
    setHere(position);
    cameraRef.current?.setCamera({
      centerCoordinate: [position.longitude, position.latitude],
      zoomLevel: 18,
      animationDuration: 600,
      animationMode: 'flyTo',
    });
  };

  const pickablePoles = useMemo(() => {
    const query = pickQuery.trim().toLowerCase();
    const poles = (pack?.surveyedPoles ?? []).filter(
      (pole) =>
        !query ||
        pole.assetCode.toLowerCase().includes(query) ||
        (pole.refCode ?? '').toLowerCase().includes(query) ||
        (pole.noTiangLama ?? '').toLowerCase().includes(query),
    );
    const withDistance = poles.map((pole) => ({
      ...pole,
      distanceM:
        here && pole.latitude !== null && pole.longitude !== null
          ? distanceMeters(here, { latitude: pole.latitude, longitude: pole.longitude })
          : null,
    }));
    return here
      ? withDistance.sort((left, right) => (left.distanceM ?? Infinity) - (right.distanceM ?? Infinity))
      : withDistance;
  }, [here, pack, pickQuery]);

  const saveForOffline = () => {
    if (!pack) return;
    const plan = planPackPhotos(pack);
    Alert.alert(
      'Save for offline?',
      `${plan.photos.length} photos (about ${formatBytes(plan.totalBytes)}) and the map around the poles. Use Wi-Fi if you can.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: () => void runSaveForOffline(plan) },
      ],
    );
  };

  const runSaveForOffline = async (plan: ReturnType<typeof planPackPhotos>) => {
    if (!pack) return;
    setSaveError(null);
    setNotice(null);
    try {
      // 1) Photos into the app's own storage (I28) — not the small image cache.
      setSaving(`Saving photos 0/${plan.photos.length}…`);
      const photoResult = await downloadPackPhotos(siteVisitId, plan, (done, total) =>
        setSaving(`Saving photos ${done}/${total}…`),
      );
      await refreshSavedPhotos();

      // 2) Map tiles around every pole (satellite), if the map is configured.
      const located = rows.filter((row) => row.latitude !== null && row.longitude !== null);
      let mapNote = '';
      if (hasMapboxToken() && located.length > 0) {
        const lats = located.map((row) => row.latitude as number);
        const lngs = located.map((row) => row.longitude as number);
        const pad = 0.004; // ~400 m around the outermost poles
        setSaving('Saving map tiles… 0%');
        try {
          await downloadOfflineRegion(
            {
              id: `maintenance-${siteVisitId}`,
              label: `Maintenance · ${title}`,
              ne: [Math.max(...lngs) + pad, Math.max(...lats) + pad],
              sw: [Math.min(...lngs) - pad, Math.min(...lats) - pad],
              maxZoom: 17,
            },
            (percentage) => setSaving(`Saving map tiles… ${Math.round(percentage)}%`),
          );
        } catch (tileError) {
          mapNote = ` Map tiles not saved: ${tileError instanceof Error ? tileError.message : 'download failed'}`;
        }
      }
      const savedPhotos = photoResult.saved + photoResult.alreadySaved;
      const failedNote =
        photoResult.failed > 0 ? ` ${photoResult.failed} photos failed — try again on a better signal.` : '';
      setNotice(`Saved for offline: ${rows.length} poles, ${savedPhotos} photos.${failedNote}${mapNote}`);
    } catch (offlineError) {
      setSaveError(offlineError instanceof Error ? offlineError.message : 'Unable to save for offline.');
    } finally {
      setSaving(null);
    }
  };

  const features = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: rows
        .filter((row) => row.latitude !== null && row.longitude !== null)
        .map((row) => ({
          type: 'Feature' as const,
          id: row.assetId,
          properties: {
            assetId: row.assetId,
            color: row.state === 'NONE' ? NONE_COLOR : STATE_COLOR[row.state],
            stroke: row.state === 'NONE' ? '#334155' : '#ffffff',
            radius: row.state === 'NONE' ? 6 : 9,
            sortKey: SORT_KEY[row.state],
            selected: row.assetId === selectedId ? 1 : 0,
            label: row.refCode || row.assetCode,
          },
          geometry: { type: 'Point' as const, coordinates: [row.longitude as number, row.latitude as number] },
        })),
    }),
    [rows, selectedId],
  );
  const center = useMemo(() => {
    const located = rows.filter((row) => row.latitude !== null && row.longitude !== null);
    if (located.length === 0) return null;
    return [
      located.reduce((sum, row) => sum + (row.longitude as number), 0) / located.length,
      located.reduce((sum, row) => sum + (row.latitude as number), 0) / located.length,
    ] as [number, number];
  }, [rows]);

  const workTypeChips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {(['ALL', ...WORK_TYPES] as WorkType[]).map((type) => {
        const active = workType === type;
        return (
          <Pressable
            key={type}
            onPress={() => setWorkType(type)}
            style={[styles.typeChip, active && styles.typeChipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
              {type === 'ALL' ? 'All work' : CATEGORY_LABEL[type]}
            </Text>
            <View style={[styles.typeBadge, active && styles.typeBadgeActive]}>
              <Text style={[styles.typeBadgeText, active && styles.typeBadgeTextActive]}>{openPolesByType[type]}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <Screen
      title={title}
      subtitle={pack?.mainhead?.name ?? undefined}
      scroll={mode === 'LIST'}
      leftAction={{ icon: 'back', onPress: () => navigation.goBack(), accessibilityLabel: 'Back' }}
      rightAction={{ icon: 'refresh', onPress: () => void reload(), accessibilityLabel: 'Refresh', disabled: isLoading }}
      actions={
        <View style={styles.headerStack}>
          <View style={styles.countRow}>
            {STATE_ORDER.map((state) => (
              <View key={state} style={styles.countTile}>
                <Text style={[styles.countValue, { color: STATE_COLOR[state] }]}>{totals[state]}</Text>
                <Text style={styles.countLabel}>{STATE_LABEL[state]}</Text>
              </View>
            ))}
          </View>
          <View style={styles.toggleRow}>
            <Segment options={[['LIST', 'List'], ['MAP', 'Map']]} value={mode} onChange={setMode} styles={styles} />
            {mode === 'LIST' ? (
              <Segment
                options={[['OPEN', 'To repair'], ['SUBMITTED', 'Submitted'], ['ALL', 'All']]}
                value={filter}
                onChange={setFilter}
                styles={styles}
              />
            ) : null}
          </View>
          {workTypeChips}
          <Pressable
            onPress={saveForOffline}
            disabled={!pack || saving !== null}
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, (!pack || saving) && styles.disabled]}
          >
            <Text style={styles.saveButtonText}>{saving ?? 'Save for offline (photos + map)'}</Text>
          </Pressable>
        </View>
      }
    >
      <ErrorBanner message={error ?? saveError} />
      <SuccessBanner message={notice} />
      {fromCache ? (
        <WarningBanner message={`Offline — using the copy saved ${cachedAt ? formatDateTime(cachedAt) : 'earlier'}.`} />
      ) : null}
      {isLoading && !pack ? <LoadingBlock label="Loading package…" /> : null}

      {pack && mode === 'LIST' && (pack.surveyedPoles?.length ?? 0) > 0 && !picking ? (
        <Pressable
          onPress={() => {
            setPickQuery('');
            setPicking(true);
          }}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <Text style={styles.addButtonText}>+ Add Kejanggalan (not in survey)</Text>
        </Pressable>
      ) : null}

      {pack && mode === 'LIST' && picking ? (
        <Card>
          <Text style={styles.pickTitle}>Which pole?</Text>
          <Text style={styles.pickHint}>
            Any surveyed pole of this Pencawang that is yours — even one with no Kejanggalan yet. Nearest first.
          </Text>
          <TextInput
            value={pickQuery}
            onChangeText={setPickQuery}
            placeholder="Search NO TIANG / old number"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.pickInput}
            autoCapitalize="characters"
          />
          {pickablePoles.slice(0, 50).map((pole) => (
            <Pressable
              key={pole.assetId}
              onPress={() => {
                setPicking(false);
                openPole(pole.assetId);
              }}
              style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
            >
              <Text style={styles.pickCode}>{pole.refCode || pole.assetCode}</Text>
              <Text style={styles.pickMeta}>
                {[
                  pole.noTiangLama ? `Lama ${pole.noTiangLama}` : null,
                  pole.distanceM !== null ? formatDistance(pole.distanceM) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Pressable>
          ))}
          {pickablePoles.length > 50 ? (
            <Text style={styles.pickHint}>Showing the nearest 50 — search to find others.</Text>
          ) : null}
          <Pressable onPress={() => setPicking(false)} style={({ pressed }) => [styles.pickCancel, pressed && styles.pressed]}>
            <Text style={styles.addButtonText}>Cancel</Text>
          </Pressable>
        </Card>
      ) : null}

      {pack && mode === 'LIST' && !picking ? (
        visibleRows.length === 0 ? (
          <Card>
            <EmptyState
              icon="check-circle"
              title={filter === 'OPEN' ? 'Nothing left to repair' : 'No poles here'}
              description={
                filter !== 'OPEN'
                  ? 'Try another filter.'
                  : workType === 'ALL'
                    ? 'Every Kejanggalan on this Pencawang has been submitted.'
                    : `No open ${CATEGORY_LABEL[workType]} work on this Pencawang.`
              }
            />
          </Card>
        ) : (
          visibleRows.map((row) => {
            const state = row.state as WorkState;
            return (
              <StatusSpineTile
                key={row.assetId}
                code={row.refCode || row.assetCode}
                spine={STATE_SPINE[state]}
                chip={{
                  label: row.openCount > 0 ? `${row.openCount} to repair` : STATE_LABEL[state],
                  tone:
                    state === 'TODO' ? 'danger' : state === 'IN_PROGRESS' ? 'warning' : state === 'SUBMITTED' ? 'info' : 'success',
                }}
                secondary={row.labels.join(' · ')}
                meta={[
                  row.refCode ? row.assetCode : null,
                  row.distanceM !== null ? formatDistance(row.distanceM) : null,
                  row.latitude === null ? 'No GPS on record' : null,
                ]}
                onPress={() => openPole(row.assetId)}
              />
            );
          })
        )
      ) : null}

      {pack && mode === 'MAP' ? (
        hasMapboxToken() && center ? (
          <View style={styles.mapWrap}>
            <Mapbox.MapView style={styles.map} styleURL={SATELLITE_STYLE} scaleBarEnabled={false}>
              <Mapbox.Camera
                ref={cameraRef}
                defaultSettings={{ centerCoordinate: center, zoomLevel: 15 }}
                animationMode="none"
              />
              <Mapbox.LocationPuck visible={locationGranted} puckBearing="heading" puckBearingEnabled />
              {/* GPU circle layer (never one native view per pole). */}
              <Mapbox.ShapeSource
                id="repair-poles"
                shape={features}
                hitbox={{ width: 28, height: 28 }}
                onPress={(event) => {
                  const assetId = event.features?.[0]?.properties?.assetId;
                  if (typeof assetId === 'string') setSelectedId(assetId);
                }}
              >
                <Mapbox.CircleLayer
                  id="repair-pole-selected"
                  filter={['==', ['get', 'selected'], 1]}
                  style={{
                    circleColor: 'rgba(56, 189, 248, 0.35)',
                    circleRadius: 18,
                    circleStrokeWidth: 2,
                    circleStrokeColor: '#38BDF8',
                  }}
                />
                <Mapbox.CircleLayer
                  id="repair-pole-circles"
                  style={{
                    circleColor: ['get', 'color'],
                    circleRadius: ['get', 'radius'],
                    circleStrokeWidth: 2,
                    circleStrokeColor: ['get', 'stroke'],
                    circleSortKey: ['get', 'sortKey'],
                  }}
                />
                <Mapbox.SymbolLayer
                  id="repair-pole-labels"
                  minZoomLevel={16}
                  style={{
                    textField: ['get', 'label'],
                    textSize: 11,
                    textColor: '#ffffff',
                    textHaloColor: 'rgba(15, 23, 42, 0.9)',
                    textHaloWidth: 1.2,
                    textOffset: [0, 1.2],
                    textAnchor: 'top',
                  }}
                />
              </Mapbox.ShapeSource>
            </Mapbox.MapView>

            <View style={styles.legend}>
              {STATE_ORDER.map((state) => (
                <View key={state} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: STATE_COLOR[state] }]} />
                  <Text style={styles.legendText}>{STATE_LABEL[state]}</Text>
                </View>
              ))}
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.legendDotNone]} />
                <Text style={styles.legendText}>
                  {workType === 'ALL' ? 'No Kejanggalan' : `No ${CATEGORY_LABEL[workType]}`}
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() => void locateMe()}
              style={({ pressed }) => [styles.locateButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Show my location"
            >
              <Feather name="crosshair" size={22} color="#0F172A" />
            </Pressable>

            {cardRow ? (
              <PoleCard
                row={cardRow}
                heading={selected ? 'Selected pole' : 'Nearest pole'}
                onOpen={() => openPole(cardRow.assetId)}
                onClose={selected ? () => setSelectedId(null) : undefined}
                onPhoto={(index) => openPhotos(cardPhotos(cardRow), index, cardRow.refCode || cardRow.assetCode)}
                photoUri={photoUri}
                styles={styles}
              />
            ) : (
              <View style={styles.mapHint}>
                <Text style={styles.mapHintText}>
                  Tap a pole for its photos · tap the target button to see where you are.
                </Text>
              </View>
            )}
          </View>
        ) : (
          <Card>
            <EmptyState icon="map" title="Map unavailable" description="No pole in this package has GPS, or the map is not configured. Use the list." />
          </Card>
        )
      ) : null}
    </Screen>
  );
}

/** Photos that identify a pole: its own survey photos, else its Kejanggalan survey photos. */
function cardPhotos(row: PoleRow): PolePhoto[] {
  if (row.photos.length > 0) return row.photos;
  return row.items
    .flatMap((item) => item.surveyPhotos.map((photo) => ({ ...photo, label: item.label })))
    .slice(0, 4);
}

function PoleCard({
  row,
  heading,
  onOpen,
  onClose,
  onPhoto,
  photoUri,
  styles,
}: {
  row: PoleRow;
  heading: string;
  onOpen: () => void;
  onClose?: () => void;
  onPhoto: (index: number) => void;
  photoUri: (url: string) => string;
  styles: ReturnType<typeof createStyles>;
}) {
  const photos = cardPhotos(row);
  const shown = row.items.slice(0, 3);
  return (
    <View style={styles.poleCard}>
      <View style={styles.poleCardHeader}>
        <Text style={styles.poleCardHeading}>
          {heading}
          {row.distanceM !== null ? ` · ${formatDistance(row.distanceM)}` : ''}
        </Text>
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Feather name="x" size={18} color="#CBD5E1" />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.poleCardCode}>{row.refCode || row.assetCode}</Text>
      {row.noTiangLama || row.refCode ? (
        <Text style={styles.poleCardMeta}>
          {[row.refCode ? row.assetCode : null, row.noTiangLama ? `Lama ${row.noTiangLama}` : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}
      {photos.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.poleCardPhotos}>
          {photos.map((photo, index) => (
            <Pressable key={photo.id} onPress={() => onPhoto(index)}>
              <Image source={{ uri: photoUri(photo.url) }} style={styles.poleCardPhoto} />
              {photo.label ? (
                <Text style={styles.poleCardPhotoLabel} numberOfLines={1}>
                  {photo.label}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.poleCardMeta}>No survey photo of this pole.</Text>
      )}
      {shown.length > 0 ? (
        shown.map((item) => (
          <Text key={item.id} style={styles.poleCardItem} numberOfLines={1}>
            <Text style={{ color: STATE_COLOR[item.displayState] }}>● </Text>
            {item.remark || item.label} · {CATEGORY_LABEL[item.category]} · {STATE_LABEL[item.displayState]}
          </Text>
        ))
      ) : (
        <Text style={styles.poleCardMeta}>No Kejanggalan — open it to add one found on site.</Text>
      )}
      {row.items.length > shown.length ? (
        <Text style={styles.poleCardMeta}>+{row.items.length - shown.length} more</Text>
      ) : null}
      <Pressable onPress={onOpen} style={({ pressed }) => [styles.poleCardButton, pressed && styles.pressed]}>
        <Text style={styles.poleCardButtonText}>Open pole</Text>
      </Pressable>
    </View>
  );
}

function Segment<T extends string>({
  options,
  value,
  onChange,
  styles,
}: {
  options: Array<[T, string]>;
  value: T;
  onChange: (value: T) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.segment}>
      {options.map(([key, label]) => (
        <Pressable
          key={key}
          onPress={() => onChange(key)}
          style={[styles.segmentItem, value === key && styles.segmentItemActive]}
        >
          <Text style={[styles.segmentText, value === key && styles.segmentTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters)} m away` : `${(meters / 1000).toFixed(1)} km away`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    headerStack: { gap: 10, width: '100%' },
    countRow: { flexDirection: 'row', gap: 8 },
    countTile: {
      flex: 1,
      backgroundColor: theme.colors.card,
      borderRadius: theme.radius.chip,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingVertical: 8,
      alignItems: 'center',
    },
    countValue: { fontFamily: theme.fonts.bodyBold, fontSize: 18 },
    countLabel: { fontFamily: theme.fonts.body, fontSize: 11, color: theme.colors.textSecondary },
    toggleRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    segment: {
      flexDirection: 'row',
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.chip,
      padding: 3,
    },
    segmentItem: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6 },
    segmentItemActive: { backgroundColor: theme.colors.primary },
    segmentText: { fontFamily: theme.fonts.bodySemibold, fontSize: 13, color: theme.colors.textSecondary },
    segmentTextActive: { color: theme.colors.textOnPrimary },
    saveButton: {
      borderWidth: 1,
      borderColor: theme.colors.primary,
      borderRadius: theme.radius.control,
      paddingVertical: 10,
      alignItems: 'center',
    },
    saveButtonText: { fontFamily: theme.fonts.bodySemibold, fontSize: 14, color: theme.colors.primary },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.5 },
    addButton: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: theme.colors.primary,
      borderRadius: theme.radius.control,
      paddingVertical: 12,
      alignItems: 'center',
      marginBottom: 12,
    },
    addButtonText: { fontFamily: theme.fonts.bodySemibold, fontSize: 14, color: theme.colors.primary },
    pickTitle: { fontFamily: theme.fonts.bodySemibold, fontSize: 16, color: theme.colors.textPrimary },
    pickHint: { fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 },
    pickInput: {
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      borderRadius: theme.radius.control,
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginTop: 10,
      marginBottom: 6,
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textPrimary,
    },
    pickRow: {
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    pickCode: { fontFamily: theme.fonts.bodySemibold, fontSize: 15, color: theme.colors.textPrimary },
    pickMeta: { fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },
    pickCancel: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
    mapWrap: { flex: 1, minHeight: 480, borderRadius: theme.radius.card, overflow: 'hidden' },
    map: { flex: 1 },
    legend: {
      position: 'absolute',
      left: 10,
      top: 10,
      backgroundColor: 'rgba(15, 23, 42, 0.8)',
      borderRadius: 8,
      padding: 8,
      gap: 4,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { color: '#ffffff', fontSize: 11, fontFamily: theme.fonts.body },
    legendDotNone: { backgroundColor: NONE_COLOR, borderWidth: 1, borderColor: '#334155' },
    chipRow: { gap: 8, paddingRight: 8 },
    typeChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.colors.card,
    },
    typeChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    typeChipText: { fontFamily: theme.fonts.bodySemibold, fontSize: 13, color: theme.colors.textSecondary },
    typeChipTextActive: { color: theme.colors.textOnPrimary },
    typeBadge: {
      minWidth: 20,
      paddingHorizontal: 5,
      borderRadius: 10,
      backgroundColor: theme.colors.surfaceMuted,
      alignItems: 'center',
    },
    typeBadgeActive: { backgroundColor: 'rgba(255, 255, 255, 0.25)' },
    typeBadgeText: { fontFamily: theme.fonts.bodyBold, fontSize: 11, color: theme.colors.textPrimary },
    typeBadgeTextActive: { color: theme.colors.textOnPrimary },
    locateButton: {
      position: 'absolute',
      right: 10,
      top: 10,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: '#ffffff',
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 4,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
    },
    mapHint: {
      position: 'absolute',
      left: 10,
      right: 10,
      bottom: 10,
      backgroundColor: 'rgba(15, 23, 42, 0.85)',
      borderRadius: 10,
      padding: 10,
    },
    mapHintText: { color: '#E2E8F0', fontSize: 12, fontFamily: theme.fonts.body, textAlign: 'center' },
    poleCard: {
      position: 'absolute',
      left: 10,
      right: 10,
      bottom: 10,
      backgroundColor: 'rgba(15, 23, 42, 0.94)',
      borderRadius: 12,
      padding: 12,
      gap: 4,
    },
    poleCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    poleCardHeading: { color: '#93C5FD', fontSize: 12, fontFamily: theme.fonts.bodySemibold },
    poleCardCode: { color: '#ffffff', fontSize: 17, fontFamily: theme.fonts.bodyBold },
    poleCardMeta: { color: '#CBD5E1', fontSize: 12, fontFamily: theme.fonts.body },
    poleCardPhotos: { gap: 8, paddingVertical: 4 },
    poleCardPhoto: { width: 96, height: 96, borderRadius: 8, backgroundColor: '#1E293B' },
    poleCardPhotoLabel: { width: 96, color: '#CBD5E1', fontSize: 10, fontFamily: theme.fonts.body, marginTop: 2 },
    poleCardItem: { color: '#F1F5F9', fontSize: 13, fontFamily: theme.fonts.body },
    poleCardButton: {
      marginTop: 6,
      backgroundColor: theme.colors.primary,
      borderRadius: theme.radius.control,
      paddingVertical: 10,
      alignItems: 'center',
    },
    poleCardButtonText: { color: theme.colors.textOnPrimary, fontSize: 14, fontFamily: theme.fonts.bodySemibold },
  });
}

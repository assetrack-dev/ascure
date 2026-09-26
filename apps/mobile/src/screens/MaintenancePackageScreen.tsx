import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import Mapbox from '@rnmapbox/maps';
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
import { overlayKejanggalan, toAbsoluteUrl } from '../maintenance/maintenanceLocal';
import { useWorkPack } from '../maintenance/useWorkPack';
import { STATE_LABEL, type WorkPole, type WorkState } from '../maintenance/types';

type View_ = 'LIST' | 'MAP';
type Filter = 'OPEN' | 'ALL' | 'SUBMITTED';

/** Map / tile colour per pole state (worst Kejanggalan wins). */
const STATE_COLOR: Record<WorkState, string> = {
  TODO: '#DC2626',
  IN_PROGRESS: '#D98A0B',
  SUBMITTED: '#2563EB',
  CLOSED: '#15A34A',
};
const STATE_SPINE: Record<WorkState, SpineTone> = {
  TODO: 'red',
  IN_PROGRESS: 'amber',
  SUBMITTED: 'blue',
  CLOSED: 'green',
};
const STATE_ORDER: WorkState[] = ['TODO', 'IN_PROGRESS', 'SUBMITTED', 'CLOSED'];

type PoleRow = WorkPole & {
  state: WorkState;
  openCount: number;
  distanceM: number | null;
  labels: string[];
};

/**
 * One Pencawang package in maintenance mode (docs/PLAN-maintenance-flow.md
 * §7.1): every pole that needs repair, as a list or a map, with a one-tap
 * "save for offline" (work pack + photos + map tiles).
 */
export function MaintenancePackageScreen() {
  const navigation = useNavigation<RootStackScreenProps<'MaintenancePackage'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'MaintenancePackage'>['route']>();
  const { siteVisitId, title } = route.params;
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { pack, local, fromCache, cachedAt, isLoading, error, reload } = useWorkPack(siteVisitId);
  const [mode, setMode] = useState<View_>('LIST');
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [here, setHere] = useState<{ latitude: number; longitude: number } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Returning from a pole: pick up the crew's new local work immediately.
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) return;
        const fix = await getPositionWithTimeout({ timeoutMs: 4000 });
        if (fix) setHere({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
      })();
    }, []),
  );

  const rows: PoleRow[] = useMemo(() => {
    if (!pack) return [];
    return pack.poles.map((pole) => {
      const items = pole.kejanggalan.map((item) => overlayKejanggalan(item, local));
      const state = STATE_ORDER.find((candidate) => items.some((item) => item.displayState === candidate)) ?? 'CLOSED';
      return {
        ...pole,
        state,
        openCount: items.filter((item) => item.displayState === 'TODO' || item.displayState === 'IN_PROGRESS').length,
        distanceM:
          here && pole.latitude !== null && pole.longitude !== null
            ? distanceMeters(here, { latitude: pole.latitude, longitude: pole.longitude })
            : null,
        labels: [...new Set(items.map((item) => item.remark || item.label))],
      };
    });
  }, [here, local, pack]);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) =>
      filter === 'ALL' ? true : filter === 'OPEN' ? row.openCount > 0 : row.state === 'SUBMITTED',
    );
    // Nearest first when we know where the crew is; else pole order.
    return here
      ? [...filtered].sort((left, right) => (left.distanceM ?? Infinity) - (right.distanceM ?? Infinity))
      : filtered;
  }, [filter, here, rows]);

  const totals = useMemo(() => {
    const counts: Record<WorkState, number> = { TODO: 0, IN_PROGRESS: 0, SUBMITTED: 0, CLOSED: 0 };
    pack?.poles.forEach((pole) =>
      pole.kejanggalan.forEach((item) => {
        counts[overlayKejanggalan(item, local).displayState] += 1;
      }),
    );
    return counts;
  }, [local, pack]);

  const openPole = (assetId: string) =>
    navigation.navigate('MaintenancePole', { siteVisitId, assetId });

  const saveForOffline = async () => {
    if (!pack) return;
    setSaveError(null);
    setNotice(null);
    try {
      // 1) Photos: warm the image cache so survey + repair photos show offline.
      const urls = pack.poles.flatMap((pole) =>
        pole.kejanggalan.flatMap((item) => [
          ...item.surveyPhotos.map((photo) => photo.url),
          ...item.photos.BEFORE.map((photo) => photo.url),
          ...item.photos.DURING.map((photo) => photo.url),
          ...item.photos.AFTER.map((photo) => photo.url),
        ]),
      );
      let done = 0;
      for (const url of urls) {
        setSaving(`Saving photos ${done + 1}/${urls.length}…`);
        await Image.prefetch(toAbsoluteUrl(url)).catch(() => false);
        done += 1;
      }

      // 2) Map tiles around the poles (satellite), if the map is configured.
      const located = pack.poles.filter((pole) => pole.latitude !== null && pole.longitude !== null);
      let mapNote = '';
      if (hasMapboxToken() && located.length > 0) {
        const lats = located.map((pole) => pole.latitude as number);
        const lngs = located.map((pole) => pole.longitude as number);
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
      setNotice(`Saved for offline: ${pack.poles.length} poles, ${urls.length} photos.${mapNote}`);
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
          properties: { assetId: row.assetId, color: STATE_COLOR[row.state], label: row.refCode || row.assetCode },
          geometry: { type: 'Point' as const, coordinates: [row.longitude as number, row.latitude as number] },
        })),
    }),
    [rows],
  );
  const center = useMemo(() => {
    const located = rows.filter((row) => row.latitude !== null && row.longitude !== null);
    if (located.length === 0) return null;
    return [
      located.reduce((sum, row) => sum + (row.longitude as number), 0) / located.length,
      located.reduce((sum, row) => sum + (row.latitude as number), 0) / located.length,
    ] as [number, number];
  }, [rows]);

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
            <Segment
              options={[['OPEN', 'To repair'], ['SUBMITTED', 'Submitted'], ['ALL', 'All']]}
              value={filter}
              onChange={setFilter}
              styles={styles}
            />
          </View>
          <Pressable
            onPress={() => void saveForOffline()}
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

      {pack && mode === 'LIST' ? (
        visibleRows.length === 0 ? (
          <Card>
            <EmptyState
              icon="check-circle"
              title={filter === 'OPEN' ? 'Nothing left to repair' : 'No poles here'}
              description={filter === 'OPEN' ? 'Every Kejanggalan on this Pencawang has been submitted.' : 'Try another filter.'}
            />
          </Card>
        ) : (
          visibleRows.map((row) => (
            <StatusSpineTile
              key={row.assetId}
              code={row.refCode || row.assetCode}
              spine={STATE_SPINE[row.state]}
              chip={{
                label: row.openCount > 0 ? `${row.openCount} to repair` : STATE_LABEL[row.state],
                tone: row.state === 'TODO' ? 'danger' : row.state === 'IN_PROGRESS' ? 'warning' : row.state === 'SUBMITTED' ? 'info' : 'success',
              }}
              secondary={row.labels.join(' · ')}
              meta={[
                row.refCode ? row.assetCode : null,
                row.distanceM !== null ? formatDistance(row.distanceM) : null,
                row.latitude === null ? 'No GPS on record' : null,
              ]}
              onPress={() => openPole(row.assetId)}
            />
          ))
        )
      ) : null}

      {pack && mode === 'MAP' ? (
        hasMapboxToken() && center ? (
          <View style={styles.mapWrap}>
            <Mapbox.MapView style={styles.map} styleURL={SATELLITE_STYLE} scaleBarEnabled={false}>
              <Mapbox.Camera defaultSettings={{ centerCoordinate: center, zoomLevel: 15 }} animationMode="none" />
              <Mapbox.LocationPuck visible puckBearing="heading" />
              {/* GPU circle layer (never one native view per pole). */}
              <Mapbox.ShapeSource
                id="repair-poles"
                shape={features}
                onPress={(event) => {
                  const assetId = event.features?.[0]?.properties?.assetId;
                  if (typeof assetId === 'string') openPole(assetId);
                }}
              >
                <Mapbox.CircleLayer
                  id="repair-pole-circles"
                  style={{
                    circleColor: ['get', 'color'],
                    circleRadius: 9,
                    circleStrokeWidth: 2,
                    circleStrokeColor: '#ffffff',
                  }}
                />
                <Mapbox.SymbolLayer
                  id="repair-pole-labels"
                  minZoomLevel={15}
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
            </View>
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
    mapWrap: { flex: 1, minHeight: 420, borderRadius: theme.radius.card, overflow: 'hidden' },
    map: { flex: 1 },
    legend: {
      position: 'absolute',
      left: 10,
      bottom: 10,
      backgroundColor: 'rgba(15, 23, 42, 0.8)',
      borderRadius: 8,
      padding: 8,
      gap: 4,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { color: '#ffffff', fontSize: 11, fontFamily: theme.fonts.body },
  });
}

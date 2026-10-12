import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import Mapbox, { type Camera as MapboxCamera } from '@rnmapbox/maps';
import { useFocusEffect } from '@react-navigation/native';
import { SATELLITE_STYLE, hasMapboxToken } from '../mapbox';
import { getPositionWithTimeout } from '../location';
import { Card, EmptyState } from '../ui';
import { Theme, useTheme } from '../theme';
import { STATUS_COLOR, STATUS_LABEL, pencawangLabel, type PeStatus, type PeSummary } from '../maintenance/board';

/**
 * Every Pencawang given to the manager on one map, coloured by repair status
 * (docs/PLAN-maintenance-flow.md §18, M46). GPU circle layer — never one
 * native view per point (see the mobile 10k-ANR lesson). Tap a Pencawang for
 * its card (rendered by the screen: same tile as the list, with Open + Assign).
 */

const LEGEND: PeStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'DONE', 'NO_COMPANY'];
const SORT_KEY: Record<PeStatus, number> = { DONE: 0, NO_COMPANY: 1, WAITING: 2, IN_PROGRESS: 3, NOT_STARTED: 4 };

function located(summary: PeSummary): summary is PeSummary & { row: { latitude: number; longitude: number } } {
  return summary.row.latitude !== null && summary.row.longitude !== null;
}

function boundsOf(rows: PeSummary[]) {
  const points = rows.filter(located);
  if (points.length === 0) return null;
  const lats = points.map((summary) => summary.row.latitude as number);
  const lngs = points.map((summary) => summary.row.longitude as number);
  // A single Pencawang (or a tight group) still gets some context around it.
  const pad = 0.003;
  return {
    ne: [Math.max(...lngs) + pad, Math.max(...lats) + pad] as [number, number],
    sw: [Math.min(...lngs) - pad, Math.min(...lats) - pad] as [number, number],
  };
}

export function PencawangProgressMap({
  rows,
  showNoCompany,
  renderCard,
}: {
  /** The filtered list — the map shows the same Pencawang as the list. */
  rows: PeSummary[];
  /** Main Contractor: "Not given out" is a state it can act on. */
  showNoCompany: boolean;
  renderCard: (summary: PeSummary, onClose: () => void) => ReactNode;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const cameraRef = useRef<MapboxCamera>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locationGranted, setLocationGranted] = useState(false);

  // Show the puck if the user already allowed location (never prompt on open).
  useFocusEffect(
    useCallback(() => {
      void Location.getForegroundPermissionsAsync().then((permission) => setLocationGranted(permission.granted));
    }, []),
  );

  const bounds = useMemo(() => boundsOf(rows), [rows]);
  const unlocated = rows.length - rows.filter(located).length;
  const selected = rows.find((summary) => summary.row.siteVisitId === selectedId) ?? null;

  // A filter that hides the selected Pencawang closes its card.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selected, selectedId]);

  const features = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: rows.filter(located).map((summary) => {
        const color = STATUS_COLOR[summary.status];
        // Hollow = open work with a company but no team yet.
        const hollow = summary.noTeam > 0 && summary.status !== 'DONE' && summary.status !== 'NO_COMPANY';
        return {
          type: 'Feature' as const,
          id: summary.row.siteVisitId,
          properties: {
            siteVisitId: summary.row.siteVisitId,
            fill: hollow ? '#ffffff' : color,
            stroke: summary.overdue ? '#7f1d1d' : hollow ? color : '#ffffff',
            strokeWidth: summary.overdue || hollow ? 3.5 : 2,
            sortKey: SORT_KEY[summary.status] + (summary.overdue ? 10 : 0),
            selected: summary.row.siteVisitId === selectedId ? 1 : 0,
            count: `${summary.progress.closed}/${summary.total}`,
            name: pencawangLabel(summary.row),
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [summary.row.longitude as number, summary.row.latitude as number],
          },
        };
      }),
    }),
    [rows, selectedId],
  );

  const fitAll = () => {
    if (!bounds) return;
    setSelectedId(null);
    cameraRef.current?.fitBounds(bounds.ne, bounds.sw, [70, 40, 160, 40], 600);
  };

  const locateMe = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Location is off', 'Allow ASCURE to use your location to see where you are on the map.');
      return;
    }
    setLocationGranted(true);
    const fix = await getPositionWithTimeout({ accuracy: Location.Accuracy.High, timeoutMs: 6000 });
    if (!fix) {
      Alert.alert('No GPS fix yet', 'Move to open sky and try again.');
      return;
    }
    cameraRef.current?.setCamera({
      centerCoordinate: [fix.coords.longitude, fix.coords.latitude],
      zoomLevel: 13,
      animationDuration: 600,
      animationMode: 'flyTo',
    });
  };

  if (!hasMapboxToken() || !bounds) {
    return (
      <Card>
        <EmptyState
          icon="map"
          title="Map unavailable"
          description={
            hasMapboxToken()
              ? 'None of these Pencawang has a location yet. Use the list.'
              : 'The map is not configured in this build. Use the list.'
          }
        />
      </Card>
    );
  }

  return (
    <View style={styles.mapWrap}>
      <Mapbox.MapView style={styles.map} styleURL={SATELLITE_STYLE} scaleBarEnabled={false}>
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{
            bounds: { ne: bounds.ne, sw: bounds.sw },
            padding: { paddingTop: 70, paddingRight: 40, paddingBottom: 160, paddingLeft: 40 },
          }}
          animationMode="none"
        />
        <Mapbox.LocationPuck visible={locationGranted} puckBearing="heading" puckBearingEnabled />
        <Mapbox.ShapeSource
          id="pencawang-progress"
          shape={features}
          hitbox={{ width: 30, height: 30 }}
          onPress={(event) => {
            const id = event.features?.[0]?.properties?.siteVisitId;
            if (typeof id === 'string') setSelectedId(id);
          }}
        >
          <Mapbox.CircleLayer
            id="pencawang-progress-selected"
            filter={['==', ['get', 'selected'], 1]}
            style={{
              circleColor: 'rgba(56, 189, 248, 0.35)',
              circleRadius: 22,
              circleStrokeWidth: 2,
              circleStrokeColor: '#38BDF8',
            }}
          />
          <Mapbox.CircleLayer
            id="pencawang-progress-circles"
            style={{
              circleColor: ['get', 'fill'],
              circleRadius: 11,
              circleStrokeWidth: ['get', 'strokeWidth'],
              circleStrokeColor: ['get', 'stroke'],
              circleSortKey: ['get', 'sortKey'],
            }}
          />
          <Mapbox.SymbolLayer
            id="pencawang-progress-labels"
            minZoomLevel={11}
            style={{
              textField: ['format', ['get', 'count'], {}, '\n', {}, ['get', 'name'], { 'font-scale': 0.85 }],
              textSize: 11,
              textColor: '#ffffff',
              textHaloColor: 'rgba(15, 23, 42, 0.9)',
              textHaloWidth: 1.2,
              textOffset: [0, 1.3],
              textAnchor: 'top',
              textAllowOverlap: false,
            }}
          />
        </Mapbox.ShapeSource>
      </Mapbox.MapView>

      <View style={styles.legend} pointerEvents="none">
        {LEGEND.filter((status) => showNoCompany || status !== 'NO_COMPANY').map((status) => (
          <View key={status} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: STATUS_COLOR[status] }]} />
            <Text style={styles.legendText}>{STATUS_LABEL[status]}</Text>
          </View>
        ))}
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendHollow]} />
          <Text style={styles.legendText}>No team yet</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.legendOverdue]} />
          <Text style={styles.legendText}>Overdue</Text>
        </View>
      </View>

      <View style={styles.mapButtons}>
        <Pressable
          onPress={() => void locateMe()}
          style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Show my location"
        >
          <Feather name="crosshair" size={21} color="#0F172A" />
        </Pressable>
        <Pressable
          onPress={fitAll}
          style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Show every Pencawang"
        >
          <Feather name="maximize" size={20} color="#0F172A" />
        </Pressable>
      </View>

      {selected ? (
        <View style={styles.cardDock}>{renderCard(selected, () => setSelectedId(null))}</View>
      ) : (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>
            Tap a Pencawang for its teams and progress.
            {unlocated > 0 ? ` ${unlocated} without a location are only in the list.` : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    mapWrap: { flex: 1, minHeight: 420, borderRadius: theme.radius.card, overflow: 'hidden', marginBottom: 12 },
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
    legendHollow: { backgroundColor: '#ffffff', borderWidth: 2, borderColor: STATUS_COLOR.IN_PROGRESS },
    legendOverdue: { backgroundColor: STATUS_COLOR.NOT_STARTED, borderWidth: 2, borderColor: '#7f1d1d' },
    legendText: { color: '#ffffff', fontSize: 11, fontFamily: theme.fonts.body },
    mapButtons: { position: 'absolute', right: 10, top: 10, gap: 10 },
    mapButton: {
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
    pressed: { opacity: 0.7 },
    cardDock: { position: 'absolute', left: 8, right: 8, bottom: 8 },
    hint: {
      position: 'absolute',
      left: 10,
      right: 10,
      bottom: 10,
      backgroundColor: 'rgba(15, 23, 42, 0.85)',
      borderRadius: 10,
      padding: 10,
    },
    hintText: { color: '#E2E8F0', fontSize: 12, fontFamily: theme.fonts.body, textAlign: 'center' },
  });
}

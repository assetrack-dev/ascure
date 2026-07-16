import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import * as Location from 'expo-location';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Screen, ErrorBanner, Mono } from '../ui';
import { Theme, useTheme } from '../theme';
import { useSync } from '../context/SyncContext';
import { useSession } from '../context/AuthContext';
import { prepareAssignedAreasForOffline } from '../prepareForOffline';
import { getPositionWithTimeout } from '../location';
import {
  SATELLITE_STYLE,
  OFFLINE_MIN_ZOOM,
  OFFLINE_MAX_ZOOM,
  OFFLINE_TILE_LIMIT,
  estimateTileCount,
  downloadOfflineRegion,
  listOfflinePacks,
  deleteOfflineRegion,
  hasMapboxToken,
  type OfflinePackInfo,
} from '../mapbox';
import type { AppDrawerScreenProps } from '../navigation/types';

// Peninsular Malaysia fallback centre if no GPS fix is available yet.
const DEFAULT_CENTER: [number, number] = [101.9758, 4.2105];
const DEFAULT_ZOOM = 15;

/**
 * Download satellite imagery for a work area so the crew can place markers
 * precisely on poles with ZERO signal. Pan/zoom the map to frame the area, watch
 * the live tile estimate against Mapbox's 6,000-tile offline budget, then
 * download. Packs are app-wide per style, so the main Map screen serves these
 * same tiles when offline.
 */
export function OfflineMapsScreen() {
  const navigation = useNavigation<AppDrawerScreenProps<'OfflineMaps'>['navigation']>();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { isOffline } = useSync();
  const { token } = useSession();

  const mapRef = useRef<Mapbox.MapView>(null);

  const [center, setCenter] = useState<[number, number] | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [packs, setPacks] = useState<OfflinePackInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [locGranted, setLocGranted] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareStatus, setPrepareStatus] = useState('');

  const refreshPacks = useCallback(async () => {
    try {
      setPacks(await listOfflinePacks());
    } catch (err) {
      // best-effort — the list is informational, but log so a failing status
      // read doesn't silently leave "Saved areas (0)".
      console.warn('Offline pack refresh failed', err);
    }
  }, []);

  // Centre on the crew's current position (best-effort) + load existing packs.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!active) return;
        setLocGranted(perm.granted);
        if (perm.granted) {
          const fix = await getPositionWithTimeout();
          if (active && fix) {
            setCenter([fix.coords.longitude, fix.coords.latitude]);
          }
        }
      } catch {
        // ignore — fall back to DEFAULT_CENTER
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshPacks();
    }, [refreshPacks]),
  );

  // Recompute the tile estimate for whatever the map currently frames.
  const updateEstimate = useCallback(async () => {
    try {
      const bounds = await mapRef.current?.getVisibleBounds();
      if (!bounds) return;
      const [ne, sw] = bounds as [[number, number], [number, number]];
      setEstimate(estimateTileCount(sw, ne, OFFLINE_MIN_ZOOM, OFFLINE_MAX_ZOOM));
    } catch {
      setEstimate(null);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setError(null);
    try {
      const bounds = await mapRef.current?.getVisibleBounds();
      if (!bounds) {
        setError('Could not read the map area — try again.');
        return;
      }
      const [ne, sw] = bounds as [[number, number], [number, number]];
      setBusy(true);
      setProgress(0);
      await downloadOfflineRegion(
        {
          id: `area-${Date.now()}`,
          label: `Offline area ${packs.length + 1}`,
          ne,
          sw,
        },
        (pct) => setProgress(pct),
      );
      await refreshPacks();
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : 'Download failed. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }, [busy, packs.length, refreshPacks]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteOfflineRegion(id);
        await refreshPacks();
      } catch {
        setError('Could not delete that offline area.');
      }
    },
    [refreshPacks],
  );

  // Depot one-tap: warm the reference + assigned-visit caches and auto-download a
  // satellite pack per assigned Pencawang (bbox computed from its poles).
  const handlePrepare = useCallback(async () => {
    if (preparing || busy) {
      return;
    }

    setError(null);
    setPreparing(true);
    setPrepareStatus('Preparing…');

    try {
      const summary = await prepareAssignedAreasForOffline(token, (update) =>
        setPrepareStatus(update.message),
      );
      await refreshPacks();

      const lines = [
        `${summary.areasCached} area${summary.areasCached === 1 ? '' : 's'} saved for offline.`,
        summary.mapsToken
          ? `${summary.mapsDownloaded} map${summary.mapsDownloaded === 1 ? '' : 's'} downloaded.`
          : 'Map imagery isn’t configured for this build.',
      ];
      if (summary.mapsSkippedNoCoords > 0) {
        lines.push(
          `${summary.mapsSkippedNoCoords} area(s) had no pole coordinates yet — frame & download them below.`,
        );
      }
      if (summary.mapsSkippedBudget > 0) {
        lines.push(
          `${summary.mapsSkippedBudget} map(s) skipped to stay under the ${OFFLINE_TILE_LIMIT.toLocaleString()}-tile limit.`,
        );
      }
      if (summary.mapsFailed > 0) {
        lines.push(`${summary.mapsFailed} map download(s) failed — check signal and retry.`);
      }

      Alert.alert('Ready for offline', lines.join('\n'));
    } catch (prepareError) {
      setError(
        prepareError instanceof Error ? prepareError.message : 'Could not prepare offline data.',
      );
    } finally {
      setPreparing(false);
      setPrepareStatus('');
    }
  }, [preparing, busy, token, refreshPacks]);

  const overBudget = estimate != null && estimate > OFFLINE_TILE_LIMIT;
  const downloadDisabled = busy || isOffline || overBudget || !hasMapboxToken();
  const prepareDisabled = preparing || busy || isOffline;

  return (
    <Screen
      title="Offline Maps"
      subtitle="Download satellite imagery for no-signal areas"
      leftAction={{
        icon: 'menu',
        onPress: () => navigation.openDrawer(),
        accessibilityLabel: 'Menu',
      }}
      scroll={false}
    >
      <ErrorBanner message={error} />
      {!hasMapboxToken() ? (
        <ErrorBanner message="Map imagery isn't configured for this build (no Mapbox token)." />
      ) : null}

      <View style={styles.mapShell}>
        <Mapbox.MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          styleURL={SATELLITE_STYLE}
          scaleBarEnabled={false}
          compassEnabled={false}
          onMapIdle={() => {
            void updateEstimate();
          }}
        >
          <Mapbox.Camera
            animationMode="none"
            defaultSettings={{
              centerCoordinate: center ?? DEFAULT_CENTER,
              zoomLevel: center ? DEFAULT_ZOOM : 6,
            }}
          />
          {locGranted ? <Mapbox.LocationPuck visible /> : null}
        </Mapbox.MapView>

        {/* Frame guide: the whole visible area is what gets downloaded. */}
        <View pointerEvents="none" style={styles.frameGuide} />
        <View pointerEvents="none" style={styles.frameHintWrap}>
          <Text style={styles.frameHint}>Pan &amp; zoom to frame your work area</Text>
        </View>
      </View>

      <View style={styles.panel}>
        {/* Depot one-tap: save assigned areas + their maps for offline. */}
        <Pressable
          accessibilityRole="button"
          disabled={prepareDisabled}
          onPress={() => void handlePrepare()}
          style={({ pressed }) => [
            styles.prepareBtn,
            prepareDisabled && styles.prepareBtnDisabled,
            pressed && !prepareDisabled && styles.prepareBtnPressed,
          ]}
        >
          {preparing ? (
            <>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={styles.prepareBtnText} numberOfLines={1}>
                {prepareStatus || 'Preparing…'}
              </Text>
            </>
          ) : (
            <>
              <Feather name="hard-drive" size={18} color={theme.colors.primary} />
              <Text style={styles.prepareBtnText}>
                {isOffline ? 'Connect to prepare assigned areas' : 'Prepare my assigned areas'}
              </Text>
            </>
          )}
        </Pressable>
        <Text style={styles.prepareHint}>
          Saves your teams, Pencawang list &amp; assigned poles, and downloads their satellite maps —
          do this at the depot on wifi.
        </Text>
        <View style={styles.panelDivider} />

        <View style={styles.estimateRow}>
          <Text style={styles.estimateLabel}>This area</Text>
          <Mono size={13} color={overBudget ? theme.colors.danger : theme.colors.textSecondary}>
            {estimate == null
              ? '—'
              : `≈ ${estimate.toLocaleString()} / ${OFFLINE_TILE_LIMIT.toLocaleString()} tiles`}
          </Mono>
        </View>
        {overBudget ? (
          <Text style={styles.overBudget}>Area too large — zoom in to fit the tile budget.</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={downloadDisabled}
          onPress={() => void handleDownload()}
          style={({ pressed }) => [
            styles.downloadBtn,
            downloadDisabled && styles.downloadBtnDisabled,
            pressed && !downloadDisabled && styles.downloadBtnPressed,
          ]}
        >
          {busy ? (
            <>
              <ActivityIndicator color={theme.colors.textOnPrimary} />
              <Text style={styles.downloadBtnText}>Downloading… {Math.round(progress)}%</Text>
            </>
          ) : (
            <>
              <Feather name="download-cloud" size={18} color={theme.colors.textOnPrimary} />
              <Text style={styles.downloadBtnText}>
                {isOffline ? 'Connect to the internet to download' : 'Download this area'}
              </Text>
            </>
          )}
        </Pressable>

        {/* Saved offline areas */}
        <Text style={styles.savedTitle}>Saved areas ({packs.length})</Text>
        {packs.length === 0 ? (
          <Text style={styles.savedEmpty}>None yet — frame an area above and download it.</Text>
        ) : (
          <View style={styles.packList}>
            {packs.map((pack) => (
              <View key={pack.id} style={styles.packRow}>
                <View style={styles.packTextWrap}>
                  <Text style={styles.packLabel} numberOfLines={1}>
                    {pack.label}
                  </Text>
                  <Text style={styles.packMeta}>
                    {pack.complete ? 'Ready offline' : `${Math.round(pack.percentage ?? 0)}%`} ·{' '}
                    {((pack.bytes ?? 0) / 1048576).toFixed(1)} MB ·{' '}
                    {(pack.tileCount ?? 0).toLocaleString()} tiles
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${pack.label}`}
                  hitSlop={8}
                  onPress={() => void handleDelete(pack.id)}
                  style={styles.packDelete}
                >
                  <Feather name="trash-2" size={18} color={theme.colors.danger} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    mapShell: {
      flex: 1,
      borderRadius: t.radius.card,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    frameGuide: {
      ...StyleSheet.absoluteFillObject,
      margin: 16,
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.85)',
      borderRadius: 10,
    },
    frameHintWrap: {
      position: 'absolute',
      top: 12,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    frameHint: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: '700',
      backgroundColor: 'rgba(0,0,0,0.55)',
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 12,
      overflow: 'hidden',
    },
    panel: {
      gap: 10,
      paddingTop: 12,
    },
    prepareBtn: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: t.colors.primary,
      backgroundColor: t.colors.surfaceMuted,
      paddingHorizontal: 16,
    },
    prepareBtnDisabled: {
      opacity: 0.5,
    },
    prepareBtnPressed: {
      backgroundColor: t.colors.card,
    },
    prepareBtnText: {
      fontSize: 14.5,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
      color: t.colors.primary,
      flexShrink: 1,
    },
    prepareHint: {
      fontSize: 12,
      color: t.colors.textSecondary,
      fontFamily: t.fonts.body,
      lineHeight: 16,
    },
    panelDivider: {
      height: 1,
      backgroundColor: t.colors.border,
      marginVertical: 2,
    },
    estimateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    estimateLabel: {
      fontSize: 14,
      fontFamily: t.fonts.bodySemibold,
      fontWeight: '600',
      color: t.colors.textPrimary,
    },
    overBudget: {
      fontSize: 12.5,
      color: t.colors.danger,
      fontFamily: t.fonts.bodySemibold,
    },
    downloadBtn: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.primary,
      paddingHorizontal: 16,
    },
    downloadBtnDisabled: {
      backgroundColor: t.colors.surfaceMuted,
    },
    downloadBtnPressed: {
      backgroundColor: t.colors.primaryStrong,
    },
    downloadBtnText: {
      fontSize: 15,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
      color: t.colors.textOnPrimary,
    },
    savedTitle: {
      fontSize: 13,
      fontWeight: '700',
      fontFamily: t.fonts.display,
      color: t.colors.textPrimary,
      marginTop: 4,
    },
    savedEmpty: {
      fontSize: 13,
      color: t.colors.textSecondary,
      fontFamily: t.fonts.body,
    },
    packList: {
      gap: 8,
    },
    packRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      padding: 12,
    },
    packTextWrap: {
      flex: 1,
      gap: 2,
    },
    packLabel: {
      fontSize: 14,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
      color: t.colors.textPrimary,
    },
    packMeta: {
      fontSize: 12,
      color: t.colors.textSecondary,
      fontFamily: t.fonts.body,
    },
    packDelete: {
      padding: 6,
    },
  });

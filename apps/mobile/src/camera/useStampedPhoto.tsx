import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, PixelRatio, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import { captureRef } from 'react-native-view-shot';
import { captureWithCamera, type DefectMark, type MarkCategory } from './captureWithCamera';
import { MarkOverlay } from './MarkOverlay';
import { TiltOverlay } from './TiltOverlay';
import { TimestampStamp } from './TimestampStamp';
import { getPositionWithTimeout } from '../location';

/**
 * Evidence-grade photo: in-app camera → FRESH GPS fix → date / GPS / defect
 * circle burned into the pixels. Same guarantees as the inspection form
 * (docs/PLAN-maintenance-flow.md §6): high accuracy, no last-known fix older
 * than 60 s, the burn waits for the photo to actually load (the blank/darker
 * photo bug), and a mocked location is flagged.
 *
 * Usage: `const { takeStampedPhoto, overlay } = useStampedPhoto();` and render
 * `{overlay}` anywhere in the screen (it is off-screen).
 */
export type StampedPhoto = {
  uri: string;
  takenAt: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  mocked: boolean;
};

type Pending = {
  originalUri: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  tiltLineAngle: number | null;
  mark: DefectMark | null;
  captureWidth: number;
  captureHeight: number;
  layoutWidth: number;
  layoutHeight: number;
};

const IMAGE_LOAD_TIMEOUT_MS = 8000;

export function useStampedPhoto() {
  const [pending, setPending] = useState<Pending | null>(null);
  const canvasRef = useRef<View>(null);
  const loadSignalRef = useRef<ReturnType<typeof createSignal> | null>(null);
  const handlersRef = useRef<{ resolve: (uri: string) => void; reject: (error: Error) => void } | null>(null);

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;

    const burn = async () => {
      try {
        await waitWithTimeout(loadSignalRef.current?.promise);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        if (!canvasRef.current) throw new Error('Unable to prepare the stamped photo.');
        const uri = await captureRef(canvasRef, {
          format: 'jpg',
          quality: 0.9,
          result: 'tmpfile',
          width: pending.captureWidth,
          height: pending.captureHeight,
        });
        if (!cancelled) handlersRef.current?.resolve(uri);
      } catch (error) {
        if (!cancelled) {
          handlersRef.current?.reject(
            error instanceof Error ? error : new Error('Unable to stamp the photo.'),
          );
        }
      } finally {
        if (!cancelled) {
          handlersRef.current = null;
          loadSignalRef.current = null;
          setPending(null);
        }
      }
    };

    void burn();
    return () => {
      cancelled = true;
    };
  }, [pending]);

  const takeStampedPhoto = useCallback(
    async (options?: { markCategory?: MarkCategory }): Promise<StampedPhoto | null> => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Location permission is required to stamp GPS on the photo.');
      }

      const shot = await captureWithCamera({
        mode: 'photo',
        allowMark: true,
        ...(options?.markCategory
          ? { initialMarkCategory: options.markCategory, lockMarkCategory: true }
          : {}),
      });
      if (!shot) return null;

      const takenAt = new Date().toISOString();
      const position = await getPositionWithTimeout({
        accuracy: Location.Accuracy.High,
        maxLastKnownAgeMs: 60_000,
      });
      if (!position) {
        throw new Error('Could not get a fresh GPS fix for the photo. Move to open sky and try again.');
      }

      const size = await captureSize(shot.uri, shot.width, shot.height);
      const uri = await new Promise<string>((resolve, reject) => {
        handlersRef.current = { resolve, reject };
        loadSignalRef.current = createSignal();
        setPending({
          originalUri: shot.uri,
          timestamp: takenAt,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          tiltLineAngle: shot.tiltLineAngle ?? null,
          mark: shot.mark ?? null,
          ...size,
        });
      });

      return {
        uri,
        takenAt,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: typeof position.coords.accuracy === 'number' ? position.coords.accuracy : null,
        mocked: position.mocked === true,
      };
    },
    [],
  );

  const overlay = pending ? (
    <View pointerEvents="none" style={styles.root}>
      <View
        ref={canvasRef}
        collapsable={false}
        style={[styles.canvas, { width: pending.layoutWidth, height: pending.layoutHeight }]}
      >
        <Image
          source={{ uri: pending.originalUri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
          fadeDuration={0}
          onLoad={() => loadSignalRef.current?.resolve()}
          onError={() =>
            loadSignalRef.current?.reject(new Error('Could not render the captured photo. Please retake it.'))
          }
        />
        {pending.tiltLineAngle != null ? <TiltOverlay angleDeg={pending.tiltLineAngle} /> : null}
        {pending.mark ? <MarkOverlay mark={pending.mark} /> : null}
        <View style={styles.stamp}>
          <TimestampStamp
            date={new Date(pending.timestamp)}
            latitude={pending.latitude}
            longitude={pending.longitude}
          />
        </View>
      </View>
    </View>
  ) : null;

  return { takeStampedPhoto, overlay, isStamping: pending !== null };
}

function createSignal() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

async function waitWithTimeout(promise: Promise<void> | undefined) {
  if (!promise) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Preparing the photo stamp took too long. Please retake the photo.')),
          IMAGE_LOAD_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function captureSize(uri: string, width?: number, height?: number) {
  const size =
    width && height
      ? { width, height }
      : await new Promise<{ width: number; height: number }>((resolve, reject) =>
          Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), () =>
            reject(new Error('Unable to measure the captured photo.')),
          ),
        );
  const longest = Math.max(size.width, size.height);
  const scale = longest > 1600 ? 1600 / longest : 1;
  const captureWidth = Math.max(1, Math.round(size.width * scale));
  const captureHeight = Math.max(1, Math.round(size.height * scale));
  const ratio = PixelRatio.get() || 1;
  return {
    captureWidth,
    captureHeight,
    layoutWidth: captureWidth / ratio,
    layoutHeight: captureHeight / ratio,
  };
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: -10000, top: 0 },
  canvas: { position: 'relative', backgroundColor: '#000000' },
  stamp: { position: 'absolute', right: 8, bottom: 8 },
});

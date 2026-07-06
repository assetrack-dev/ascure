import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
  type CameraType,
  type FlashMode,
} from 'expo-camera';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import {
  GestureDetector,
  GestureHandlerRootView,
  Gesture,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { registerCameraCaptureHost, type CaptureRequest } from './captureWithCamera';
import { TimestampStamp } from './TimestampStamp';
import { TiltOverlay } from './TiltOverlay';

type ReviewPhoto = {
  uri: string;
  width: number;
  height: number;
  tiltLineAngle: number | null;
};
type Fix = { latitude: number; longitude: number; accuracy: number | null };

const ZOOM_PRESETS = [
  { label: '1×', value: 0 },
  { label: '2×', value: 0.33 },
  { label: '4×', value: 0.66 },
];
const LEVEL_TOLERANCE_DEG = 1.5;

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/**
 * Root-mounted in-app camera. Fixes the "unregistered ActivityResultLauncher"
 * crash by capturing in-app (no system-camera Intent). Mounted once in App.tsx.
 *
 * Tilt tool: the phone stays LEVEL (so the photo is vertically straight); a static
 * vertical axis is shown and the user swings a measurement line (drag) onto the
 * pole. The angle between them is measured and burned into the photo via
 * <TiltOverlay>. A small gravity "hold level" assist keeps shots true-vertical.
 */
export function CameraCaptureHost() {
  const [request, setRequest] = useState<CaptureRequest | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] =
    useMicrophonePermissions();

  const cameraRef = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();

  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [permissionsReady, setPermissionsReady] = useState(false);

  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(0);
  const [reviewPhoto, setReviewPhoto] = useState<ReviewPhoto | null>(null);

  const [now, setNow] = useState(() => new Date());
  const [fix, setFix] = useState<Fix | null>(null);

  // Tilt tool
  const [tiltMode, setTiltMode] = useState(false);
  const [lineAngleDeg, setLineAngleDeg] = useState(0);
  const [deviceRoll, setDeviceRoll] = useState<number | null>(null);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });

  const requestRef = useRef<CaptureRequest | null>(null);
  requestRef.current = request;
  const zoomRef = useRef(0);
  zoomRef.current = zoom;
  const zoomBase = useRef(0);
  const lineAngleRef = useRef(0);
  lineAngleRef.current = lineAngleDeg;
  const frameSizeRef = useRef(frameSize);
  frameSizeRef.current = frameSize;

  useEffect(() => registerCameraCaptureHost(setRequest), []);

  const visible = request != null;
  const mode = request?.mode ?? 'photo';

  // Swing the measurement line about the frame centre to follow the drag.
  function swingLine(x: number, y: number) {
    const { w, h } = frameSizeRef.current;
    if (!w || !h) return;
    let deg = (Math.atan2(x - w / 2, -(y - h / 2)) * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    else if (deg < -90) deg += 180;
    setLineAngleDeg(deg);
  }

  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      zoomBase.current = zoomRef.current;
    })
    .onUpdate((event) => {
      setZoom(clamp01(zoomBase.current + (event.scale - 1) * 0.4));
    });

  const linePanGesture = Gesture.Pan()
    .runOnJS(true)
    .onBegin((event) => swingLine(event.x, event.y))
    .onUpdate((event) => swingLine(event.x, event.y));

  const activeGesture = tiltMode ? linePanGesture : pinchGesture;

  useEffect(() => {
    if (!visible) return;
    setIsCameraReady(false);
    setIsCapturing(false);
    setIsRecording(false);
    setFacing('back');
    setFlash('off');
    setZoom(0);
    setReviewPhoto(null);
    setTiltMode(false);
    setLineAngleDeg(0);
    setDeviceRoll(null);
  }, [visible]);

  // Live clock + GPS for the on-screen stamp.
  useEffect(() => {
    if (!visible) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);

    let active = true;
    let sub: Location.LocationSubscription | null = null;
    setFix(null);
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!active || !perm.granted) return;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced },
          (pos) => {
            setFix({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? null,
            });
          },
        );
      } catch {
        // Non-fatal: the stamp shows "GPS: locating…".
      }
    })();

    return () => {
      active = false;
      clearInterval(timer);
      sub?.remove();
    };
  }, [visible]);

  // "Hold level" assist — device roll from gravity, only while Tilt mode is on.
  useEffect(() => {
    if (!visible || !tiltMode) {
      setDeviceRoll(null);
      return;
    }
    DeviceMotion.setUpdateInterval(150);
    const sub = DeviceMotion.addListener((data) => {
      const g = data.accelerationIncludingGravity;
      if (!g) return;
      setDeviceRoll((Math.atan2(g.x, -g.y) * 180) / Math.PI);
    });
    return () => sub.remove();
  }, [visible, tiltMode]);

  useEffect(() => {
    const active = request;
    if (!active) {
      setPermissionsReady(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let camera = cameraPermission;
        if (!camera?.granted) {
          camera = await requestCameraPermission();
        }
        if (cancelled) return;
        if (!camera.granted) {
          active.reject(new Error('Camera permission is required to capture photos.'));
          return;
        }
        if (active.mode === 'video') {
          let mic = microphonePermission;
          if (!mic?.granted) {
            mic = await requestMicrophonePermission();
          }
          if (cancelled) return;
          if (!mic.granted) {
            active.reject(
              new Error('Microphone permission is required to record video.'),
            );
            return;
          }
        }
        if (!cancelled) setPermissionsReady(true);
      } catch (error) {
        if (!cancelled) {
          active.reject(
            error instanceof Error ? error : new Error('Unable to open the camera.'),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  function handleCancel() {
    const active = requestRef.current;
    if (isRecording) {
      cameraRef.current?.stopRecording();
    }
    active?.resolve(null);
  }

  async function capturePhoto() {
    if (!cameraRef.current || isCapturing || !isCameraReady) return;
    setIsCapturing(true);
    try {
      const picture = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        shutterSound: false,
      });
      if (!picture?.uri) {
        requestRef.current?.reject(
          new Error('Could not capture the photo. Please try again.'),
        );
        return;
      }
      setReviewPhoto({
        uri: picture.uri,
        width: picture.width,
        height: picture.height,
        tiltLineAngle: tiltMode ? lineAngleRef.current : null,
      });
    } catch (error) {
      requestRef.current?.reject(
        error instanceof Error ? error : new Error('Photo capture failed.'),
      );
    } finally {
      setIsCapturing(false);
    }
  }

  function usePhoto() {
    const active = requestRef.current;
    if (!active || !reviewPhoto) return;
    active.resolve({
      uri: reviewPhoto.uri,
      width: reviewPhoto.width,
      height: reviewPhoto.height,
      kind: 'photo',
      tiltLineAngle: reviewPhoto.tiltLineAngle,
    });
  }

  function retakePhoto() {
    setReviewPhoto(null);
  }

  function startRecording() {
    if (!cameraRef.current || isRecording || !isCameraReady) return;
    setIsRecording(true);
    cameraRef.current
      .recordAsync({ maxDuration: 30 })
      .then((recording) => {
        setIsRecording(false);
        const active = requestRef.current;
        if (!active) return;
        if (recording?.uri) {
          active.resolve({ uri: recording.uri, width: 0, height: 0, kind: 'video' });
        } else {
          active.resolve(null);
        }
      })
      .catch((error) => {
        setIsRecording(false);
        requestRef.current?.reject(
          error instanceof Error ? error : new Error('Video recording failed.'),
        );
      });
  }

  function handleShutter() {
    if (mode === 'video') {
      if (isRecording) cameraRef.current?.stopRecording();
      else startRecording();
    } else {
      void capturePhoto();
    }
  }

  const shutterDisabled = !isCameraReady || isCapturing;
  const inReview = reviewPhoto != null;
  const isLevel = deviceRoll != null && Math.abs(deviceRoll) <= LEVEL_TOLERANCE_DEG;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleCancel}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.container}>
        {visible && permissionsReady ? (
          <GestureDetector gesture={activeGesture}>
            <View
              style={styles.frame}
              onLayout={(e) =>
                setFrameSize({
                  w: e.nativeEvent.layout.width,
                  h: e.nativeEvent.layout.height,
                })
              }
            >
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing={facing}
                flash={flash}
                zoom={zoom}
                ratio="4:3"
                animateShutter={false}
                mode={mode === 'video' ? 'video' : 'picture'}
                active={visible && !inReview}
                onCameraReady={() => setIsCameraReady(true)}
                onMountError={(event) => {
                  requestRef.current?.reject(
                    new Error(event?.message || 'The camera failed to start.'),
                  );
                }}
              />
              {showGrid && !tiltMode ? (
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <View style={[styles.gridLineV, { left: '33.33%' }]} />
                  <View style={[styles.gridLineV, { left: '66.66%' }]} />
                  <View style={[styles.gridLineH, { top: '33.33%' }]} />
                  <View style={[styles.gridLineH, { top: '66.66%' }]} />
                </View>
              ) : null}
              {tiltMode ? <TiltOverlay angleDeg={lineAngleDeg} showHint /> : null}
              <View pointerEvents="none" style={styles.liveStamp}>
                <TimestampStamp
                  date={now}
                  latitude={fix?.latitude ?? null}
                  longitude={fix?.longitude ?? null}
                  accuracy={fix?.accuracy}
                />
              </View>
            </View>
          </GestureDetector>
        ) : null}

        {visible && !permissionsReady ? (
          <View style={styles.loader}>
            <ActivityIndicator color="#ffffff" size="large" />
            <Text style={styles.loaderText}>Preparing camera…</Text>
          </View>
        ) : null}

        {/* Post-capture review — opaque so the live preview never shows through */}
        {inReview && reviewPhoto ? (
          <View style={styles.reviewOverlay}>
            <Image
              source={{ uri: reviewPhoto.uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
            />
            {reviewPhoto.tiltLineAngle != null ? (
              <TiltOverlay angleDeg={reviewPhoto.tiltLineAngle} />
            ) : null}
            <View style={[styles.reviewLabelWrap, { top: insets.top + 10 }]}>
              <Text style={styles.reviewLabel}>PREVIEW</Text>
            </View>
            <Pressable
              onPress={handleCancel}
              hitSlop={12}
              style={[styles.iconButtonSquare, styles.absTopLeft, { top: insets.top + 8 }]}
            >
              <Feather name="x" size={22} color="#ffffff" />
            </Pressable>
            <View style={[styles.reviewBar, { paddingBottom: insets.bottom + 24 }]}>
              <Pressable onPress={retakePhoto} style={styles.reviewButton}>
                <Text style={styles.reviewButtonText}>↺  Retake</Text>
              </Pressable>
              <Pressable
                onPress={usePhoto}
                style={[styles.reviewButton, styles.reviewButtonPrimary]}
              >
                <Text style={[styles.reviewButtonText, styles.reviewButtonTextPrimary]}>
                  ✓  Use photo
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Live camera chrome (hidden during review), in the margins around the frame */}
        {!inReview ? (
          <>
            <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
              <Pressable onPress={handleCancel} hitSlop={12} style={styles.iconButtonSquare}>
                <Feather name="x" size={22} color="#ffffff" />
              </Pressable>
              <View style={styles.topRight}>
                <Pressable
                  onPress={() => setTiltMode((t) => !t)}
                  hitSlop={12}
                  style={[styles.iconButton, tiltMode && styles.iconButtonActive]}
                >
                  <Feather
                    name="compass"
                    size={16}
                    color="#ffffff"
                    style={styles.iconGlyphLead}
                  />
                  <Text style={styles.iconText}>Tilt</Text>
                </Pressable>
                {!tiltMode ? (
                  <Pressable
                    onPress={() => setShowGrid((g) => !g)}
                    hitSlop={12}
                    style={styles.iconButtonSquare}
                  >
                    <Feather
                      name="grid"
                      size={20}
                      color={showGrid ? '#ffffff' : 'rgba(255,255,255,0.5)'}
                    />
                  </Pressable>
                ) : null}
                {mode === 'photo' ? (
                  <Pressable
                    onPress={() => setFlash((f) => (f === 'off' ? 'on' : 'off'))}
                    hitSlop={12}
                    style={styles.iconButtonSquare}
                  >
                    <Feather
                      name={flash === 'on' ? 'zap' : 'zap-off'}
                      size={20}
                      color="#ffffff"
                    />
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* Hold-level assist (Tilt mode) */}
            {tiltMode ? (
              <View style={[styles.levelWrap, { top: insets.top + 54 }]}>
                <Text style={[styles.levelPill, isLevel ? styles.levelOk : styles.levelWarn]}>
                  {isLevel ? '◎ Phone level' : '▲ Hold phone level for a straight photo'}
                </Text>
              </View>
            ) : null}

            {isRecording ? (
              <View style={[styles.recBadge, { top: insets.top + 90 }]}>
                <View style={styles.recDot} />
                <Text style={styles.recText}>REC · max 30s</Text>
              </View>
            ) : null}

            {!isRecording && !tiltMode ? (
              <View style={[styles.zoomRow, { bottom: insets.bottom + 112 }]}>
                {ZOOM_PRESETS.map((preset) => {
                  const active = Math.abs(zoom - preset.value) < 0.03;
                  return (
                    <Pressable
                      key={preset.label}
                      onPress={() => setZoom(preset.value)}
                      style={[styles.zoomChip, active && styles.zoomChipActive]}
                    >
                      <Text
                        style={[styles.zoomChipText, active && styles.zoomChipTextActive]}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.sideSlot} />
              <Pressable
                onPress={handleShutter}
                disabled={shutterDisabled}
                style={[styles.shutterOuter, shutterDisabled && styles.shutterOuterDisabled]}
              >
                <View
                  style={[
                    styles.shutterInner,
                    mode === 'video' && styles.shutterInnerVideo,
                    isRecording && styles.shutterInnerRecording,
                  ]}
                />
              </Pressable>
              <View style={styles.sideSlot}>
                {!isRecording ? (
                  <Pressable
                    onPress={() => setFacing((c) => (c === 'back' ? 'front' : 'back'))}
                    hitSlop={12}
                    style={styles.iconButtonSquare}
                  >
                    <Feather name="refresh-cw" size={20} color="#ffffff" />
                  </Pressable>
                ) : null}
              </View>
            </View>
          </>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  frame: {
    width: '100%',
    aspectRatio: 3 / 4,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loaderText: { color: '#ffffff', fontSize: 15 },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  liveStamp: { position: 'absolute', right: 8, bottom: 8 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  topRight: { flexDirection: 'row', gap: 10 },
  iconButton: {
    minWidth: 52,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  // Square variant for single-icon control chips (close / grid / flash / flip).
  iconButtonSquare: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  iconGlyphLead: { marginRight: 6 },
  iconButtonActive: { backgroundColor: '#2563EB' },
  iconText: { color: '#ffffff', fontSize: 17, fontWeight: '600' },
  absTopLeft: { position: 'absolute', left: 20 },
  levelWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  levelPill: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    overflow: 'hidden',
  },
  levelOk: { backgroundColor: 'rgba(22,163,74,0.85)' },
  levelWarn: { backgroundColor: 'rgba(202,138,4,0.9)' },
  recBadge: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  recText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  zoomRow: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  zoomChip: {
    minWidth: 44,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  zoomChipActive: { backgroundColor: '#ffffff' },
  zoomChipText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  zoomChipTextActive: { color: '#000000' },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingTop: 16,
  },
  sideSlot: { width: 56, alignItems: 'center', justifyContent: 'center' },
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterOuterDisabled: { opacity: 0.4 },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#ffffff' },
  shutterInnerVideo: { backgroundColor: '#ef4444' },
  shutterInnerRecording: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#ef4444' },
  reviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  reviewLabelWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  reviewLabel: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    overflow: 'hidden',
  },
  reviewBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  reviewButton: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  reviewButtonPrimary: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  reviewButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  reviewButtonTextPrimary: { color: '#ffffff' },
});

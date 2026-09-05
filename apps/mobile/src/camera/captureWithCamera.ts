// Imperative, promise-based bridge to the in-app camera.
//
// This replaces `expo-image-picker`'s `launchCameraAsync`, which launched the
// system camera app via an Android Intent. That approach backgrounds our
// activity, and on Android the activity can be recreated/killed while
// backgrounded (low memory, "Don't keep activities", OEM battery management) —
// on return the ImagePicker `CameraContract` ActivityResultLauncher is gone and
// `launch()` throws "Attempting to launch an unregistered ActivityResultLauncher".
//
// The in-app camera (<CameraView>, see CameraCaptureHost) renders inside our own
// activity and never fires an Intent, so that whole failure mode cannot occur.
//
// Callers keep the exact same imperative shape they had before:
//   const shot = await captureWithCamera({ mode: 'photo' });
//   if (!shot) return;            // user cancelled
//   // shot.uri / shot.width / shot.height
//
// `resolve(null)` == user cancelled (mirrors the old `result.canceled`);
// `reject(error)` == a hard failure (permission denied, capture error) that the
// call site surfaces exactly like it surfaced the old thrown errors.

export type CaptureMode = 'photo' | 'video';

/**
 * Optional framing guide overlaid on the live camera. 'reading' draws an aim box
 * for the Smart Sensor LCD so the crew frames just the big reading (which is
 * then cropped + OCR'd, isolated from the temperature/buttons).
 */
export type CaptureGuide = 'reading';

/** TNB report defect categories; each has a fixed marking color (A red, B yellow, C green). */
export type MarkCategory = 'A' | 'B' | 'C';
export type MarkSize = 's' | 'm' | 'l';

/**
 * A defect marking circle burned into the photo. `x`/`y` are the circle centre
 * as fractions (0..1) of the photo frame; `size` is a preset diameter relative
 * to the frame width — so the mark renders identically on the live preview, the
 * review screen, and the burn canvas regardless of their pixel sizes.
 */
export type DefectMark = {
  x: number;
  y: number;
  size: MarkSize;
  category: MarkCategory;
};

export type CaptureResult = {
  uri: string;
  width: number;
  height: number;
  kind: CaptureMode;
  /** Measurement-line tilt from vertical (signed deg) when Tilt mode was used; else absent/null. */
  tiltLineAngle?: number | null;
  /** Defect marking circle aimed/placed by the user; null/absent = unmarked photo. */
  mark?: DefectMark | null;
};

export type CaptureRequest = {
  mode: CaptureMode;
  /** Optional framing guide to overlay on the live preview. */
  guide?: CaptureGuide;
  /** Show the defect-marking tool (aim circle burned into the photo). Photo mode only. */
  allowMark?: boolean;
  /** Pre-selected mark category (e.g. mapped from a known defect severity). */
  initialMarkCategory?: MarkCategory;
  /**
   * Force the marking tool's initial on/off state (instead of the remembered
   * session setting). Defect-photo captures pass true so the circle is always
   * armed; the crew can still toggle it off for whole-pole defects (CONDONG).
   */
  defaultMarkEnabled?: boolean;
  /**
   * Lock the mark color to initialMarkCategory (no A/B/C chips). Used when the
   * category comes from the checklist item's severity — the color is data the
   * report relies on, so the crew must not repaint it.
   */
  lockMarkCategory?: boolean;
  resolve: (result: CaptureResult | null) => void;
  reject: (error: Error) => void;
};

type HostListener = (request: CaptureRequest | null) => void;

let host: HostListener | null = null;
let pending: CaptureRequest | null = null;

/**
 * Registered once by <CameraCaptureHost>. If a capture was requested before the
 * host had mounted, it is delivered on registration so the call never hangs.
 * Returns an unsubscribe function.
 */
export function registerCameraCaptureHost(listener: HostListener): () => void {
  host = listener;
  if (pending) {
    listener(pending);
  }
  return () => {
    if (host === listener) {
      host = null;
    }
  };
}

/**
 * Open the in-app camera and resolve with the captured photo/video, or `null`
 * if the user cancelled. Drop-in replacement for `ImagePicker.launchCameraAsync`.
 */
export function captureWithCamera(options: {
  mode: CaptureMode;
  guide?: CaptureGuide;
  allowMark?: boolean;
  initialMarkCategory?: MarkCategory;
  defaultMarkEnabled?: boolean;
  lockMarkCategory?: boolean;
}): Promise<CaptureResult | null> {
  if (pending) {
    return Promise.reject(
      new Error('A camera capture is already in progress.'),
    );
  }

  return new Promise<CaptureResult | null>((resolve, reject) => {
    const settle = () => {
      pending = null;
      // Tell the host to close the camera.
      host?.(null);
    };

    const request: CaptureRequest = {
      mode: options.mode,
      guide: options.guide,
      allowMark: options.allowMark,
      initialMarkCategory: options.initialMarkCategory,
      defaultMarkEnabled: options.defaultMarkEnabled,
      lockMarkCategory: options.lockMarkCategory,
      resolve: (result) => {
        settle();
        resolve(result);
      },
      reject: (error) => {
        settle();
        reject(error);
      },
    };

    pending = request;
    // If the host is mounted (always true once the app has rendered) it opens
    // immediately; otherwise registerCameraCaptureHost delivers it on mount.
    host?.(request);
  });
}

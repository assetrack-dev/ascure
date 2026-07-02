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

export type CaptureResult = {
  uri: string;
  width: number;
  height: number;
  kind: CaptureMode;
  /** Pole tilt from vertical (deg) when Tilt mode was on at capture; else absent/null. */
  tiltDegrees?: number | null;
};

export type CaptureRequest = {
  mode: CaptureMode;
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

import * as Location from 'expo-location';

export type LocationFix = Location.LocationObject;

const DEFAULT_GPS_TIMEOUT_MS = 8000;

/**
 * Acquire a GPS fix without ever blocking indefinitely.
 *
 * expo-location's getCurrentPositionAsync has NO built-in timeout, so a cold /
 * indoor Android fix can stall for tens of seconds (or effectively forever),
 * freezing any screen that awaits it (this was the "Loading teams, MAINHEADs,
 * pencawang, and GPS..." hang on the Check-In screen). This races a fresh fix
 * against a timeout and falls back to the last-known position, so it always
 * resolves within ~timeoutMs to the freshest available fix, a cached one, or
 * null — and the caller can update the UI when it lands instead of blocking.
 *
 * The caller is responsible for requesting location permission first.
 */
export async function getPositionWithTimeout(options?: {
  accuracy?: Location.Accuracy;
  timeoutMs?: number;
}): Promise<LocationFix | null> {
  const accuracy = options?.accuracy ?? Location.Accuracy.Balanced;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_GPS_TIMEOUT_MS;

  const fresh = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy }).catch(() => null),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);

  if (fresh) {
    return fresh;
  }

  // Fresh fix timed out or failed — fall back to the device's last-known fix so
  // the UI still gets a sensible coordinate instead of hanging or staying empty.
  try {
    return await Location.getLastKnownPositionAsync();
  } catch {
    return null;
  }
}

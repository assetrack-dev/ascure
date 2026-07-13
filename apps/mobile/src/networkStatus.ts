/**
 * Lightweight, module-level network status readable by NON-React modules
 * (api.ts, offlineCache.ts) so they can FAIL FAST when there's no coverage
 * instead of waiting out the full request timeout on every call — the root cause
 * of the "everything is slow offline" field pain.
 *
 * Two independent signals:
 *  - autoOffline: derived from NetInfo by SyncContext (reachability probe).
 *  - forceOffline: a MANUAL "Work Offline" toggle the crew flips when they know
 *    coverage is bad. NetInfo guesses wrong on a weak trickle of signal (reports
 *    "connected" then every call hangs), so this hard override is the reliable
 *    lever for heavily-out-of-coverage areas.
 *
 * `forceOffline` hard-blocks network attempts (the user asked for it);
 * `autoOffline` only short-circuits cached reads + shortens write timeouts (we
 * don't fully trust NetInfo, so a real request may still be attempted quickly).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// Persisted so a crew that flips "Work Offline" in a no-coverage area stays
// offline-fast across the inevitable app restart. Reset on sign-out so a
// persisted override can never trap the login screen (which has no toggle).
const FORCE_OFFLINE_KEY = '@ascure/mobile/force-offline/v1';

let autoOffline = false;
let forceOffline = false;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

/** NetInfo-derived offline state (set by SyncContext). */
export function setAutoOffline(value: boolean): void {
  if (autoOffline !== value) {
    autoOffline = value;
    emit();
  }
}

/** Manual "Work Offline" override (set by the toggle). */
export function setForceOffline(value: boolean): void {
  if (forceOffline !== value) {
    forceOffline = value;
    emit();
  }
}

/** The user explicitly chose to work offline — network attempts are hard-blocked. */
export function isForceOffline(): boolean {
  return forceOffline;
}

/** Either signal says we're offline — reads should serve cache, writes queue. */
export function isNetworkOffline(): boolean {
  return autoOffline || forceOffline;
}

/** Subscribe to any status change (for UI that mirrors the flags). */
export function subscribeNetworkStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read the persisted "Work Offline" preference (best-effort; false on error). */
export async function loadPersistedForceOffline(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(FORCE_OFFLINE_KEY)) === 'true';
  } catch {
    return false;
  }
}

/** Persist the "Work Offline" preference (best-effort, fire-and-forget). */
export function persistForceOffline(value: boolean): void {
  void AsyncStorage.setItem(FORCE_OFFLINE_KEY, value ? 'true' : 'false').catch(
    () => undefined,
  );
}

/**
 * Reset "Work Offline" (memory + storage) — called on sign-out so a persisted
 * override can never block the login screen, which has no toggle to turn it off.
 */
export function resetForceOfflineOnSignOut(): void {
  setForceOffline(false);
  persistForceOffline(false);
}

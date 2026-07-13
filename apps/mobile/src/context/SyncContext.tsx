import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import NetInfo from '@react-native-community/netinfo';
import { ApiError, API_BASE_URL, api } from '../api';
import {
  getActiveQueueCount,
  subscribeSyncQueue,
  syncQueuedInspections,
  SyncQueueRunResult,
  SyncQueueSnapshot,
} from '../syncQueue';
import {
  setAutoOffline,
  setForceOffline,
  isForceOffline,
  subscribeNetworkStatus,
  loadPersistedForceOffline,
  persistForceOffline,
} from '../networkStatus';
import { useAuth } from './AuthContext';

// Decide "online" by whether the device can reach the ASCURE API itself — NOT
// NetInfo's default probe to Google's https://clients3.google.com/generate_204,
// which is blocked/redirected on many Malaysian field SIMs and captive portals
// and made the app falsely show "Offline mode" while the API was perfectly
// reachable (then silently queue work instead of submitting it). /auth/me
// returns 401 unauthenticated, which still proves the host is reachable, so
// accept any non-5xx response. Runs once at module load, before the provider
// attaches its NetInfo listeners.
NetInfo.configure({
  reachabilityUrl: `${API_BASE_URL}/auth/me`,
  reachabilityMethod: 'GET',
  reachabilityTest: async (response) =>
    response.status >= 200 && response.status < 500,
  reachabilityShouldRun: () => true,
});

const EMPTY_SYNC_QUEUE_SNAPSHOT: SyncQueueSnapshot = {
  items: [],
  completed: [],
  visitCompletions: [],
  completedVisitCompletions: [],
  mutations: [],
  tempIdMap: {},
};

type SyncContextValue = {
  snapshot: SyncQueueSnapshot;
  isSyncing: boolean;
  /** True when NetInfo says offline OR the crew turned on "Work Offline". */
  isOffline: boolean;
  /** The manual "Work Offline" override, distinct from auto-detected offline. */
  forceOffline: boolean;
  /** Flip the manual "Work Offline" override (persisted). */
  setWorkOffline: (value: boolean) => void;
  runQueueSync: () => Promise<SyncQueueRunResult>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { token, handleUnauthorized } = useAuth();
  const [snapshot, setSnapshot] = useState<SyncQueueSnapshot>(EMPTY_SYNC_QUEUE_SNAPSHOT);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [forceOffline, setForceOfflineState] = useState(false);
  const snapshotRef = useRef(snapshot);
  const forceOfflineRef = useRef(false);
  const runQueueSyncRef = useRef<(() => Promise<SyncQueueRunResult>) | null>(null);

  // The shared networkStatus module is the single source of truth for
  // forceOffline. Subscribe and MIRROR it into React state + the ref, so the UI
  // toggle + the flush guard follow every change — including AuthContext's
  // reset-on-sign-out, which sets the module flag directly (this is the fix for
  // the desync where a normal sign-out left the toggle stuck "on").
  useEffect(() => {
    const reflect = () => {
      const f = isForceOffline();
      forceOfflineRef.current = f;
      setForceOfflineState(f);
    };
    const unsubscribe = subscribeNetworkStatus(reflect);
    // Apply the persisted preference to the module (emits → reflect), then
    // reflect the current module state immediately.
    void loadPersistedForceOffline().then((on) => {
      if (on) setForceOffline(true);
    });
    reflect();
    return unsubscribe;
  }, []);

  const setWorkOffline = useCallback(
    (value: boolean) => {
      // Module is the source of truth; the subscription above updates React
      // state + the ref.
      setForceOffline(value);
      persistForceOffline(value);
      // Turning it OFF while online + work is queued: drain immediately so the
      // crew doesn't have to wait for the next NetInfo transition.
      if (!value && !isOffline && getActiveQueueCount(snapshotRef.current) > 0) {
        void runQueueSyncRef.current?.().catch(() => undefined);
      }
    },
    [isOffline],
  );

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = subscribeSyncQueue((next) => {
      if (isMounted) {
        snapshotRef.current = next;
        setSnapshot(next);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const runQueueSync = useCallback(async (): Promise<SyncQueueRunResult> => {
    if (!token) {
      return {
        completed: 0,
        failed: 0,
        skipped: 0,
      };
    }

    try {
      setIsSyncing(true);

      return await syncQueuedInspections(token);
    } catch (syncError) {
      if (syncError instanceof ApiError && syncError.status === 401) {
        await handleUnauthorized(syncError);
      }

      throw syncError;
    } finally {
      setIsSyncing(false);
    }
  }, [handleUnauthorized, token]);

  useEffect(() => {
    runQueueSyncRef.current = runQueueSync;
  }, [runQueueSync]);

  // Track network state ALWAYS (not gated on token) so autoOffline never goes
  // stale while signed out — otherwise a stale "offline" would shorten the login
  // request timeout. Flushing is guarded separately (runQueueSync no-ops without
  // a token), so the login screen tracks connectivity without trying to sync.
  useEffect(() => {
    function handleNetworkState(
      isConnected: boolean | null,
      isInternetReachable: boolean | null,
    ) {
      const canReachNetwork = isConnected === true && isInternetReachable !== false;
      const nextIsOffline = isConnected === false || isInternetReachable === false;

      // Feed the shared module so api.ts / offlineCache.ts fail-fast (short
      // timeout / instant cache) — unless the crew forced Work Offline, which
      // takes precedence and is managed by setWorkOffline.
      setAutoOffline(nextIsOffline);
      setIsOffline(nextIsOffline);
      // Auto-flush on reconnect — skipped while Work Offline; runQueueSync itself
      // no-ops when there's no token (signed out).
      if (
        !forceOfflineRef.current &&
        canReachNetwork &&
        getActiveQueueCount(snapshotRef.current) > 0
      ) {
        void runQueueSyncRef.current?.().catch(() => undefined);
      }
    }

    const unsubscribe = NetInfo.addEventListener((state) => {
      handleNetworkState(state.isConnected, state.isInternetReachable);
    });

    void NetInfo.fetch().then((state) => {
      handleNetworkState(state.isConnected, state.isInternetReachable);
    });

    return unsubscribe;
  }, []);

  // Best-effort offline-sync heartbeat (ADR 0002 §4): whenever the queue size
  // changes (work queued, or drained by a sync) and we're online, tell the
  // server how many mutations are still pending so it can gate reassignment of
  // this team's work until the device has flushed. Never blocks sync — failures
  // are ignored, and an unreported device simply defaults to 0 (no gate).
  useEffect(() => {
    if (!token || isOffline || forceOffline) {
      return;
    }

    const pending = getActiveQueueCount(snapshot);
    void api.reportSyncState(token, pending).catch(() => undefined);
  }, [snapshot, token, isOffline, forceOffline]);

  // The whole app treats "offline" as NetInfo-offline OR the manual override.
  const effectiveOffline = isOffline || forceOffline;

  const value = useMemo<SyncContextValue>(
    () => ({
      snapshot,
      isSyncing,
      isOffline: effectiveOffline,
      forceOffline,
      setWorkOffline,
      runQueueSync,
    }),
    [snapshot, isSyncing, effectiveOffline, forceOffline, setWorkOffline, runQueueSync],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);

  if (!context) {
    throw new Error('useSync must be used within a SyncProvider');
  }

  return context;
}

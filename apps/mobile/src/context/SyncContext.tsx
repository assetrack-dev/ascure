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
  isOffline: boolean;
  runQueueSync: () => Promise<SyncQueueRunResult>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { token, handleUnauthorized } = useAuth();
  const [snapshot, setSnapshot] = useState<SyncQueueSnapshot>(EMPTY_SYNC_QUEUE_SNAPSHOT);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const snapshotRef = useRef(snapshot);

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
    if (!token) {
      return undefined;
    }

    function handleNetworkState(
      isConnected: boolean | null,
      isInternetReachable: boolean | null,
    ) {
      const canReachNetwork = isConnected === true && isInternetReachable !== false;
      const nextIsOffline = isConnected === false || isInternetReachable === false;

      setIsOffline(nextIsOffline);
      if (canReachNetwork && getActiveQueueCount(snapshotRef.current) > 0) {
        void runQueueSync().catch(() => undefined);
      }
    }

    const unsubscribe = NetInfo.addEventListener((state) => {
      handleNetworkState(state.isConnected, state.isInternetReachable);
    });

    void NetInfo.fetch().then((state) => {
      handleNetworkState(state.isConnected, state.isInternetReachable);
    });

    return unsubscribe;
  }, [runQueueSync, token]);

  // Best-effort offline-sync heartbeat (ADR 0002 §4): whenever the queue size
  // changes (work queued, or drained by a sync) and we're online, tell the
  // server how many mutations are still pending so it can gate reassignment of
  // this team's work until the device has flushed. Never blocks sync — failures
  // are ignored, and an unreported device simply defaults to 0 (no gate).
  useEffect(() => {
    if (!token || isOffline) {
      return;
    }

    const pending = getActiveQueueCount(snapshot);
    void api.reportSyncState(token, pending).catch(() => undefined);
  }, [snapshot, token, isOffline]);

  const value = useMemo<SyncContextValue>(
    () => ({ snapshot, isSyncing, isOffline, runQueueSync }),
    [snapshot, isSyncing, isOffline, runQueueSync],
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

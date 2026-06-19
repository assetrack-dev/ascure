import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { useSession } from './context/AuthContext';
import { cachedFetch } from './offlineCache';
import {
  hasInspectionAuthority,
  hasMaintenanceAuthority,
} from './operationalWorkspace';
import type { EffectiveCapability } from './types';

export type CapabilitiesState = {
  /** True until capabilities have resolved (from cache or network) the first time. */
  loading: boolean;
  capabilities: EffectiveCapability[];
  /** Can perform inspection-scope actions (check-in / add asset / start inspection). */
  canInspect: boolean;
  /** Can perform maintenance-scope actions. */
  canMaintain: boolean;
};

/**
 * Shared, cache-backed source of the signed-in user's effective capabilities,
 * so any screen can gate inspection- vs maintenance-scope actions consistently
 * (mirrors the load HomeScreen already does via cachedFetch('my-capabilities')).
 *
 * Offline-safe: cachedFetch serves the last cached capabilities when the server
 * is unreachable. On a hard failure with no cache we fail CLOSED (empty caps →
 * inspection actions hidden) so a maintenance account never leaks inspection UI;
 * a real 401 signs the crew out.
 */
export function useCapabilities(): CapabilitiesState {
  const { token, user, handleUnauthorized } = useSession();
  const [capabilities, setCapabilities] = useState<EffectiveCapability[] | null>(
    null,
  );

  useEffect(() => {
    let isMounted = true;

    cachedFetch('my-capabilities', undefined, () => api.getMyCapabilities(token))
      .then((result) => {
        if (isMounted) {
          setCapabilities(result.value);
        }
      })
      .catch(async (error) => {
        if (error instanceof ApiError && error.status === 401) {
          await handleUnauthorized(error);
          return;
        }
        // Offline / unreachable (status 0) with no cached capabilities: stay
        // "unknown" (keep loading) rather than failing closed to empty, so a
        // first offline boot before caps were ever cached doesn't lock a
        // legitimate inspector out. Real server errors still fail closed.
        if (error instanceof ApiError && error.status === 0) {
          return;
        }
        if (isMounted) {
          setCapabilities([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token, handleUnauthorized]);

  const resolved = capabilities ?? [];

  return {
    loading: capabilities === null,
    capabilities: resolved,
    canInspect: hasInspectionAuthority(user, resolved),
    canMaintain: hasMaintenanceAuthority(user, resolved),
  };
}

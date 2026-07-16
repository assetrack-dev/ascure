import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Alert } from 'react-native';
import { api, ApiError } from '../api';
import {
  loadStoredToken,
  loadStoredUser,
  removeStoredToken,
  removeStoredUser,
  storeToken,
  storeUser,
} from '../storage';
import { cachedFetch, clearAllCache } from '../offlineCache';
import { resetForceOfflineOnSignOut } from '../networkStatus';
import type { SessionUser } from '../types';

// A 401 can mean the token simply expired/was invalidated, or that this account
// was signed in on another phone (single-device enforcement). The API encodes
// the latter in its error message; surface the right copy to the crew.
function describeSignOut(error?: unknown): { title: string; message: string } {
  const signedInElsewhere =
    error instanceof ApiError &&
    typeof error.message === 'string' &&
    error.message.toLowerCase().includes('another device');

  return signedInElsewhere
    ? {
        title: 'Signed out',
        message:
          'Your account was signed in on another device, so this phone was signed out.',
      }
    : { title: 'Session expired', message: 'Please sign in again.' };
}

type AuthContextValue = {
  isBooting: boolean;
  token: string | null;
  user: SessionUser | null;
  signIn: (token: string, user: SessionUser) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: SessionUser) => void;
  handleUnauthorized: (error?: unknown) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isBooting, setIsBooting] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      const [storedToken, cachedUser] = await Promise.all([
        loadStoredToken(),
        loadStoredUser(),
      ]);

      if (!storedToken) {
        if (isMounted) {
          setIsBooting(false);
        }
        return;
      }

      // Offline-first boot: with a cached profile, show the app IMMEDIATELY from
      // cache and revalidate in the BACKGROUND, so a cold boot in the field never
      // hangs on the (up-to-20s) /auth/me timeout. Only a real 401 from the
      // background check ends the session; an offline/transient failure keeps the
      // crew logged in.
      if (cachedUser) {
        if (isMounted) {
          setToken(storedToken);
          setUser(cachedUser);
          setIsBooting(false);
        }

        void api
          .getMe(storedToken)
          .then(async (freshUser) => {
            await storeUser(freshUser);
            if (isMounted) {
              setUser(freshUser);
            }
          })
          .catch(async (error) => {
            if (error instanceof ApiError && error.status === 401) {
              resetForceOfflineOnSignOut();
              await Promise.all([removeStoredToken(), removeStoredUser(), clearAllCache()]);
              if (isMounted) {
                setToken(null);
                setUser(null);
                const { title, message } = describeSignOut(error);
                Alert.alert(title, message);
              }
            }
            // Offline / transient — keep the cached session as-is.
          });

        return;
      }

      // No cached profile (a pre-update session): we must validate online to get
      // the user before we can render authenticated screens.
      try {
        const currentUser = await api.getMe(storedToken);

        if (!isMounted) {
          return;
        }

        await storeUser(currentUser);
        setToken(storedToken);
        setUser(currentUser);
      } catch (error) {
        // A real auth rejection ends the session (expired/deactivated/reset/
        // signed-in-elsewhere). Offline + no cache → can't render authed screens,
        // so stay on login but KEEP the token for the next (online) boot.
        if (error instanceof ApiError && error.status === 401) {
          resetForceOfflineOnSignOut();
          await Promise.all([removeStoredToken(), removeStoredUser(), clearAllCache()]);

          if (isMounted) {
            const { title, message } = describeSignOut(error);
            Alert.alert(title, message);
          }
        }
      } finally {
        if (isMounted) {
          setIsBooting(false);
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const signIn = useCallback(async (accessToken: string, sessionUser: SessionUser) => {
    await Promise.all([storeToken(accessToken), storeUser(sessionUser)]);
    setToken(accessToken);
    setUser(sessionUser);
    // Prime the offline capabilities cache while we're definitely online, so a
    // later offline boot serves real capabilities instead of failing closed and
    // hiding inspection actions from a legitimate inspector. Best-effort.
    void cachedFetch('my-capabilities', undefined, () =>
      api.getMyCapabilities(accessToken),
    ).catch(() => undefined);
  }, []);

  const signOut = useCallback(async () => {
    // Reset "Work Offline" so a persisted override can't block the login screen
    // (which has no toggle) on the next sign-in.
    resetForceOfflineOnSignOut();
    // Clear the offline READ-cache so the next user on this device is never
    // served the previous user's cached visits/teams while offline (honors
    // clearAllCache's documented sign-out contract, which previously only ran on
    // 401). The offline WRITE-queue is deliberately preserved — unsynced field
    // work must survive sign-out, and the reconciler is user-scoped (ownerUserId)
    // so it can't replay under another user.
    await Promise.all([removeStoredToken(), removeStoredUser(), clearAllCache()]);
    setToken(null);
    setUser(null);
  }, []);

  const handleUnauthorized = useCallback(
    async (error?: unknown) => {
      if (error instanceof ApiError && error.status !== 401) {
        throw error;
      }

      await signOut();

      const { title, message } = describeSignOut(error);
      Alert.alert(title, message);
    },
    [signOut],
  );

  // Expose a setUser that also refreshes the cached profile, so offline boot and
  // any in-app profile update (e.g. after changing password) stay in sync.
  const persistUser = useCallback((nextUser: SessionUser) => {
    setUser(nextUser);
    void storeUser(nextUser);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isBooting,
      token,
      user,
      signIn,
      signOut,
      setUser: persistUser,
      handleUnauthorized,
    }),
    [isBooting, token, user, signIn, signOut, persistUser, handleUnauthorized],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

export type AuthenticatedSession = {
  token: string;
  user: SessionUser;
  setUser: (user: SessionUser) => void;
  signOut: () => Promise<void>;
  handleUnauthorized: (error?: unknown) => Promise<void>;
};

export function useSession(): AuthenticatedSession {
  const { token, user, setUser, signOut, handleUnauthorized } = useAuth();

  if (token === null || user === null) {
    throw new Error('useSession must be used within an authenticated screen');
  }

  return { token, user, setUser, signOut, handleUnauthorized };
}

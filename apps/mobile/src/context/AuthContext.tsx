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
      try {
        const [storedToken, cachedUser] = await Promise.all([
          loadStoredToken(),
          loadStoredUser(),
        ]);

        if (!storedToken) {
          return;
        }

        try {
          const currentUser = await api.getMe(storedToken);

          if (!isMounted) {
            return;
          }

          await storeUser(currentUser);
          setToken(storedToken);
          setUser(currentUser);
        } catch (error) {
          // Only a real auth rejection ends the session: the long-lived token
          // expired, the account was deactivated, the password was reset, or it
          // was signed in on another phone. Drop the session and explain why.
          if (error instanceof ApiError && error.status === 401) {
            await Promise.all([removeStoredToken(), removeStoredUser()]);

            if (isMounted) {
              const { title, message } = describeSignOut(error);
              Alert.alert(title, message);
            }

            return;
          }

          // Couldn't reach the server (offline / timeout / transient). Keep the
          // crew logged in using the last known profile so the app works
          // offline; the next online request revalidates the token. Without a
          // cached profile (a pre-update session) we can't render authenticated
          // screens, so fall through to login but keep the token for next boot.
          if (isMounted && cachedUser) {
            setToken(storedToken);
            setUser(cachedUser);
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
  }, []);

  const signOut = useCallback(async () => {
    await Promise.all([removeStoredToken(), removeStoredUser()]);
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

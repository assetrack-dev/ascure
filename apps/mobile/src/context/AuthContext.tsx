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
import { loadStoredToken, removeStoredToken, storeToken } from '../storage';
import type { SessionUser } from '../types';

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
        const storedToken = await loadStoredToken();

        if (!storedToken) {
          return;
        }

        const currentUser = await api.getMe(storedToken);

        if (!isMounted) {
          return;
        }

        setToken(storedToken);
        setUser(currentUser);
      } catch (error) {
        await removeStoredToken();
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
    await storeToken(accessToken);
    setToken(accessToken);
    setUser(sessionUser);
  }, []);

  const signOut = useCallback(async () => {
    await removeStoredToken();
    setToken(null);
    setUser(null);
  }, []);

  const handleUnauthorized = useCallback(
    async (error?: unknown) => {
      if (error instanceof ApiError && error.status !== 401) {
        throw error;
      }

      await signOut();
      Alert.alert('Session expired', 'Please sign in again.');
    },
    [signOut],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ isBooting, token, user, signIn, signOut, setUser, handleUnauthorized }),
    [isBooting, token, user, signIn, signOut, handleUnauthorized],
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

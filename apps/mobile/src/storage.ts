import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SessionUser } from './types';

const TOKEN_KEY = '@ascure/mobile/access-token';
const USER_KEY = '@ascure/mobile/session-user';

export async function loadStoredToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function storeToken(token: string) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function removeStoredToken() {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

// The last known signed-in user, cached alongside the token so the app can
// restore an authenticated session offline (the long-lived mobile token can't
// be revalidated via /auth/me without a network). Refreshed on every successful
// /auth/me and cleared on sign-out.
export async function loadStoredUser(): Promise<SessionUser | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    await AsyncStorage.removeItem(USER_KEY);
    return null;
  }
}

export async function storeUser(user: SessionUser) {
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function removeStoredUser() {
  await AsyncStorage.removeItem(USER_KEY);
}

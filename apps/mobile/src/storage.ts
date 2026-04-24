import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = '@ascure/mobile/access-token';

export async function loadStoredToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function storeToken(token: string) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function removeStoredToken() {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

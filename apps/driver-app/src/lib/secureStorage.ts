import * as SecureStore from 'expo-secure-store';

/**
 * Tokens live in the platform keystore/keychain (via expo-secure-store),
 * never in AsyncStorage or plain component state that could be dumped
 * from a device backup — the same reasoning that keeps refresh token
 * hashes (not raw tokens) in the database (docs/authentication.md). Key
 * prefix is "rideshare.driver." (not ".passenger.") so the two apps'
 * SecureStore entries never collide if both are ever installed on the
 * same device for testing.
 */
const ACCESS_TOKEN_KEY = 'rideshare.driver.accessToken';
const REFRESH_TOKEN_KEY = 'rideshare.driver.refreshToken';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export async function getStoredTokens(): Promise<StoredTokens | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);

  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export async function setStoredTokens(tokens: StoredTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

export async function clearStoredTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}

import type { AuthUser } from '@rideshare/types';
import type { LoginInput, RegisterPassengerInput } from '@rideshare/validation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as apiClient from '../lib/apiClient';
import { clearStoredTokens, getStoredTokens, setStoredTokens } from '../lib/secureStorage';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  accessToken: string | null;
}

interface AuthContextValue extends AuthState {
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterPassengerInput) => Promise<void>;
  logout: () => Promise<void>;
}

const INITIAL_STATE: AuthState = { status: 'loading', user: null, accessToken: null };

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Owns the passenger's signed-in state for the whole app. On mount it
 * tries to resume a session from SecureStore: verify the stored access
 * token via GET /auth/me, and if that's expired, fall back to a refresh
 * before giving up and signing the user out. Screens never talk to
 * apiClient's auth functions directly — they go through login/register/
 * logout here so token storage and state stay in one place.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const tokens = await getStoredTokens();
      if (!tokens) {
        if (!cancelled) setState({ status: 'signedOut', user: null, accessToken: null });
        return;
      }

      try {
        const user = await apiClient.getMe(tokens.accessToken);
        if (!cancelled) setState({ status: 'signedIn', user, accessToken: tokens.accessToken });
        return;
      } catch {
        // Access token likely expired — one refresh attempt before giving up.
      }

      try {
        const refreshed = await apiClient.refresh(tokens.refreshToken);
        await setStoredTokens(refreshed.tokens);
        if (!cancelled) {
          setState({
            status: 'signedIn',
            user: refreshed.user,
            accessToken: refreshed.tokens.accessToken,
          });
        }
      } catch {
        await clearStoredTokens();
        if (!cancelled) setState({ status: 'signedOut', user: null, accessToken: null });
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const response = await apiClient.login(input);
    await setStoredTokens(response.tokens);
    setState({ status: 'signedIn', user: response.user, accessToken: response.tokens.accessToken });
  }, []);

  const register = useCallback(async (input: RegisterPassengerInput) => {
    const response = await apiClient.registerPassenger(input);
    await setStoredTokens(response.tokens);
    setState({ status: 'signedIn', user: response.user, accessToken: response.tokens.accessToken });
  }, []);

  const logout = useCallback(async () => {
    const tokens = await getStoredTokens();
    if (tokens) {
      // Best-effort: even if the server call fails (offline, token
      // already expired), the local session still ends.
      await apiClient.logout(tokens.refreshToken).catch(() => undefined);
    }
    await clearStoredTokens();
    setState({ status: 'signedOut', user: null, accessToken: null });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, register, logout }),
    [state, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

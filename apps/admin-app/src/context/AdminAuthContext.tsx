'use client';

import type { AuthUser } from '@rideshare/types';
import type { LoginInput } from '@rideshare/validation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as apiClient from '../lib/apiClient';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

/**
 * localStorage, not an httpOnly cookie: apps/api issues bearer tokens the
 * same way for every client (section 7 has no separate cookie-session
 * flow), and this mirrors the mobile apps' token-in-client-storage
 * pattern (SecureStore there; the browser has no equivalent keystore).
 * A real production admin console would want httpOnly cookies + CSRF
 * protection instead — deferred along with the rest of Admin App
 * hardening to Phase 14, consistent with Stage 1's "development and
 * technical validation only" scope (see docs/location-infrastructure.md).
 */
const TOKEN_STORAGE_KEY = 'rideshare.admin.accessToken';

interface AdminAuthContextValue {
  status: AuthStatus;
  accessToken: string | null;
  user: AuthUser | null;
  login: (input: LoginInput) => Promise<void>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | undefined>(undefined);

/**
 * A client-side-only role check (redirects/hides UI for a non-admin
 * account) — never the actual security boundary. Every admin endpoint
 * still enforces requireRole('ADMIN', 'SUPER_ADMIN') server-side
 * regardless of what this context believes; a forged or stolen token
 * that somehow got here would still be rejected by the API.
 */
function isAdminRole(role: AuthUser['role']): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const stored = window.localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!stored) {
        if (!cancelled) setStatus('signedOut');
        return;
      }

      try {
        const me = await apiClient.getMe(stored);
        if (cancelled) return;

        if (!isAdminRole(me.role)) {
          window.localStorage.removeItem(TOKEN_STORAGE_KEY);
          setStatus('signedOut');
          return;
        }

        setAccessToken(stored);
        setUser(me);
        setStatus('signedIn');
      } catch {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        if (!cancelled) setStatus('signedOut');
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const response = await apiClient.login(input);

    if (!isAdminRole(response.user.role)) {
      throw new apiClient.ApiClientError(
        'FORBIDDEN',
        'This account does not have admin access.',
      );
    }

    window.localStorage.setItem(TOKEN_STORAGE_KEY, response.tokens.accessToken);
    setAccessToken(response.tokens.accessToken);
    setUser(response.user);
    setStatus('signedIn');
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    setAccessToken(null);
    setUser(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo<AdminAuthContextValue>(
    () => ({ status, accessToken, user, login, logout }),
    [status, accessToken, user, login, logout],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error('useAdminAuth must be used within an AdminAuthProvider');
  return context;
}

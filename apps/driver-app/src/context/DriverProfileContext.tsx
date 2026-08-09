import type { DriverProfileSummary } from '@rideshare/types';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import * as apiClient from '../lib/apiClient';

interface DriverProfileContextValue {
  profile: DriverProfileSummary | null;
  isLoading: boolean;
  errorMessage: string | null;
  /** Re-fetches GET /drivers/me/profile from the server. */
  refresh: () => Promise<void>;
  /** Updates local state directly from a mutation response (vehicle
   * upsert, submit-application, availability change) so every screen
   * sees the new status immediately without an extra round trip. */
  setProfile: (profile: DriverProfileSummary) => void;
}

const DriverProfileContext = createContext<DriverProfileContextValue | undefined>(undefined);

/**
 * Onboarding, Vehicle, Application Status, and Driver Home Map all read
 * (and some write) the same driver_profiles + vehicles state — sharing
 * it here avoids each screen independently re-fetching and risking a
 * stale onboardingStatus on one of them, the same reasoning as the
 * passenger app's RideDraftContext (Phase 3) for pickup/destination/route.
 */
export function DriverProfileProvider({ children }: { children: ReactNode }) {
  const { accessToken } = useAuth();
  const [profile, setProfileState] = useState<DriverProfileSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Declared and invoked directly inside the effect (rather than calling
  // the `refresh` below through a ref) — the react-hooks/set-state-in-effect
  // rule wants the setState-calling function to live in the effect body
  // itself, the same pattern apps/passenger-app's RoutePreviewScreen uses.
  // `refresh` duplicates a few of these lines rather than sharing this
  // function, to avoid exhaustive-deps churn over a plain function
  // redeclared every render.
  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;

    async function loadInitialProfile(token: string) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await apiClient.getDriverProfile(token);
        if (!cancelled) setProfileState(result);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof apiClient.ApiClientError
            ? error.message
            : 'Could not load your driver profile.',
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadInitialProfile(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await apiClient.getDriverProfile(accessToken);
      setProfileState(result);
    } catch (error) {
      setErrorMessage(
        error instanceof apiClient.ApiClientError
          ? error.message
          : 'Could not load your driver profile.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  const setProfile = useCallback((next: DriverProfileSummary) => {
    setProfileState(next);
  }, []);

  const value = useMemo<DriverProfileContextValue>(
    () => ({ profile, isLoading, errorMessage, refresh, setProfile }),
    [profile, isLoading, errorMessage, refresh, setProfile],
  );

  return <DriverProfileContext.Provider value={value}>{children}</DriverProfileContext.Provider>;
}

export function useDriverProfile(): DriverProfileContextValue {
  const context = useContext(DriverProfileContext);
  if (!context) throw new Error('useDriverProfile must be used within a DriverProfileProvider');
  return context;
}

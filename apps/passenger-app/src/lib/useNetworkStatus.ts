import { useNetworkState } from 'expo-network';

/**
 * Phase 23 — proactive offline detection (thin wrapper over
 * `expo-network`'s own `useNetworkState`, so the rest of the app
 * depends on one small boolean rather than the raw `NetworkState` shape
 * and its `undefined`-until-the-first-read fields). Complements, not
 * replaces, apiClient.ts's reactive `NETWORK_ERROR` handling — this
 * hook can show a banner *before* the next request even fails.
 *
 * `isConnected === false` is the only state treated as offline;
 * `undefined` (native module hasn't reported yet, right after mount)
 * and `true` are both treated as online — a brief false "online" beats
 * a startup flash of an "offline" banner nobody asked for.
 */
export function useNetworkStatus(): { isOffline: boolean } {
  const { isConnected } = useNetworkState();
  return { isOffline: isConnected === false };
}

import type { Coordinate, RoutePreview } from '@rideshare/maps';
import type { Ride } from '@rideshare/types';
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface NamedPoint {
  coordinate: Coordinate;
  label: string;
}

interface RideDraftState {
  pickup: NamedPoint | null;
  destination: NamedPoint | null;
  route: RoutePreview | null;
  /** Set once POST /rides succeeds (Phase 7) — the authoritative ride
   * record, not draft state. Cleared along with everything else on reset. */
  ride: Ride | null;
}

interface RideDraftContextValue extends RideDraftState {
  setPickup: (point: NamedPoint) => void;
  setDestination: (point: NamedPoint) => void;
  setRoute: (route: RoutePreview) => void;
  setRide: (ride: Ride) => void;
  reset: () => void;
}

const EMPTY_STATE: RideDraftState = { pickup: null, destination: null, route: null, ride: null };

const RideDraftContext = createContext<RideDraftContextValue | undefined>(undefined);

/**
 * Holds the ride currently being assembled — pickup, destination, the
 * route preview, and (once requested, Phase 7) the created ride itself —
 * across the HomeMap → DestinationSearch → RoutePreview → RideEstimate →
 * RequestRide → SearchingDriver flow. `ride` is the one field here that
 * isn't just draft UI state once set: it's the server's authoritative
 * record, held here only so downstream screens (SearchingDriver) can
 * read it without a redundant fetch.
 */
export function RideDraftProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RideDraftState>(EMPTY_STATE);

  const value = useMemo<RideDraftContextValue>(
    () => ({
      ...state,
      setPickup: (point) =>
        setState((prev) => ({ ...prev, pickup: point, route: null, ride: null })),
      setDestination: (point) =>
        setState((prev) => ({ ...prev, destination: point, route: null, ride: null })),
      setRoute: (route) => setState((prev) => ({ ...prev, route })),
      setRide: (ride) => setState((prev) => ({ ...prev, ride })),
      reset: () => setState(EMPTY_STATE),
    }),
    [state],
  );

  return <RideDraftContext.Provider value={value}>{children}</RideDraftContext.Provider>;
}

export function useRideDraft(): RideDraftContextValue {
  const context = useContext(RideDraftContext);
  if (!context) throw new Error('useRideDraft must be used within a RideDraftProvider');
  return context;
}

import type { Coordinate, RoutePreview } from '@rideshare/maps';
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
}

interface RideDraftContextValue extends RideDraftState {
  setPickup: (point: NamedPoint) => void;
  setDestination: (point: NamedPoint) => void;
  setRoute: (route: RoutePreview) => void;
  reset: () => void;
}

const EMPTY_STATE: RideDraftState = { pickup: null, destination: null, route: null };

const RideDraftContext = createContext<RideDraftContextValue | undefined>(undefined);

/**
 * Holds the ride currently being assembled — pickup, destination, and
 * (once fetched) the route preview — across the HomeMap → DestinationSearch
 * → RoutePreview → RideEstimate flow. Nothing here is persisted or sent
 * anywhere until the passenger acts; this is UI draft state, not an
 * authoritative ride record (that doesn't exist until Phase 7).
 */
export function RideDraftProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RideDraftState>(EMPTY_STATE);

  const value = useMemo<RideDraftContextValue>(
    () => ({
      ...state,
      setPickup: (point) => setState((prev) => ({ ...prev, pickup: point, route: null })),
      setDestination: (point) => setState((prev) => ({ ...prev, destination: point, route: null })),
      setRoute: (route) => setState((prev) => ({ ...prev, route })),
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

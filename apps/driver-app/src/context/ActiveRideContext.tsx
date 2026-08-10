import type { Ride } from '@rideshare/types';
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

interface ActiveRideContextValue {
  ride: Ride | null;
  /** Set once an offer is accepted (Phase 8), and again after every
   * lifecycle transition (Phase 9) — each endpoint returns the updated
   * Ride, so screens always render the server's own authoritative state,
   * never a locally-guessed next status. */
  setRide: (ride: Ride) => void;
  clear: () => void;
}

const ActiveRideContext = createContext<ActiveRideContextValue | undefined>(undefined);

/**
 * Holds the ride a driver is currently working through —
 * IncomingRequestScreen sets it on Accept, and PickupNavigation / Arrival
 * / Ride / RideComplete all read (and advance) the same value — the same
 * "one shared piece of in-flight state instead of every screen re-
 * fetching and risking staleness" reasoning as DriverProfileContext and
 * apps/passenger-app's RideDraftContext.
 */
export function ActiveRideProvider({ children }: { children: ReactNode }) {
  const [ride, setRideState] = useState<Ride | null>(null);

  const value = useMemo<ActiveRideContextValue>(
    () => ({
      ride,
      setRide: (next) => setRideState(next),
      clear: () => setRideState(null),
    }),
    [ride],
  );

  return <ActiveRideContext.Provider value={value}>{children}</ActiveRideContext.Provider>;
}

export function useActiveRide(): ActiveRideContextValue {
  const context = useContext(ActiveRideContext);
  if (!context) throw new Error('useActiveRide must be used within an ActiveRideProvider');
  return context;
}

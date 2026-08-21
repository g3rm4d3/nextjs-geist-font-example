import { PlaceholderScreen } from '../components/PlaceholderScreen';

/** PHASE 23 NOTE: only reachable from RideHistoryScreen's list, which
 * doesn't exist yet either — see that screen's own comment for why. */
export function RideDetailsScreen() {
  return (
    <PlaceholderScreen
      title="Ride Details"
      description="A dedicated past-ride detail view isn't built yet — it depends on the ride history list this app doesn't have (see the Ride History screen)."
    />
  );
}

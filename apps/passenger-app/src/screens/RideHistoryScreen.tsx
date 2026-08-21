import { PlaceholderScreen } from '../components/PlaceholderScreen';

/**
 * PHASE 23 NOTE: this screen's original description blamed "Phase 7"
 * for the missing data — stale even at the time it was written (rides
 * have existed since Phase 7 completed), and long since false by this
 * phase. The real reason this stays a placeholder isn't that rides
 * don't exist; it's that no backend endpoint exists yet for "list this
 * passenger's own past rides" (there's no `GET /passengers/me/rides` —
 * see docs/design-system.md's Known Limitations). Building that
 * endpoint (repository query, service, route, tests) plus this screen's
 * real list UI is a real feature, not a UX polish item, so it stays
 * out of this phase's scope — documented honestly rather than
 * left to look like an oversight or, worse, quietly re-blamed on a
 * phase that finished 15+ phases ago.
 */
export function RideHistoryScreen() {
  return (
    <PlaceholderScreen
      title="Ride History"
      description="A self-service ride history list isn't built yet — there's no backend endpoint for it. In the meantime, each ride's outcome is shown right after it completes."
    />
  );
}

# Maps & Routing — Phase 3

## Why routing lives server-side

`apps/passenger-app` never calls a map/routing provider directly. It
calls `POST /routes/preview` on `apps/api`, which calls
`@rideshare/maps` internally. Two reasons:

1. **No API key ever ships inside a mobile bundle.** A Google
   Directions/Distance Matrix key embedded in a mobile app can be
   extracted from the compiled bundle. Keeping the provider call
   server-side means the key (when one exists) lives in `apps/api`'s
   environment, never in a client artifact.
2. **Route data feeds fare calculation.** Distance and duration are
   direct inputs to the pricing engine (Phase 4). Section 3's rule —
   mobile clients are never the authoritative source for fares — extends
   backward to the route those fares are computed from. Computing it
   server-side from day one avoids a client-trusts-itself pattern that
   would need to be re-architected later.

## The abstraction

`@rideshare/maps` exports one interface:

```ts
interface RouteProvider {
  getRoute(origin: Coordinate, destination: Coordinate): Promise<RoutePreview>;
  // RoutePreview = { distanceMeters: number; durationSeconds: number }
}
```

`apps/api/src/lib/mapProvider.ts` holds the single shared instance every
route handler uses. Swapping the implementation later is a one-line
change there — nothing that calls `routeProvider.getRoute(...)` needs to
know or care which implementation is behind it.

## Current implementation: MOCK (haversine)

`createHaversineRouteProvider()` is the only implementation that exists
right now. It computes great-circle (straight-line) distance between two
points, applies a fixed 1.3× "road distance" correction factor (a common
rough heuristic — real roads are never perfectly straight), and derives a
duration from an assumed 30 km/h average urban speed.

**This is explicitly a MOCK, the same pattern as Phase 1's
`BackgroundCheckProvider = MOCK ONLY`:** no real road network, no
traffic, no turn-by-turn path, no one-way streets. It exists so
"create a valid route from pickup to destination" (Phase 3's definition
of done) is fully testable without a paid, network-dependent routing API
key — which this environment has no way to provision or independently
verify. It's covered by real unit tests (`packages/maps/src/haversineRouteProvider.test.ts`)
that check its actual geometry (distance for one degree of latitude,
symmetry, speed-to-duration scaling), not just that it returns numbers.

Replacing it with a real provider (Google Directions or otherwise) later
means writing one more file that implements `RouteProvider` and pointing
`mapProvider.ts` at it — no changes anywhere else.

## Map rendering (passenger app)

`apps/passenger-app` uses `react-native-maps` for the actual map UI
(`HomeMapScreen`, `RoutePreviewScreen`). This is a device-rendered native
view, so it's inherently something this environment cannot visually
verify — there is no simulator or device attached to this session. What
*is* verified: the code typechecks, lints, and the Metro bundle exports
successfully (`expo export --platform android`, 895 modules, no import
errors) — the same validation ceiling established for these apps since
Phase 0.

Two platform notes:

- **iOS** uses Apple Maps by default and needs no API key at all.
- **Android** needs a Google Maps API key to render tiles
  (`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`, optional — see
  `apps/passenger-app/.env.example`). Unlike a backend secret, this key
  is *designed* to be client-embedded and is restricted by Android
  package name + SHA-1 signing certificate in Google Cloud Console, not
  by being kept out of the bundle. **Known limitation:** no real key is
  configured or verifiable in this environment, so Android map tiles
  won't render until a developer supplies one.

## Destination search (passenger app)

There is likewise no Google Places (or equivalent) API key configured or
verifiable here, so `DestinationSearchScreen` searches a small curated
list of real dev-fixture places (`src/data/sampleDestinations.ts`)
instead of free-form address geocoding. Pickup is set by GPS (via
`expo-location`, with a manual drag-to-adjust fallback if permission is
denied) rather than search, so it doesn't have the same gap.

## What Phase 3 does not include

- **Matching.** Phase 3's spec explicitly says not to implement it yet.
  `RequestRideScreen`, `SearchingDriverScreen`, and `DriverAssignedScreen`
  exist in the navigation stack (the full Phase 3 screen list is wired
  up) but are honest placeholders — see `docs/architecture.md`'s pattern
  from Phase 0 for stub screens, applied the same way here.
- **Fares.** `RideEstimateScreen` shows distance and duration only; fare
  display is explicitly deferred to Phase 4 (Pricing Engine), which is
  the only thing allowed to compute one.

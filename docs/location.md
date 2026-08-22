# Location — Phase 24

## Scope

The canonical, short reference for how driver location works — one of
the docs required for Stage 1 Final Validation. `docs/
location-infrastructure.md` (Phase 6) is the full design narrative
(staleness thresholds, the 50-virtual-driver simulator, the admin
fleet map); this doc is the "what exists and where" summary.

## The flow

```
Driver app: expo-location foreground permission
  │
  ├─ Denied → graceful fallback (approximate area, "not being sent to
  │           the server" banner) — no crash, no blank map
  │
  ▼
Granted → GPS reading → POST /drivers/me/location (ping)
  │
  ▼
driver_locations (latest position per driver, upserted, not a full
  history) + ride_location_samples (Phase 10 — only recorded while a
  ride is IN_PROGRESS, configurable sampling interval, feeds
  actualDistanceMeters at ride completion)
  │
  ▼
Reads:
  - GET /rides/:id/driver        (passenger — assigned driver's live position)
  - GET /admin/drivers/locations (admin — every online driver, fleet map)
```

## Staleness

A driver's location is only considered current for matching eligibility
(`docs/matching.md`) within `STALE_THRESHOLD_MS` (2 minutes) of the
last ping — a driver who stopped pinging (app killed, phone died) stops
being offered new rides without needing an explicit "went offline"
signal.

## GPS permission handling

Both the passenger app (setting pickup) and driver app (going online,
tracking during a ride) request foreground location permission and
degrade gracefully on denial — a visible banner plus a sensible
fallback (a generic map center passengers can drag a pin from; an
"approximate area, not tracked" state for drivers) rather than a blank
map or silent failure. See `docs/design-system.md`'s own "GPS
permission handling" section (Phase 23 confirmed this already worked
correctly and needed no changes).

## Known limitations

See `docs/location-infrastructure.md`'s own Known Limitations for the
complete list (location data is entirely self-reported by the client
device — see `docs/security.md`'s "location manipulation → fare
manipulation" finding and its cap-based mitigation; no historical
location trail beyond `ride_location_samples`' per-ride window).

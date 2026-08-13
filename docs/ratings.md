# Ratings — Phase 13

## Scope

Section 13: "Passenger rates Driver," "Driver rates Passenger," 1-5
stars with an optional comment, one rating per direction per completed
ride, ratings unavailable before ride completion, and aggregate ratings
calculated server-side.

No schema migration was needed for the `ratings` table itself —
`ratings` (with `ratings_ride_direction_key`, a unique index on
`(ride_id, direction)`, and a `1 <= stars <= 5` check constraint) and
the `rating_direction` enum (`PASSENGER_TO_DRIVER` / `DRIVER_TO_PASSENGER`)
were already fully defined in Phase 1's schema, anticipating this phase
exactly. `driver_profiles.average_rating`/`total_rides` existed too, but
nothing had ever written to them outside `seed.ts`. This phase's one
migration (`0004_optimal_thunderbolt_ross.sql`) adds the symmetric
counterpart: `driver_profiles.ratings_count` and
`passenger_profiles.average_rating`/`ratings_count` — a passenger has an
aggregate rating too (drivers rate passengers), and there was previously
nowhere to store it.

## Two symmetric directions, one shared shape

`ratingsService.ts` has exactly two rating-submission functions,
mirror images of each other:

```ts
submitPassengerToDriverRating(rideId, userId, { stars, comment }): Promise<Rating>
submitDriverToPassengerRating(rideId, userId, { stars, comment }): Promise<Rating>
```

Each does the same four things in the same order:

1. Resolve the caller's own profile (passenger or driver) from their
   JWT `userId` — never trust a client-supplied identity for who's
   rating whom.
2. Load the ride and confirm the caller is actually a party to it
   (`ride.passengerId`/`ride.driverId` must match) — a ride that doesn't
   exist and a ride that isn't the caller's both surface as `404`, the
   same not-found-not-forbidden treatment used everywhere else in this
   codebase.
3. Confirm `ride.status === 'COMPLETED'` — section 13's "ratings
   unavailable before ride completion," a `409` otherwise.
4. Confirm no rating already exists for this `(rideId, direction)` — a
   friendly `409` check-first, with `ratings_ride_direction_key`'s own
   unique index as the actual guarantee behind "one rating per direction
   per completed ride" (the same "read-first for a nice error,
   constraint for the real guarantee" split used throughout this
   codebase, e.g. `payment_records.idempotency_key`).

Only then does it insert the row and recompute the ratee's aggregate.

## Aggregate ratings, calculated server-side

Section 13 says "calculate aggregate ratings server-side" — taken
literally: every time a new rating lands, `ratingsRepository.sumRatingsForRatee`
runs a **full recompute** (`AVG(stars)`, `COUNT(*)`) over every rating a
user has ever received, and the result is written straight to that
user's `average_rating`/`ratings_count` columns. Not an incrementally
maintained running average — a real user is only ever the ratee in one
direction (a driver is never `DRIVER_TO_PASSENGER`'s ratee, a passenger
never `PASSENGER_TO_DRIVER`'s), so the aggregate is naturally scoped by
`rateeUserId` alone, and at Stage 1's ride volume, a full recompute on
every write is simpler — and more obviously correct — than maintaining
running sums that could drift.

## Routes

| Method | Path | Notes |
|---|---|---|
| `POST` | `/rides/:id/rating` | Passenger-only; submits `PASSENGER_TO_DRIVER`. `201`. |
| `GET` | `/rides/:id/ratings` | Passenger-only; both directions for a ride they're part of. |
| `POST` | `/drivers/me/rides/:id/rating` | Driver-only; submits `DRIVER_TO_PASSENGER`. `201`. |
| `GET` | `/drivers/me/rides/:id/ratings` | Driver-only; both directions for a ride they're part of. |

`GET .../ratings` always returns `{ passengerToDriver, driverToPassenger }`
— each side present or `null`, never a list, since at most one rating
can exist per direction per ride. Neither side can see the other's
un-submitted intent to rate; both are just reads of whatever rows
currently exist.

The two aggregate columns this phase writes are exposed too:
`GET /drivers/me/profile` now includes `averageRating`/`ratingsCount`,
and `GET /rides/:id/driver` (Phase 10's assigned-driver info) includes
`averageRating` — a passenger can see their driver's aggregate rating
while the ride is in progress, not just after.

## Client changes

**passenger-app**: `RideCompleteScreen` gains a "Rate your driver" card
below the payment card — a `StarRatingInput` (five tappable Unicode star
glyphs, no icon-library dependency) plus an optional comment field.
Submitting calls `POST /rides/:id/rating`; the card then shows the
submitted rating read-only ("Thanks for rating this ride") instead of
the form, whether that submission just happened or the screen is being
revisited after the fact (`GET /rides/:id/ratings` on mount decides
which state to render). `DriverAssignedScreen` shows the assigned
driver's aggregate rating (`StarRatingDisplay`, a single star glyph plus
the numeric average) next to their name.

**driver-app**: `RideCompleteScreen` gains the mirror-image "Rate your
passenger" card, same component pair, same submit-then-lock-in
behavior, calling `POST /drivers/me/rides/:id/rating`. `ProfileScreen`
shows the driver's own aggregate rating and ratings count next to their
role.

Both apps' `StarRatingInput`/`StarRatingDisplay` components are
deliberately duplicated (themed to each app's own palette) rather than
shared — the same "independent app packages, no domain logic to keep in
sync" reasoning `apps/*/src/lib/format.ts` already established.

## Tests

`apps/api/src/routes/ratings.test.ts` (10 tests), against a real
PostgreSQL database, driving full passenger/driver registration →
matching → lifecycle → `COMPLETED` flows via HTTP:

- A passenger rating a driver recomputes the driver's aggregate
  (verified via `GET /drivers/me/profile`); a driver rating a passenger
  recomputes the passenger's aggregate (verified via a direct
  `passenger_profiles` read, since there's no passenger-facing profile
  endpoint to check it through).
- The aggregate is a genuine average across multiple rides for the same
  driver (5 and 3 stars → 4.0), not just the latest rating.
- Rating a ride that hasn't reached `COMPLETED` → `409`.
- A second rating in the same direction for the same ride → `409`, and
  the first rating's stars are confirmed unchanged.
- `stars` outside `1-5` → `400`.
- Cross-user isolation: a passenger cannot rate or read another
  passenger's ride (`404`); same for a driver and another driver's ride.
- Role-gating: a driver hitting the passenger-only rating route (and
  vice versa) → `403`.
- `GET .../ratings` shows `{ null, null }` before either party has
  rated, then fills in each side independently as each rating lands.

Full repo verification after this phase: lint, typecheck, and a clean
`rm -rf packages/*/dist && npm run build` all pass; a from-zero
`db:migrate` + `db:seed` is clean; 156 tests passing in `apps/api` (up
from 146 before this phase), every other workspace's suite unaffected
(existing `DriverProfileSummary`/`AssignedRideDriverInfo` fixtures in
`packages/types` and `apps/api`'s own tests were updated for the two new
required fields).

## Known limitations

- **No rating edit or deletion.** Once submitted, a rating is
  permanent — there is no "change your rating" flow, matching the
  spec's flat "one rating per direction per completed ride" with no
  mention of revision.
- **No rating moderation.** Comments are free text, stored and returned
  as-is; there is no profanity filter, length-based truncation beyond
  the 1000-character validation cap, or admin review queue for
  disputed/abusive comments.
- **No passenger-facing "my rating" profile endpoint.** A passenger can
  see their own submitted rating for a specific ride
  (`GET /rides/:id/ratings`), but there's no `GET /passengers/me` -style
  summary of their own aggregate rating and count — nothing in Stage 1's
  passenger-app currently needs to show a passenger their own aggregate
  score.
- **Ratings never affect matching, pricing, or driver eligibility.** A
  low `average_rating` is purely informational in Stage 1 — there's no
  minimum-rating cutoff for matching (Phase 8) or any other downstream
  behavior change.

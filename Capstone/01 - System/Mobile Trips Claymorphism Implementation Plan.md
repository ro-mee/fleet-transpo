# Mobile Trips and Trip Details — Claymorphism Plan

Date: 2026-09-09
Status: Implemented; automated checks passed. Native device acceptance remains pending.

### Follow-up verification — 2026-09-09

Shared map preview refinement: Trip Details' embedded map now reuses Home's TripMapPreview, including clay route/pins, endpoint labels, loading/unavailable states and camera fitting. Removed the redundant outer card frame around it. Kept the existing interactive TomTom full-map modal and all trip actions. Targeted lint and eight preview/detail tests passed; device visual confirmation remains pending.

Forest accent follow-up: Trips Details affordances and Completed badges now use primary/onPrimary instead of pale container fills. Home assignment Details buttons use the same pair, including spinner/icons. Existing dark/high-contrast theme adaptation and all action handlers remain unchanged.

**Stronger clay styling:** User requested more visible depth. Trips and Trip Details now use 30dp card curves, 8dp-offset soft shadows, brighter upper edges and shaded lower edges, larger spacing, raised status/Details controls, and 58dp detail action buttons. Shared route nodes increased to 24dp with soft elevation. Warm background, semantic colors, text and trip handlers remain unchanged. Targeted ESLint and diff checks passed; native visual acceptance remains pending. This is a styling-only refinement, not a trip-policy change.

**Build blocker resolved:** On the user's follow-up, restored the temporary VisualReview app configuration to the existing FleetOps backup (name/slug, iOS/Android settings, platforms, EAS project). `mobile/app.json` now matches the tracked configuration; backup and unrelated preview files were retained. Android Expo export passed with 1,346 modules into `.expo/trips-review-export`; diff checks passed. This is a JavaScript/Hermes export, not a signed APK or a physical-device smoke test. Android device tooling was unavailable at the standard SDK path, so on-device acceptance remains pending.

The Trips/detail implementation was already present when this follow-up began. Preserved it and unrelated Home/weather/tracking work. Fixed the detail banner's comma-expression style (which discarded its layout), removed the misleading ready-to-start message when inspection is outstanding, and renamed the unknown-schedule queue label to SCHEDULE UNCONFIRMED. Invalid start timestamps now enter that same bucket, covered by the queue regression test.

Current verification: targeted ESLint passed, mobile utility tests passed (11 files / 92 tests), and git diff whitespace checks passed. The fresh Android export was BLOCKED: mobile/app.json currently identifies a VisualReview app with platforms restricted to web, alongside another task's visual-review harness. That configuration was not changed or reverted here. Earlier export results below are historical, not proof of the current workspace. Native rendering and the final Android export remain pending until the normal app configuration is restored by its owner. No commit created.

## Scope and visual authority

Refine the driver Trips screen (`mobile/app/(app)/(tabs)/trips.js`) and Trip Details (`mobile/app/(app)/trip/[id].js`) to match the implemented Home direction. “Trip nav” is interpreted as the screen reached through the Trips tab, not a redesign of the whole bottom navigation bar. Preserve tab routes, fuel scan action, global SOS, safe areas, and unrelated screens.

Audience/mode: drivers operating an assignment queue. Success means identifying the next relevant trip, understanding its route and prerequisites, and taking the correct existing action without ambiguity.

Keep warm ivory `#F5F2EC`, forest `#285448`, existing fonts and dark/high-contrast themes. Use softly raised 22–24dp cards, restrained top-edge highlights, rounded status pills, tactile 48dp buttons, and clear route timelines. No white page replacement, heavy blur, deeply nested cards, new dependency, decorative KPI image repeated on every trip, or fake map/data.

## 1. Trips screen

- Replace the current time/progress block with a compact raised summary: Trips title, date, loaded open-assignment count, and a clearly labeled View Map action. The current count includes multiple dates and comes from a capped response: do not label it “Today's Progress” or imply a complete server-wide total.
- Preserve the operational queue: In Progress → Overdue → Ready → Upcoming → Completed → Cancelled, with departure ordering inside each group. Keep overdue visibility; do not replace this with an unqualified chronological list. Queue labels are not permission to start.
- Use one softly raised card per trip rather than an outer-card/inner-card pair. Hierarchy: actual status/queue context and date-time → pickup/drop-off timeline → passenger/vehicle metadata → clear Details affordance. Let long routes wrap. Keep semantic warning/error accents for overdue trips.
- Default the list action to opening that trip's details; do not label navigation to an unscoped map as “Start Trip.” Avoid nested Pressables. A map remains available through the screen-level View Map action.
- Keep list cards compact: no live map mounted on each row, no new search/filter feature in this slice. Preserve refresh, source cache, four-state offline handling, and failure messages.

## 2. Trip Details

- Raised back control and simple Trip Details header, followed by a compact summary with real trip identifier, status, and scheduled date/time.
- Make pickup/drop-off timeline the main content, followed by the existing map in a rounded panel. Preserve map functionality; verify its supported gesture controls so it does not make vertical page scrolling difficult. Any changed map interaction must retain access to the full map.
- Present start-window and inspection prerequisites together in a calm readiness panel near the top for pre-start trips. Explain why the action is unavailable; a passed time window alone is not permission to start. Keep completed/cancelled summary data for terminal trips.
- Passenger details and special requests use quieter raised sections. Display only supplied data: no invented VIP status, passenger total, departure, completion time, or telephone action.
- Retain a bottom safe-area action area with a single primary action: existing accept/start flow for eligible pre-start trips, navigation for active trips, read-only closure state for terminal trips. Buttons use min-height and wrapping text rather than clipping fixed-height labels. Show saving/queued/error feedback distinctly.

## 3. Confirmed issues to resolve explicitly before visual acceptance

These are existing source findings, not changes already implemented. Treat the small behavioral corrections as a separately reviewable part of the proposed work; do not redesign the server lifecycle.

1. List “START TRIP” currently routes only to `/map`; make it truthful trip-specific details navigation.
2. Detail “CONTINUE TO MAP” currently shares a handler that issues accept/start writes for non-terminal active trips. Trace map selection and callers, then branch active-trip navigation from pre-start mutation. Add a regression check that Continue does not write accept/start.
3. Detail fetch failures/not-found currently fabricate a Completed trip online. Replace that presentation with explicit retry/unavailable/not-found handling, preserving cached display where appropriate. A failed request must not claim completion.
4. Detail currently hardcodes `VIP Guest`, defaults missing departure to `10:00 AM`, changes zero/missing passenger count to one, and renders a call button without a handler. Show real values or “Not provided”; omit unbacked VIP/contact affordances. Verify API fields before adding phone functionality.
5. Completion time currently prefers `updated_at` over `completed_at`. Use verified completion data for an arrival/completion label; never infer arrival from a generic update timestamp.
6. List readiness treats missing earliest-start as ready, while detail requires a valid window and passed inspection. Preserve server authority and do not silently loosen either gate; label the queue's scheduling readiness accurately and keep detail prerequisites decisive. Any policy unification is outside visual styling unless separately agreed.

## 4. Reuse and implementation order

1. Recheck source, relevant trip/API contracts, native Expo instructions and existing dirty changes. Record behavior expectations for pending/accepted/active/terminal cases before editing.
2. Implement the compact Trips presentation using existing theme/type/status helpers. Preserve queue computation unless a separately tested correction is approved.
3. Implement detail hierarchy and action area using the same Home material language. Reuse the existing map and offline components. Extract only a genuinely shared small timeline/surface helper if it prevents duplication; do not force Home's Current/Next data model onto the full queue.
4. Apply and test the explicitly listed truthfulness/action corrections as a distinguishable diff. No auth, backend, database, API URL, cache namespace, GPS, geofence, or state-machine changes.
5. Verify, then update this note and SYSTEM.md with actual results. No commit unless requested.

## 5. Acceptance checks

- Targeted ESLint, relevant mobile utility tests, Android Expo export, and diff/conflict checks. Add focused regression coverage for any changed action/error branches. Do not claim a type-check if no mobile command exists.
- Visual review at 320/360/390/430dp and a wider layout, large text, dark/high contrast, and reduced motion. At least 48dp controls, readable status contrast, no route/time truncation, no footer/SOS/system-navigation overlap.
- Exercise pending, accepted, active, overdue, future, completed, cancelled, missing schedule, inspection blocked, zero/missing passengers, long names/notes, no coordinates, and unavailable map.
- Exercise loading, confirmed-empty, online failure, offline saved/never-synced, retry, and queued updates. No false Completed, VIP, readiness or “today” claims.
- Verify that opening list details addresses the selected trip; continuing an active trip does not repeat accept/start; starting preserves acceptance, inspection and departure requirements; terminal trips have no start action.
- One batched visual review, one fix batch, and one confirmation pass. Report native device checks as pending when no device is available; browser previews are not native end-to-end proof.

## Planning evidence

Inspected Trips source, detail loading/action/rendering, tab layout, Home implementation outcome, mobile architecture/offline rules, and trip-state documentation. Impeccable Shape guided the screen hierarchy and confirmation boundary; Ponytail kept the plan to existing components and minimal corrections. Prior session context is native driver UI; existing web design context is not authority for replacing its palette. No runtime changes or new build/test claims in this planning task.

## Implementation outcome — 2026-09-09

- **Trips list**: one softly raised clay card per trip (radius 22, padding 16, Home's shade values, surfaceContainerLow, restrained top-edge highlight) replaces the outer/inner card pair. Hierarchy is status pill (radius 20, `statusColorForTone` per queue tone) + departure date-time → shared RouteTimeline → passenger/vehicle meta row → "Details ›" affordance. Route text wraps (no `numberOfLines` truncation); overdue trips keep semantic danger accents on the pill and timeline.
- The list action is now truthful: the whole card is a single Pressable to `/trip/{trip_id}` (with accessibility label). The inner "START TRIP" button — which routed to the unscoped `/map` — is gone. The summary card shows the loaded open-assignment count with a `+` when the response is capped and an explicit "may span multiple dates" caption. "CURRENT TIME"/"TODAY'S PROGRESS" removed. **Later the same day (owner decision): the summary card's View Map action was removed** — the Live Map tab is the only map entry point from the Trips screen.
- **Queue split for issue 6**: pre-start trips with an unknown `earliest_start` now bucket as **READY · SCHEDULE UNCONFIRMED** instead of claiming READY. Bucketing/sorting extracted to pure `mobile/lib/trips-queue.js` (vitest-covered); the server's start gates are untouched and the list never gates on inspection.
- **Trip Details**: fetch is now an explicit state machine — loading / data / notFound ("This trip isn't in your loaded assignments." + retry) / error (+ retry) / offline never-synced. The dead `/api/trips/{id}` fallback (drivers get 403 from `trips:read_all`) and both fabricated-Completed paths are deleted; the online fetch widens to `?status=all&limit=100` (client-side only). A cached copy stays visible with its SyncNote even if the fresh list omits the trip.
- **Action split for issue 2**: `detailPrimaryAction(trip)` (pure, in `mobile/lib/trip-detail.js`) decides 'accept-start' | 'navigate' | 'closed'. CONTINUE TO MAP on an active trip now navigates only — regression-tested that no active status re-issues accept/start writes. The pre-start flow keeps the accept→start sequence, inspection alert branch with PRE-TRIP CHECK button, wasQueued feedback, and `router.replace('/map')`.
- **Truthful facts**: scheduled departure shows `departure_time` or "Not provided" (no `10:00 AM` default); completion time uses `end_time` only (the trips table has no `completed_at`; `updated_at` never shown as arrival); passenger name/count shown only as supplied (no `|| 1`, no "VIP Guest", no handler-less call button — the API has no phone field); odometer labels are the real fields (`start_odometer`, `current_mileage` labeled as vehicle mileage) with "Not recorded" fallbacks.
- **Map panel**: a static `TripMapPreview` (added in the follow-up pass, replacing the embedded WebView) so page scrolling is never captured. The interim "Open full map" control + full-screen Modal were **removed later the same day by owner decision** — the detail screen shows the static route overview only, and interactive navigation lives on the Live Map tab (still reachable via the tab bar and the CONTINUE TO MAP action). No TomTomMap changes. RouteTimeline is a new shared component (`mobile/components/RouteTimeline.jsx`); Home's own copy untouched.
- Preserved: 30s queue/readiness tick (detail skips it once Trip Started), pull-to-refresh, TRIPS_ALL cache read/write, offlineViewState 4-state handling, transport-failure dedup, offlineRef pattern, empty/never-synced/confirmed-empty distinctions, tab routes, fuel scan, global SOS, safe areas.
- Verification: full mobile Vitest suite 13 files / 97 tests passed (includes 13 new tests across trips-queue + trip-detail); touched-file ESLint clean (2 apostrophe warnings fixed); Android Expo export passed. No mobile type-check command exists. No auth/backend/API/cache/GPS/state-machine changes; no new dependencies; Home files untouched; no commit created.
- Native device checks (real navigation, live maps, on-device start flow, visual widths) remain pending — no device/emulator was available in this session.

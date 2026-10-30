# FleetOps Mobile

The Expo client for drivers. It shares backend resources with the
web app but has its own environment file because mobile builds cannot keep
secrets private.

The current build is **driver-only**. Non-driver accounts are rejected at
login; the guest experience is not implemented yet.

## Local setup

1. Copy `.env.example` to `.env` and set the public values.
2. Run `npm install` from this folder.
3. From the repository root, use `npm run db:status` and the existing
   `npm run db:up` migration runner when database setup is needed. Do not
   apply a single historical migration independently.
4. Start the API from the repository root in a second terminal with
   `npm run dev` (default port `3000`).
5. Run `npm start -- --dev-client --lan` from `mobile` for local Expo/Metro testing.

Use your computer's current LAN IP for `EXPO_PUBLIC_API_URL` when testing on a
phone; `localhost` refers to the phone, not the computer. Reload Expo after
changing `.env` so the value is re-inlined into the bundle. A downloaded
preview/production APK has the API URL baked in and cannot be redirected to
Metro without rebuilding. For an EAS development APK, build it once with
`eas build -p android --profile development`, then use Metro for JS-only
changes; native dependency or app-config changes still require a rebuild.

## Structure

Routing is file-based via `expo-router`; `package.json` `main` points at
`expo-router/entry`, so there is no `App.js`.

| Path | Purpose |
|---|---|
| `app/_layout.js` | Root layout, wraps everything in `AuthProvider` + error boundary |
| `app/login.js` | Driver sign in; redirects out once a session exists |
| `app/(app)/_layout.js` | Auth + consent guard for signed-in routes |
| `app/(app)/(tabs)/` | Bottom-tab driver app: Home, Map, Trips, Profile; scan is a separate fuel action |
| `app/(app)/fuel-report.js` | Fuel submission for the active trip's vehicle |
| `app/(app)/incidents.js` | Driver incident / emergency reporting |
| `app/(app)/inspection.js` | Dual-mode inspection screen: Pre-Shift (7-point baseline) and Quick Pre-Trip (4 critical items) |
| `app/(app)/end-duty.js` | End Duty report — one question ("anything unusual?") plus free text; submitting it is what closes the shift |
| `app/consent.js` | Privacy policy consent gate |
| `lib/api.js` | fetch wrapper; timeout, retry, refreshes token on 401. `ApiError` carries the server's `code` so screens branch on it (e.g. `PRESHIFT_REQUIRED`) rather than matching message text |
| `lib/end-duty.js` | Pure nudge window — 30 min before the server's shift end, staying open afterwards |
| `lib/use-duty.js` | One duty-state hook (`checkedIn`/`busy`/`preshiftRequired`/`today`/`due`) used by Home and operational screens |
| `lib/api.js` | fetch wrapper; timeout, retry, refreshes token on 401 |
| `lib/auth.js` | Session context |
| `lib/storage.js` | Token storage via `expo-secure-store` |
| `lib/tracking.js` | 30-second GPS posts during an active trip |
| `lib/tripRef.js` | Server-fed trip status reference data (`/api/mobile/driver/ref`) |
| `lib/theme.js` | Native forest/ivory/brass tokens; separate from web tokens |
| `components/ui.js` | Shared primitives (card, pill, button, field) |
| `components/logo.js` | Brand mark and wordmark (FleetOpsMark / FleetOpsWordmark / Logo) |
| `components/plate.js` | Physical license-plate treatment for vehicle identity |

## Auth

Login exchanges credentials for a 15-minute access token and a 30-day refresh
token, both signed with `NEXTAUTH_SECRET`. `lib/api.js` refreshes transparently
on a 401 and funnels concurrent refreshes into one request, because refresh is
single-use and rotating.

## Trip status data

Trip status grouping, tones, and the next-available driver action come from
`GET /api/mobile/driver/ref` (server-owned state machine in
`src/lib/scheduling/trip-state.js`), not hardcoded client constants.

## Operational behavior and verification

The driver app includes push notifications, an account-scoped offline cache and
outbox, and active-trip background location through the existing tracking owner.
OS permission/process limits still apply; a force-stopped app cannot promise GPS.
Consequential operations such as session revocation, consent, phone/leave changes,
arrival override and responder transitions require server acknowledgment.
Locally queued incident/Cargo receipts remain distinct from accepted server data.

Home preserves the approved Cargo/Hotel illustrated overview and images,
with truthful duty, Incident visible and End Duty separately reachable. The approved clay card/button and curved-wave navigation appearance is retained.
Inputs/popups keep their audit refinements, with48dp controls, readable semantic
status pairs and reduced motion. Cargo uses
the exact trip, frozen signing review and immutable retries; old vehicle/fuel
routes redirect to canonical destinations. Guest use remains unimplemented.

The full dated audit, implemented scope, final software checks and remaining
physical-device acceptance are in `Capstone/01 - System/Mobile UI UX Audit
2026-10-29.md` at the repository root. React Native Web fixtures are layout
evidence with native/API boundaries substituted, not device acceptance.

## Security boundary

Only `EXPO_PUBLIC_*` configuration may appear in this folder. The API must
derive the authenticated guest or driver from the session/token; a mobile
client must never choose its own `driver_id`, `guest_id`, `vehicle_id`, or
authorization role.

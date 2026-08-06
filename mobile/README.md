# FleetOps Mobile

The Expo client for guests and drivers. It shares backend resources with the
web app but has its own environment file because mobile builds cannot keep
secrets private.

The current build is **driver-only**. Non-driver accounts are rejected at
login; the guest experience is not implemented yet.

## Local setup

1. Copy `.env.example` to `.env` and set the public values.
2. Run `npm install` from this folder.
3. Apply `supabase/migrations/014_mobile_tokens.sql` to the database. Login
   fails without it — the table backs the refresh-token revocation list.
4. Run `npm start`.

Use your computer's LAN IP for `EXPO_PUBLIC_API_URL` when testing on a phone;
`localhost` refers to the phone, not the computer.

## Structure

Routing is file-based via `expo-router`; `package.json` `main` points at
`expo-router/entry`, so there is no `App.js`.

| Path | Purpose |
|---|---|
| `app/_layout.js` | Root layout, wraps everything in `AuthProvider` |
| `app/login.js` | Driver sign in; redirects out once a session exists |
| `app/(app)/_layout.js` | Auth guard for signed-in routes |
| `app/(app)/index.js` | Trip list, accept/decline, status flow, location |
| `app/(app)/fuel-report.js` | Fuel submission for the active trip's vehicle |
| `lib/api.js` | fetch wrapper; refreshes the access token on 401 |
| `lib/auth.js` | Session context |
| `lib/storage.js` | Token storage via `expo-secure-store` |
| `lib/tracking.js` | 30-second GPS posts during an active trip |
| `lib/theme.js` | Semantic tokens from `docs/design-system.md` |
| `components/ui.js` | Shared primitives (card, pill, button, field) |
| `components/logo.js` | Brand mark and signed-in top bar |
| `components/plate.js` | Physical license-plate treatment for vehicle identity |

## Auth

Login exchanges credentials for a 15-minute access token and a 30-day refresh
token, both signed with `NEXTAUTH_SECRET`. `lib/api.js` refreshes transparently
on a 401 and funnels concurrent refreshes into one request, because refresh is
single-use and rotating.

## Not implemented

- Guest experience
- Receipt camera and OCR (`docs/mobile-mvp.md` requires driver review of
  extracted values before submission)
- Push notifications and offline sync
- Background location — foreground only, so position stops updating when the
  driver leaves the app

## Security boundary

Only `EXPO_PUBLIC_*` configuration may appear in this folder. The API must
derive the authenticated guest or driver from the session/token; a mobile
client must never choose its own `driver_id`, `guest_id`, `vehicle_id`, or
authorization role.

---
type: feature
status: working
tags: [feature, notifications, triggers]
source:
  - supabase/migrations (notification triggers)
  - src/app/api/notifications
last_verified: 2026-08-11
related: ["[[Dispatch]]", "[[Trips]]"]
---

# Feature: Notifications

## What it does

Creates in-app notifications for the events staff and drivers need to know about. **164 rows** — one of the more genuinely exercised features.

## The design choice: notifications are database triggers — CONFIRMED

Four plpgsql triggers write `notifications` rows:

| Trigger | Fires on |
|---|---|
| `trigger_notify_dispatch_created` | new [[dispatchschedules]] row |
| `trigger_notify_trip_completed` | [[trips]] reaching Completed |
| `trigger_notify_document_expiry` | document expiry threshold |
| `trigger_notify_maintenance_due` | maintenance threshold |

**Business logic living in plpgsql rather than JS is a real architectural decision, and it cuts both ways.**

**For:** a notification cannot be missed. Any code path that inserts a dispatch — the API, a migration, a manual `INSERT`, one of the root `apply*.js` scripts — produces a notification. No caller can forget.

**Against:** the logic is invisible from the JS codebase. Someone grepping `src/` for "notification" finds the read API and concludes notifications are created there. It isn't in version-controlled application code in any obvious place, it's harder to test, and it can't easily call out to email or push.

The repository does not currently document why this decision was made. → [[ADR-005 Notifications In Database Triggers]]

```mermaid
flowchart LR
    A["INSERT dispatchschedules"] --> T1[trg_notify_dispatch_created]
    B["UPDATE trips → Completed"] --> T2[trg_notify_trip_completed]
    C["document expiry scan"] --> T3[trg_notify_document_expiry]
    D["maintenance threshold"] --> T4[trg_notify_maintenance_due]
    T1 & T2 & T3 & T4 --> N[("notifications<br/>164 rows")]
    N --> W["Web dashboard"]
    N --> M["Mobile Alerts tab"]
```

## Delivery is in-app only — CONFIRMED

Rows in a table, read by the web dashboard and the mobile **Alerts** tab. No email, no push. A driver who doesn't open the app doesn't find out.

INFERRED: acceptable for a capstone demo; a real deployment would need push, and push can't come from a plpgsql trigger — it would need an outbox pattern or a Supabase webhook.

## Mobile 3-tier delivery — SHIPPED (2026-08-19)

The mobile driver app now surfaces new notifications through a 3-tier system instead of only the Alerts tab. All three route through a single delivery layer.

| Tier | Where it appears | Use for |
|---|---|---|
| 🔔 Push | Loud OS notification (real push, high-importance channel, sound) even when app is killed | Important real-time events |
| 📢 Heads-up | In-app banner **+ quiet OS notification** (low-importance channel, no sound) on shade/lock screen | Urgent / time-sensitive events |
| 💬 Toast | Compact pill above the tab bar | Confirmation / informational feedback |

**Tier classification** (`mobile/lib/notifications/tiers.js`, pure + unit-tested):
- `type === "Alert"` / `"Emergency"`, `severity ∈ {Critical, Major}`, or `reference_type === "incident"` → **push + heads-up**
- `type === "Warning"` or `severity === "Moderate"` → **heads-up only**
- everything else → **silent** (Alerts tab + badge only)

**Delivery architecture** (`mobile/`):
- `NotificationFeedProvider` (`context/notification-feed.jsx`) polls `/api/notifications` every 30s + on foreground, seeds a seen-set (no flood on mount), routes each new row through `tiers.js`, exposes `unreadCount` + mark-read. The Alerts tab and home-header badge read the same feed (no duplicate polling). Also fixes the Alerts tab's previously-broken `api.patch` mark-read calls → `api.put`.
- `NotificationHost` (`components/NotificationHost.jsx`, mounted in root layout) renders the heads-up banner + toast stacks — double-bezel, MD3 tone containers, spring motion, reduced-motion aware, ≤2 banners / ≤3 toasts, deep-link on tap.
- `notify.*` (`lib/notifications/notify.js`) is the imperative API (AppAlert-style singleton): `notify.toast / headsUp / push`.
- `lib/notifications/push.js` wraps `expo-notifications` (permission, Android channel, immediate local schedule, tap→deep-link via `mobileNotificationTarget`).

**Honest scope:** local notifications fire while the app process is alive (foreground or recently backgrounded). True push for a killed app still needs FCM/APNs + the outbox pattern — documented future work (see [[ADR-005 Notifications In Database Triggers]]).

**Install:** `expo-notifications@0.32.17` (SDK 54). Android local notifications need a dev build (`expo run:android`), which this dev-client project already uses.

## Real push delivery — SHIPPED (2026-08-19)

Replaced the in-app-simulated push with **server-sent real push** via Expo Push Service + FCM, so a push-worthy notification now arrives on the lock screen / notification shade even when the app is killed.

**Flow:**
1. On sign-in the mobile app mints an Expo push token (`getExpoPushTokenAsync` with the EAS `projectId`) and registers it via `POST /api/device-tokens`; on sign-out it deactivates it (`DELETE`). Fire-and-forget — push setup never blocks login/logout.
2. `device_tokens` table (migration 058, RLS: user manages own tokens; server send path bypasses RLS via service role).
3. When a push-worthy notification is created, `sendPush` (`src/services/push.service.js`) reads the target employees' active tokens and POSTs to `https://exp.host/--/api/v2/push/send` — best-effort, never throws, deactivates tokens Expo reports as `DeviceNotRegistered`.
4. `deliveryFor(row)` mirrors the mobile tier rule server-side and decides the OS surface: push-tier rows (`Alert`/`Emergency`, severity Critical/Major, or incident ref) go on the loud `default` channel with sound; heads-up-tier rows (`Warning`/`Moderate`) go on the quiet `heads-up` channel with **no sound** so they still reach the shade/lock screen without interrupting.

**Wired create paths:** `POST /api/notifications` (employee or role target), and the incident route's dispatcher alerts ("Vehicle Taken Out of Service", "🚨 URGENT: Active Dispatch Interrupted") + oversight "Incident Report Submitted" alerts.

**Double-delivery guard:** with real push enabled, the feed skips the in-app heads-up for push-tier rows (the OS banner already covered it). Now keyed on `notifications.pushed_at`: when the server pushed a row, the feed skips entirely; the local `notify.push` fallback only fires for rows the server couldn't push (e.g. no device token). Fixes a latent double-notify (server push + feed's local push firing for the same event).

## Trigger-created notifications now push via an outbox — SHIPPED (2026-08-19)

DB-trigger notifications (which bypass the API routes that call `sendPush`) now reach the OS through the vault's documented **outbox pattern** (realizes [[ADR-005 Notifications In Database Triggers]]):

- **Migration 059** adds `push_outbox` (id, employee_id, title, body, channel_id, reference_type, reference_id, status `pending|sent|error`, sent_at, error) + `notifications.pushed_at`. The `notify_dispatch_created` trigger was escalated `Info → Alert`, and a new `trigger_enqueue_dispatch_push` enqueues a loud (`default` channel) push for the assigned driver on every `dispatchschedules` insert.
- **`flushOutbox()`** (`src/services/push.service.js`) reads `pending` rows, sends each via `sendPush` on its channel, marks them `sent`, and stamps `notifications.pushed_at`. Best-effort, never throws.
- **Hooked** (fire-and-forget) after dispatch creation: `POST /api/dispatch`, and `syncDispatchSideEffects()` (`dispatch-autocreate.service.js`) which the transport-request assign route calls — so the **integration assign path also pushes**.
- **VERIFIED end-to-end 2026-08-19:** inserted a test dispatch → outbox row `pending` + `Alert` notification enqueued → flush delivered (Expo ticket `ok`, id `01a0189b`) → outbox `sent` + `pushed_at` stamped. Test rows cleaned up.

**Build config:** `app.json` → `android.googleServicesFile = ./services/google-services.json` (package `com.fleet.mobile`). Expo prebuild auto-wires the Google services Gradle plugin — no manual `build.gradle` edits (that dir is generated/gitignored). `google-services.json` is untracked (contains Firebase config); keep it out of git.

**Two credentials required for Android real push:**
- `google-services.json` (client config) → lets the app mint an Expo push token. Gitignored; uploaded to EAS via `mobile/.easignore` (which otherwise mirrors `.gitignore`). eas-cli's "won't be uploaded" warning is a **false positive** when `.easignore` is used — proven by successful token minting.
- **FCM V1 service account** (Firebase → Service accounts → *Generate new private key* → `fleetops-d559a-firebase-adminsdk-….json`) → lets **Expo's** push server authenticate to FCM. Without it Expo returns `InvalidCredentials` / "Unable to retrieve the FCM server key". Uploaded via `eas credentials` → Android → Google Service Account → select the key (not the legacy "FCM API Key", which Google deprecates).

**Android channel fix (commit 175075b):** the "default" notification channel was only created inside `showLocalNotification`, so remote FCM pushes arrived "delivered" (receipt `ok`) but were **silently dropped** on Android 8+ when the channel didn't exist yet. `initPush()` (`mobile/lib/notifications/push.js`) now creates the channels + foreground handler at app startup (`mobile/app/_layout.js`) so backgrounded/killed delivery displays. **Two channels now:** `default` (HIGH, loud) for the push tier and `heads-up` (LOW, quiet) for the heads-up tier (commit 1704690).

**VERIFIED 2026-08-19:** test push returned Expo ticket `ok` + receipt `ok`; delivered as a real OS notification to a foregrounded dev build. Backgrounded/killed delivery covered by the channel-at-startup build.

**Remaining limits:** delivery is one-shot best-effort (outbox rows go straight to `error`, no retry loop); receipts not polled (only `DeviceNotRegistered` cleanup). iOS APNs needs a matching `google-services`-equivalent setup if the iOS build is ever pushed for real.

## Header dropdown behavior (2026-09-05)

`src/components/ui/notification-dropdown.jsx` shows the 5 most recent, **unread-first** (stable sort, read order preserved within each group). Read items stay visible but dimmed (`opacity-70`, full on hover) instead of vanishing — the unread badge is the read/unread signal, and keeping rows stable preserves traceability (re-click a just-read link) per the Gmail-style pattern.

Dedup is by `notification_id`, falling back to the content key only when an id is missing — content-key dedup was collapsing genuinely different notifications with identical text. Same fix in `src/app/(dashboard)/notifications/page.js`. Verified: eslint clean on both files; no unit tests cover this surface.

## The unused table

`notification_preferences` — **0 rows**. Per-user notification settings were designed and never wired. Everyone gets everything.

## Database tables used

`notifications` (164) · `notification_preferences` (**0**)

## Open questions

- Why triggers rather than service-layer calls? Undocumented. → [[ADR-005 Notifications In Database Triggers]]
- Is `notification_preferences` read anywhere? **TODO:** grep for it; if nothing reads it, it's dead schema.

## Related

[[Dispatch]] · [[Trips]] · [[Maintenance]] · [[Database Overview]] · [[Feature Index]]

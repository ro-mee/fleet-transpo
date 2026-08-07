# FleetOps Mobile App — Analysis, Feature Mapping & Implementation Plan

Status: DRAFT for approval. Scope: refactor the existing Expo mobile app to be a clean
Guest + Driver client that reuses the FleetOps web backend — no backend rebuild, no
duplicated business logic.

Key finding up front: the mobile app is **not a duplicate system**. It is a thin,
well-structured driver client. The work is **refactor + feature completion**, not
rebuild. The main risks are (a) duplicated domain constants (status machines, consent
version) and (b) several server-supported screens the app never uses.

---

## 1. Web-to-Mobile Feature Mapping

Source of truth: `src/app/api/**` (requireAuth role guards) + `src/lib/` business logic.

### 1.1 What stays WEB-ONLY (operational/admin)

| Web module | API prefix | Mobile? |
|---|---|---|
| Dispatch scheduling / kanban / calendar | `/api/dispatch*` | ❌ Web only |
| Vehicle / fleet management | `/api/vehicles*`, `/api/vehicle-categories*` | ❌ Web only (mobile = read own vehicle only) |
| Driver management | `/api/drivers*`, `/api/driver-assignments*` | ❌ Web only |
| Maintenance management | `/api/vehicle-maintenance*` | ❌ Web only (mobile = report breakdown) |
| Fuel approval workflow | `/api/fuel/[id]` (PUT approve/reject) | ❌ Web only (mobile = submit only) |
| Reports & analytics | `/api/reports/*`, `/api/analytics/*` | ❌ Web only |
| AI recommendation dashboard | `/api/ai/recommendations`, `/api/ai/predictive-maintenance` | ❌ Web only (mobile = read own driver insights) |
| Reservation queue / lifecycle verbs | `/api/integration/transport-requests*/...` | ❌ Web only (mobile = guest books/views own) |
| System console / audit | `/api/system/*`, `/api/audit` | ❌ Web only |
| User & role management | `/api/auth/register` | ❌ Web only |
| Settings (dispatch/hotel/uvvrp) | `/api/settings/*` | ❌ Web only |
| Number coding board | `/api/uvvrp*` | ❌ Web only (mobile = no access) |
| Routes / locations editing | `/api/routes*`, `/api/locations` | ❌ Web only (mobile reads derived origin/destination) |

### 1.2 What belongs to MOBILE

**Driver (core, most already implemented):**

| Feature | API (already exists) | Current mobile state |
|---|---|---|
| Login / refresh / logout | `/api/mobile/auth/login\|refresh\|logout` | ✅ done |
| Driver home / today's trips | `GET /api/mobile/driver/trips` | ✅ done |
| Accept / decline dispatch | `PUT /api/mobile/driver/trips/:id/accept` | ✅ done |
| Trip status advance | `PUT /api/trips/:id/status` | ✅ done (see logic risk) |
| Live GPS tracking | `POST /api/mobile/driver/trips/:id/gps` | ✅ done (foreground) |
| Fuel submission | `POST /api/mobile/fuel` | ✅ done |
| Privacy consent gate | `GET /api/driver/me`, `POST /api/driver/me/consent` | ✅ done |
| **Driver profile / my info** | `GET /api/driver/me` | ❌ missing (API ready) |
| **Trip history** | `GET /api/mobile/driver/trips?status=completed` | ❌ missing (API ready) |
| **Incident / emergency report** | `GET\|POST /api/driver/incidents` | ❌ missing (API ready) |
| **Vehicle inspection (start-of-shift)** | `GET\|POST /api/driver/vehicle-inspection` | ❌ missing (API ready) |
| **Notifications** | `GET /api/notifications` | ❌ missing (API ready; needs push later) |
| **Trip completion odometer** | `PUT /api/trips/:id/status` accepts odometer | ❌ missing (server accepts, app never sends) |
| **License / credential view + scan** | `GET/PATCH /api/driver/me`, `POST /api/driver/license-scan` | ❌ missing on mobile (web has it) |

**Guest (currently NOT implemented in mobile at all):**

| Feature | API | State |
|---|---|---|
| Guest login / registration | Mobile token flow is driver-only today | ❌ requires new backend work |
| Book a ride | Booking owns data; Fleet ingests via `/api/integration/*` | ❌ requires backend + Booking |
| Track active trip | `/api/trips/:id/locations` | ❌ requires backend guest identity |
| Booking status / history / rating | — | ❌ requires backend + new tables |

**Decision needed (Phase 10):** Guest mode requires **backend additions** (a `guests`
identity table, guest token flow, guest-scoped reservation APIs). That is a separate
workstream. This refactor ships **Driver** first (fully supported by existing APIs);
Guest is staged as Phase B with explicit backend changes.

---

## 2. Mobile Application Assessment

### 2.1 Strengths (keep)
- Thin transport layer — business logic lives server-side; app only renders.
- Clean auth: real JWT + SecureStore, single-flight refresh, session-expired handling.
- Good visual consistency with web design system (theme tokens, fonts).
- Consent gate correctly re-read on focus; policy text sourced from server.
- GPS tracking tolerant of transient drops.

### 2.2 Problems found

**Duplicated domain logic (highest priority):**
1. `getNextStatus()` in `app/(app)/index.js:407-415` re-implements the server's trip
   transition machine (`src/lib/scheduling/trip-state.js`) — simplified linear chain,
   misses `Cancelled`/`In Progress`/terminal handling.
2. `ACTIVE_STATUSES` in `index.js:36-42` duplicates server `STATUS_GROUPS`
   (`mobile/driver/trips/route.js:16-27`).
3. `CURRENT_PRIVACY_POLICY_VERSION = 1` in `lib/consent.js:14` duplicates
   `src/lib/consent/policies.js:8`.
4. `tripStatusTone()` in `lib/theme.js:127-149` hardcodes the DB trip-status enum.
5. `status: "Pending"` hardcoded in fuel payload (`fuel-report.js:105`) — server already
   forces `Pending`.

**Dead / unused code:**
- `lib/config.js` (`DEMO_ENABLED`) — unused; demo removed.
- `ACTIONS.READ_TRIPS` (`rbac.js:15`) — never checked.
- `setUser` in auth context — never consumed.
- `expo-linking`, `expo-constants` — declared, never imported.

**Missing screens (all server-supported):**
- Profile / my info; trip history; incident/emergency report; vehicle inspection;
  notifications; trip-completion odometer; license/credential view.

**Error handling / UX gaps:**
- No network timeout or retry/offline handling in `lib/api.js`.
- GPS denial has no "open Settings" deep-link / re-prompt.
- No offline banner; guard can silently loop if backend down.

**Incorrect workflows:**
- Status advance is a hardcoded 4-step chain; server owns transitions — should derive
  next-available steps from the server or a single shared source.
- Fuel always sends `status`, `vehicle_id`, `trip_id` that the server already derives.

---

## 3. Missing Mobile Features (ranked)

| # | Feature | API ready? | Backend change? |
|---|---|---|---|
| M1 | Driver profile (contact, license, consent status) | ✅ `/api/driver/me` | No |
| M2 | Trip history | ✅ `/api/mobile/driver/trips?status=completed` | No |
| M3 | Incident / emergency report | ✅ `/api/driver/incidents` | No |
| M4 | Start-of-shift vehicle inspection | ✅ `/api/driver/vehicle-inspection` | No |
| M5 | Trip completion odometer entry | ✅ `PUT /api/trips/:id/status` | No |
| M6 | Notifications feed (in-app) | ✅ `GET /api/notifications` | No (push = later) |
| M7 | License/credential view + scan | ✅ `GET/PATCH /api/driver/me`, `POST /api/driver/license-scan` | No |
| M8 | Single shared status/transition source | ⚠️ server change to expose | Optional: expose via API |
| G1 | Guest booking | ❌ | Yes (guests table, token, reservation APIs) |
| G2 | Guest live tracking | ❌ | Yes |
| G3 | Guest history / rating | ❌ | Yes |

---

## 4. Features That Remain Web-Only

Dispatch, vehicle/fleet management, driver management, maintenance, fuel approval,
reports/analytics, AI dashboards, reservation queue, system/audit, user & role
management, settings, number-coding board, route editing. (See §1.1.) These are excluded
from mobile navigation and are enforced by role guards server-side regardless.

---

## 5. API Integration Analysis

### Reusable now (no change)
- `POST /api/mobile/auth/*` (login/refresh/logout)
- `GET /api/mobile/driver/me`
- `GET /api/mobile/driver/trips` (+ `?status=completed`)
- `PUT /api/mobile/driver/trips/:id/accept`
- `POST /api/mobile/driver/trips/:id/gps`
- `POST /api/mobile/fuel`
- `GET /api/driver/me` (+ consent, license scans)
- `POST /api/driver/me/consent`
- `POST /api/driver/license-scan`
- `GET|POST /api/driver/incidents`
- `GET|POST /api/driver/vehicle-inspection`
- `GET /api/notifications` (+ read/read-all)

### Missing / needs backend
- Guest identity + token + booking + tracking (new workstream).

### Optimize (optional, low risk)
- Expose a single "driver reference data" endpoint (allowed statuses, next-available
  transitions, status tones) so mobile stops hardcoding domain constants. Recommended
  but not required for MVP.

---

## 6. UI/UX Redesign

Principles: thin client, consistent with web design tokens, mobile-first navigation,
clear status/action affordances.

- **Navigation:** introduce a bottom tab bar for Driver: **Home (trips)** · **History** ·
  **Profile**. Consent, fuel, incidents, inspections become stack screens. Remove flat
  `router.push` churn.
- **Trip cards:** show origin→destination rail, plate, scheduled time, current status
  pill, and a single **primary action** derived from the server's allowed transition.
- **Status indicators:** derive tone from a shared server-fed map, never hardcoded.
- **Loading/empty/error states:** standardize; add skeleton + offline banner + retry.
- **Reduce screens:** no separate dispatch/fleet screens (web-only).
- **Accessibility:** larger touch targets (already `TOUCH_TARGET`), semantic labels,
  color+text (not color-only) for status (already done).

---

## 7. Business Logic Review

**Rule: mobile must not compute availability/scheduling/AI/conflicts.** All already come
from the server. Current exceptions to fix:
- Replace client `getNextStatus()` + `ACTIVE_STATUSES` with data-driven transitions from
  the server (single shared source) — or at minimum align them and centralize in one
  mobile module.
- Remove hardcoded fuel `status`.
- Centralize status tones in one module driven by a server-provided map.
- Keep price-per-liter as a display calc only (or drop and let server return it).

---

## 8. Security Review

Current posture (good): Bearer JWT, SecureStore, server-side role enforcement
(`requireDriver`), token refresh single-use rotation, ownership guards, driver scope
never client-controlled. Gaps to close:
- Ensure **no secret** in `EXPO_PUBLIC_*` (already true — API URL only).
- Add **network timeout** and fail-soft offline so token/session handling never hangs.
- On GPS permission denial, provide **"Open Settings"** deep-link.
- Validate all mobile PATCH/POST payloads server-side (already true via zod + ownership).
- Keep consent version from server (don't trust client constant for gating).

---

## 9. Performance Review

- Add a **network timeout** (e.g. 15s) and basic retry with backoff in `lib/api.js`.
- **Cache** `/api/driver/me` and trip list (React Query or a light in-memory cache);
  stale-while-revalidate to reduce cold-start loads.
- **Reduce refetch churn:** home refetches on every focus; add dedupe/staleness.
- **GPS battery:** keep 30s interval; add idle/battery-aware batching (optional).
- **Lazy-load** heavy screens (fuel, incidents) with `expo-router` dynamic import.
- Push notifications deferred to Phase B (requires dev build + FCM/APNs).

---

## 10. Prioritized Implementation Roadmap

Convention: each item = Feature | Current State | Proposed | APIs | Backend changes |
Frontend changes | Risk | Dependencies | Effort.

### Phase 1 — Stabilize & align (no new screens)
1. **Fix boot/login white screen** | app may white-screen on cold start / after login |
   ensure boot path renders, error boundary surfaces real errors, remove dead
   `GlobalErrorHandler` web-only listener gap | `/api/mobile/auth/*` | none | `app/_layout.js`,
   `lib/api.js`, `lib/auth.js` | High (blocking) | none | S
2. **Remove dead code** | `config.js`, `READ_TRIPS`, unused `setUser`, unused deps |
   delete | none | none | `lib/`, `lib/rbac.js`, `lib/auth.js`, `package.json` | Low | none | S
3. **Centralize domain constants** | statuses/tones duplicated | single shared mobile
   module (or server-fed) | optional `GET /api/mobile/driver/ref` | optional | `lib/constants.js`,
   `lib/theme.js`, `index.js` | Medium | none | M
4. **Network timeout + retry + offline banner** | no timeout/retry | add timeout, backoff,
   offline state | none | none | `lib/api.js`, guard layouts | Medium | none | M

### Phase 2 — Driver feature completion (APIs already ready)
5. **Profile screen** | missing | `/profile`: contact, license/expiry, consent status,
   edit phone | `GET/PATCH /api/driver/me` | none | new screen + tab | Low | Phase 1 | M
6. **Trip history** | missing | `/history` from `?status=completed` | `GET
   /api/mobile/driver/trips` | none | new screen + tab | Low | Phase 1 | S
7. **Trip completion odometer** | missing | prompt for end odometer on Complete |
   `PUT /api/trips/:id/status` | none | `index.js` flow | Low | Phase 1 | S
8. **Incident / emergency report** | missing | `/incident`: type, desc, location |
   `GET|POST /api/driver/incidents` | none | new screen | Low | Phase 1 | M
9. **Start-of-shift vehicle inspection** | missing | `/inspection` checklist |
   `GET|POST /api/driver/vehicle-inspection` | none | new screen | Low | Phase 1 | M
10. **License / credential view + scan** | missing on mobile | view scans, re-scan via
    `POST /api/driver/license-scan` | existing | none | new screen | Medium | Phase 1 | M
11. **Notifications feed** | missing | in-app feed + mark read | `GET
    /api/notifications` | none (push deferred) | new screen | Low | Phase 1 | M

### Phase 3 — Navigation & polish
12. **Bottom-tab navigation** | flat stack | tab bar: Home · History · Profile; stack for
    flows | none | none | app/(app) restructure | Medium | Phase 2 | M
13. **Loading/empty/error/offline polish** | inconsistent | standardized components |
    none | none | components/ | Low | Phase 1-2 | M

### Phase B — Guest (separate workstream, backend changes required)
14. Guest identity + token + booking + tracking + history/rating | not present |
    new | new backend APIs + tables | **Yes (backend)** | new screens | High | Product
    decision | L

---

## Approval gate

Phase 1 (stabilize) and Phase 2 (driver features) require **no backend changes** and are
safe to implement against the existing live DB. Guest (Phase B) requires backend work and
should be its own approved workstream.

**Recommendation:** approve Phase 1 + Phase 2 (driver refactor) now; defer Guest (Phase B)
to a separate plan with explicit backend scope.

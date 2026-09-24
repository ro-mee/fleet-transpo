---
type: moc
title: Decision Log
tags: [moc, decisions, adr]
source:
  - supabase/migrations
  - src/lib
last_verified: 2026-08-11
---

# Decision Log

	Architectural decisions **reconstructed from repository evidence**. Where the repo states a reason, it's quoted. Where it doesn't, the note says so — no reasoning is invented.

## The ADRs

| ADR | Decision | Evidence quality |
|---|---|---|
| [[ADR-001 Single Organization]] | No branch scoping | ✅ Stated in `contracts.js` + migration 013 |
| [[ADR-002 Anti-Corruption Layer]] | Translate at the Booking boundary | ✅ Extensively documented in code |
| [[ADR-003 Deterministic AI]] | AI advises, never decides | ✅ Explicit docstring |
| [[ADR-004 Dual Database Access]] | Supabase client **and** raw `pg` | ⚠ Partial — `withTransaction` explained, coexistence not |
| [[ADR-005 Notifications In Database Triggers]] | Notifications in plpgsql | ❌ **Undocumented** |
| [[ADR-006 Dual Double-Booking Guard]] | App check + DB trigger | ✅ Migration 023 explains itself |
| [[ADR-007 Single Writer For Reservation Status]] | One function writes status | ⚠ Implied by structure, not stated |
| [[ADR-008 Manual Migration Procedure]] | Hand-written `pg` scripts | 🔄 **Superseded 2026-08-11** — replaced by `npm run db:up` + a `schema_migrations` ledger. The stated reason in `AGENTS.md` was **false**; the underlying reason was not, and still applies. |
| [[ADR-009 Separate Mobile Auth]] | Mobile JWT ≠ web session | ⚠ Mechanism documented, choice not |
| [[ADR-010 Foreground Only GPS]] | No background location | ✅ Stated in `tracking.js` — 🔄 **Superseded 2026-08-19** by [[ADR-011 Background GPS Tracking]] |
| [[ADR-011 Background GPS Tracking]] | Foreground + headless background task (AppState-driven) | ✅ Decision recorded 2026-08-19 |
| [[ADR-013 Calendar Is The Dispatch Surface]] | Status-lane board removed; `/dispatch` redirects to calendar | ✅ Stated in code + workspaces, 2026-09-23 |
| [[ADR-014 Incident Abort Requeues Request]] | In Progress abort → Scheduled requeue, not Cancelled | ✅ Stated in `grounding.js` + `reservation-state.js`, 2026-09-23 |
| [[ADR-015 Address Owns Administration, Location Owns The Point]] | Structured address owns administrative data; location coordinates own the operational point | ✅ Stated in `structured.js` + the geofence schema, 2026-09-24 |

## 2026-09-07 — Notification routing separated from authorization

**Decision:** `rolesFor()` answers "who MAY" (and keeps its system_admin bypass);
`notificationRolesFor()` in `src/lib/notifications/recipients.js` answers "who
NEEDS to know" (system_admin silent on routine ops, management informational
only). Per-user inbox unchanged; no shared role inboxes. Consequences locked
the same day: stranded-guest pages go to dispatcher/fleet_manager/admin (legacy
role-name fix); first arrival at Assigned emits "Transport Assigned" (replaces
the dead `reservation_approved` key, migration 107 moved 8 live preference
rows); suspended/reinstated drivers are told alongside staff. Evidence:
`Capstone/02 - Features/Notifications.md` (audit matrix + implementation).

## 2026-09-18 — Web session idle timeout: 1 hour → 5 minutes, strictly enforced

**Decision:** the dashboard idle timeout is **5 minutes**, and `last_seen_at` may
be written **only** by `POST /api/auth/heartbeat`, which the client gates on real
DOM activity. The 12-hour absolute cap is unchanged and still never extended.

**Why now:** the 1-hour timeout was not being enforced at all. `resolveCurrentIdentity()`
slid `last_seen_at` on any authenticated request older than 5 minutes, and every
dashboard page polls continuously (30s sidebar counts, 15–30s live map, 10s dispatch
plan; two queries with `refetchIntervalInBackground: true`), so an untouched browser
kept its own session alive indefinitely. The real exposure was the 12-hour cap.
Shortening the number without fixing that would have changed nothing.

**Rejected alternatives:**

| Option | Why not |
|---|---|
| 30 min / 15 min idle | Offered as the middle ground. Rejected in favour of the tighter window; either is a one-constant change plus the migration default if this proves too aggressive. |
| Keep the auto-slide, gate it on an explicit client activity signal | Reliably distinguishing polled from user-initiated requests server-side is fragile, and the auto-slide is precisely the mechanism that defeated the control. |
| Slide on non-GET requests as a safety net | Near-free backstop (polling is almost always GET, user actions are POST/PATCH/DELETE) but leaves an hour of read-only work counting as idle — a weaker guarantee for a marginal availability gain. Chosen against deliberately; revisit if heartbeat failures prove common in the field. |
| Backfill live rows to 300 in migration 113 | Would instantly idle-expire every session older than 5 minutes at deploy — a mass logout presenting as an outage. Existing rows keep their recorded window and roll off within 12 hours. |

**Accepted cost:** a dispatcher on a live map or a manager on a long form can lose
unsaved state; `saveReturnTo()` preserves the route, not the form. Mitigated by a
60-second warning, an immediate slide on activity, and focus landing on "Stay signed in".

**Evidence:** `Capstone/04 - Architecture/Authentication.md` §"The idle timeout that
wasn't", `Capstone/01 - System/Security Audit.md`, `src/lib/auth/session-policy.js`,
migration `113_session_idle_timeout_5min.sql`.

## 2026-09-22 — TOTP MFA replaced by mandatory email OTP

**Decision:** the second factor is a 6-digit code emailed to `employees.email`.
Mandatory for every account **including `driver`**, on web and mobile; TOTP removed
entirely; `employee_mfa` left in place but unread. Trusted web devices shortened from
30 days to 7. Break-glass is recovery codes plus admin-issued emergency codes, with
**no environment-gated bypass**.

**This is a deliberate downgrade and is recorded as one.** TOTP's secret lives on the
user's own device and needs no third party; email OTP collapses both factors onto one
inbox and makes Gmail SMTP a hard dependency of every login, with no graceful
degradation. The stated reason is demonstrability — it demos without a phone. The
cost was accepted knowingly rather than argued away. **The honest description of the
resulting posture is "MFA at first login per device, per week"**, not "MFA on every
login", because the 7-day trusted-device window is real and the docs say so.

**Why the alternative was rejected.** Keeping TOTP and adding email OTP as a fallback
was the obvious middle path. It was rejected because it doubles the surface (two
factors to test, two ways to be locked out, two sets of recovery paths) to buy a
property — device independence — that the 7-day trusted device already provides in
practice. A bypass gated on an environment variable was rejected outright: it is a
second, quieter door into the same room, and it is the one that gets left open.

**Consequences taken on purpose:**

- Gmail SMTP becomes a single point of failure for *all* authentication, not just
  password reset. The gate fails closed when it is unreachable, so an SMTP outage is a
  total login outage — an honest failure rather than a silent one.
- An address that is routable but belongs to a stranger fails **silently**: the code is
  delivered, just not to the right person. No code can detect this. It is why
  `scripts/audit-otp-inbox-ownership.mjs` exists as an out-of-band gate, and why the
  login modal shows the masked address with its domain intact.
- Precondition, not follow-up: **21 of 35 live accounts could not receive mail**,
  including the only `super_admin`. Three addresses were corrected before the factor
  changed. The 17 leaked test-fixture accounts and 19 no-role accounts remain
  unreachable — see [[Bugs]].
- The out-of-band gate reports **UNKNOWN, never zero**, when `.env.local` is absent
  (2026-09-23). Its `OWNED` set is built from `OTP_FIX_*` keys, so an unloaded env and
  "no address is ours" produced byte-identical output — a false negative raised on the
  exact question the gate exists to answer, and one that reads as a finding rather than a
  gap. Same rule `AGENTS.md` applies to the anon-key probe's `200 []`: absence of evidence
  is not a verdict.

**Evidence:** `src/lib/auth/email-otp.js`, `src/lib/auth/otp-policy.js`,
migration `119_email_otp_challenges.sql`,
`Capstone/04 - Architecture/Authentication.md` §"Email OTP as the second factor",
`Capstone/01 - System/Security Audit.md` §"Email OTP replaced TOTP".

## 2026-09-22 — Unfamiliar sign-ins are detected by device, not by location

**Decision:** notify an account owner when their account is used from a device it
has never been used from. Detect it on **device identity**, and build **no
location signal at all**.

Asked whether a sign-in from "another location" would be noticed, the honest answer
was that *nothing at all* was raised for a login — the only alerts were
`account_locked`, `token_replay` and `emergency_code_issued`. The gap that matters
is not the ordinary attacker, who mandatory email OTP already stops at the code, but
the **7-day trusted-device bypass**: a remembered browser skips the OTP entirely, so
a stolen cookie would otherwise pass with nothing said.

**Why device and not location.** IP geolocation maps *IP ranges to the ISP's
registered place*, not to a user's position. The question that prompted this was
Manila vs Makati — about 10 km apart, in the same country, served by the same
providers, which is far inside the error margin of the data. A city rule would
therefore be wrong **in both directions**: it would fire on the legitimate owner
(their IP resolving to a neighbouring city) and stay silent for an attacker in the
same metro. Building it would have produced a control that looks like coverage and
provides none. Location only becomes meaningful at country scale; a country signal
was offered and **declined** for scope, so there is no location detection in the
system, by choice rather than omission.

**What was chosen instead:** compare `sessionDeviceLabel(userAgent)` — browser family
+ OS, version deliberately dropped — against the employee's `login_success` history
over 90 days. Version-dropping is what makes it usable: comparing raw user-agent
strings would flag every browser auto-update, and comparing raw IPs would flag every
carrier IP rotation, which for a driver on mobile data is every single login.

**Consequences taken on purpose:**

- **Mobile coverage is weak, and the code says so.** `sessionDeviceLabel` returns the
  constant `"FleetOps Driver app"` for the mobile channel, so all driver sign-ins
  share one label. A driver is notified at most once, on their first mobile sign-in.
  Treat this as a **web-strength control**. Closing it needs the app to send a device
  model/id — a follow-up, not an oversight.
- **The remaining hole is stated rather than hidden:** an attacker presenting the same
  browser family and OS as the owner is not detected, and if they replay a stolen
  trusted-device cookie they bypass the OTP too. Strictly smaller than the previous
  state, where nothing fired at all.
- **`new_sign_in` delivers email, and it is the only event that does** (revised
  2026-09-22 after the initial `email: false`). The first cut defaulted email off on the
  grounds that no code delivers that channel. That was accurate but it left the alert
  reachable only inside the app — useless for the case it exists for, an owner who is not
  in the app while someone else uses their account. So the channel was wired for this
  event instead of being declared off: `sendNewSignInAlertEmail` reuses the OTP transport,
  and the default flipped to `true` so the toggle is honest. The consequence is a
  **deliberate asymmetry** — the Email toggle now means something on one row of twelve and
  remains inert on the other eleven ([[Bugs]] BUG-NOTIF-001). Resolving the rest is still
  a decision, not a patch, but it now has a worked example to copy. Verified by sending a
  real alert through the producer to the admin inbox: Gmail answered `250 2.0.0 OK`,
  `accepted` the recipient, and the matching `notifications` and `push_outbox` rows were
  written (`push_outbox.status = 'error'`, because that account has no `device_tokens`).
- **No migration was needed** — `notifications`, `push_outbox` and `audit_logs`
  already existed, and `security_alert` is an `audit_logs` row rather than its own
  table, so no type constraint had to be widened.

**Evidence:** `src/lib/auth/new-device-alert.js`, call sites in `src/lib/auth.js` and
`src/app/api/mobile/auth/login/route.js`, `NOTIFICATION_EVENTS.new_sign_in`
(`src/lib/constants.js`), `STAFF_ROUTES.security` (`src/lib/notifications/target.js`),
`Capstone/04 - Architecture/Authentication.md` §"New-device sign-in notice".

## 2026-09-23 — Temp password emailed at creation, not a one-time setup link

**Decision:** when an admin creates a staff account, the server generates a
strong temporary password (7-day expiry) and emails it. The employee signs in
with it — plus the normal email OTP — and is forced to choose their own before
the dashboard opens. **No magic setup link.** (Reverses the earlier leaning
toward a link-style first-run flow.)

**Rejected alternatives:**

| Option | Why not |
|---|---|
| One-time setup link (forgot-password style) | No magic-link infrastructure exists beyond the reset token, and reusing it for first-run setup blurs "set up" with "I lost my password". Email OTP already trains users to expect two emails per login; a third channel (link + OTP + temp password) adds confusion for no security gain. |
| Admin sets the password out-of-band (verbal/DM) | The credential would transit an unauthenticated channel and sit in chat history; audit cannot cover "typed somewhere else", and the whole point of the flow is that only the employee ever sees it. |
| No password until first login (SSO-style defer) | There is no IdP; the credential store is `employees.password_hash` and every gate reads it. |

**Consequences taken on purpose:**

- Account creation now **fails closed on email delivery**: no SMTP configured or
  an undeliverable address means **no row** (precheck 400 before INSERT; a send
  failure after INSERT is compensated with a DELETE + `invite_email_failed`
  audit + 502). Availability of email is a precondition of creating accounts.
- Admins get a visible pending state (`Password not set · expires …` in the
  users list) with a **Resend invite** action; resend rotates the credential in
  a transaction and only then emails (failure → 502, press again — the fresh
  password is unknown to everyone, unlike create where the row must not survive).
- Audit `create` / `invite_resend` rows and log lines never carry the password
  or its hash; the email subject never carries the password value.

**Evidence:** `src/lib/auth/temp-password.js`, `src/app/api/auth/register/route.js`,
`src/app/api/settings/users/[id]/resend-invite/route.js`, migration
`120_temp_password_invite.sql`, `Capstone/04 - Architecture/Authentication.md`
§"Temporary password invitations".

## 2026-09-23 — Forced password change rotates the session and stays signed in

**Decision:** the first-sign-in forced change (`mustChangePassword`) returns a
**fresh session cookie on the success response** — *rotate-and-stay*. The user
lands on `/dashboard` without logging in a second time. Voluntary password
changes in Settings keep their existing `signInRequired: true` (sign out)
behavior, unchanged.

**Why:** the forced path is a setup step, not a security response — the user
just proved the temp credential minutes ago. Forcing a second login would make
the required screen feel like being logged out mid-task. The revocation that
matters still happens: the transaction bumps `auth_version`, revokes every old
session, deletes pending reset tokens, and only *then* mints the replacement
(`mintRotatedSession` inserts the new `web_sessions` row **after** commit, so it
survives its own revoke). The temp credential's session is dead either way —
there is no security delta versus sign-out-and-back-in.

**Rejected alternative:** complete the change, then sign out and re-login.
Simpler (no cookie minting in the route) but punishes the user for complying,
and buys nothing security-wise given the revocation above already ran.

**Consequences:** the change-password route now has two honest response shapes —
forced → 200 + `Set-Cookie` + `{ mustChangePassword: false }`; voluntary → 200 +
`{ signInRequired: true }`. The rotated cookie carries `mustChangePassword:
false`, which is also what unblocks the server gate and the layout redirect on
the next request.

**Evidence:** `src/lib/auth/session-rotation.js`,
`src/app/api/auth/change-password/route.js`,
`Capstone/04 - Architecture/Authentication.md` §"Temporary password invitations".

## What the pattern shows — INFERRED

**Six of eleven decisions are well-evidenced; the rest are not.** And the well-evidenced ones are documented *in the code that implements them* — docstrings and migration headers — never in `docs/`.

The rule this suggests: **write the "why" where the "what" lives.** A reason recorded next to its implementation survives; a reason recorded in a separate file rots. → [[Documentation Rot]]

Phase 3 supplied a clean confirmation. Migration `036_drop_vehiclereservations.sql`
carries its reasoning in its header, so the deletion explains itself at the point
of the change. The four ERDs that described the same schema carried none, had
drifted, and were deleted rather than redrawn — `schema.sql` is regenerated from
live by `npm run db:dump`, so it cannot rot silently.

## Decisions I could not reconstruct

These are real choices with no recoverable reasoning. Recording them as open questions is more useful than guessing:

1. Why do `transportation_requests` and `vehiclereservations` both exist? — **still unreconstructed, and now unreconstructable from the schema:** the table was dropped in migration 036 on 2026-08-11 rather than explained. The repository does not document why the old one was kept for twenty-two migrations. → [[DEBT vehiclereservations vs transportation_requests]]
2. Why is RLS enabled at all if it's inert? → [[Why RLS Is Not A Boundary]]
3. Why are notifications database triggers? → [[ADR-005 Notifications In Database Triggers]]
4. ~~Why is `substitute_vehicle_schedules` in the schema with **1 row** and zero references?~~ — **ANSWERED 2026-08-19:** it is substitute-driver coverage (migration 040 + API + card shipped it); now managed by the `/fleet/assignments` module. → [[Assignments]]

→ [[Open Questions]]

## Related

[[Home]] · [[Architecture]] · [[Learning Dashboard]] · [[Open Questions]] · [[Technical Debt]]

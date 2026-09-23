# Design: Temp-Password Invite for Staff Account Creation

**Date:** 2026-09-23
**Status:** Approved (design), not yet implemented
**Scope:** Staff Add User flow only (`settings/users/new` → `POST /api/auth/register`)

## Goal

When an admin creates a staff account, they enter **email + first name + last name + role** — no password. The system generates a strong temporary password, emails it to the employee, and the employee **must change it at first sign-in** before they can use the app. The temporary credential expires after **7 days**; after that the admin must resend.

## Decisions (with rationale)

| # | Decision | Notes |
|---|---|---|
| 1 | **Temp password + forced change** (not a one-time setup link) | The setup-link variant was considered and declined: the user wants a system-generated credential in the inbox and an explicit forced change at first login. |
| 2 | **Form collects email + first/last name + role; no password field** | `employees` needs name and `role_id` for RBAC/audit; only the password disappears from the admin's hands. |
| 3 | **Fail closed on email failure** | If SMTP is unconfigured or the send fails, no usable account survives. Matches the email-OTP fail-closed philosophy. |
| 4 | **Temp password valid 7 days, then resend** | Not 30 minutes (too short for invites), not forever (a leaked inbox credential would never die). |
| 5 | **Staff Add User page only** | Driver creation (Drivers Directory, mobile/consent setup) is explicitly out of scope. |
| 6 | **Approach A: two columns on `employees`** | Rejected: separate `account_invites` table (full RLS/REVOKE/schema-contract ceremony for the same UX) and change-before-session (new endpoint + new login wire-state). |
| 7 | **Forced change = rotate-and-stay** | After the forced change the current browser receives a **brand-new session** in the change response (rotation); all other sessions die via the existing `auth_version` bump. No second login, no second OTP. Voluntary Settings changes keep today's `signInRequired: true` sign-out behavior. |

## End-to-end flow

### 1. Invite (admin)

1. Admin submits the Add User form (`requirePermission("accounts","create")`, `canAssignRole`, role validation, 409-on-duplicate — all unchanged).
2. **Precheck:** `!isEmailConfigured()` → **400 before any insert**, honest message ("Email delivery is not configured — accounts cannot be created right now."). No row written.
3. Generate temp password: `crypto`-based, must pass the shared `isPassword` policy (8+, upper/lowercase, number, special, ≤72 UTF-8 bytes) — generator gets its own unit tests pinning parity with `isPassword`.
4. `INSERT employees` with bcrypt hash (cost 10), `must_change_password = true`, `temp_credential_expires_at = NOW() + INTERVAL '7 days'`.
5. Send `sendTempPasswordEmail(...)` (new template in `src/lib/email/smtp.js`, HTML **and** plain-text parts).
6. **Send success** → existing `create` audit row (password never in `newValues`) → 201.
   **Send throws** → compensating `DELETE` of the just-inserted row + audit `invite_email_failed` + honest 5xx to the admin. If that DELETE itself fails, the orphaned pending row is a *safe* degradation: nobody knows its password, it expires in 7 days, and it appears in the users list as "Password not set" where an admin can resend.

### 2. First login (invitee)

- Temp password → existing bcrypt compare → **existing mandatory email OTP** → session issued.
- **Expiry gate inside `authorize()` (web):** `must_change_password && temp_credential_expires_at <= NOW()` → rejected with a specific message: *"This temporary password has expired. Ask your administrator to resend."* (Consistent with the existing lockout-honesty pattern, not a generic "invalid credentials".)
- **Mobile:** not applicable — `POST /api/mobile/auth/login` is driver-only (`route.js` rejects `role_name !== "driver"` with 403), and this flow excludes drivers. **No mobile change.**
- Session JWT carries `mustChangePassword` **for UI redirect only**.

### 3. Forced change gate

- **Server-side enforcement is the control.** In `resolveIdentity`/`requireAuth` (`src/lib/api/utils.js`): if the **live** employee row has `must_change_password = true` and the request is not on the allowlist → **403 `{ code: "PASSWORD_CHANGE_REQUIRED" }`**. Allowlist (minimum): `POST /api/auth/change-password`, logout, session introspection/heartbeat needed to render the change screen. Live-row read (already paid for by the existing role lookup) — the claim cannot be the authority.
- **Client:** session claim → hard redirect to the new `/set-password` screen. No skip, no dashboard chrome.

### 4. Forced change (rotate-and-stay)

`POST /api/auth/change-password`, new mode when the live row has `must_change_password = true`:

- **`currentPassword` is not required in this mode** (the temp password was proven at login seconds earlier; the session itself is the step-up). Voluntary mode unchanged — still requires current password and still returns `signInRequired: true`.
- One transaction: set `password_hash` (new, policy-valid), `must_change_password = false`, `temp_credential_expires_at = NULL`, increment `auth_version`, run the **existing revocation path** (all `web_sessions`, `mobile_refresh_tokens`, reset tokens, trusted devices).
- Still inside the same request: mint a **fresh** web session row + encode a new NextAuth JWT (`next-auth/jwt` `encode`, correct cookie name incl. `__Secure-` prefix, matching maxAge/flags) and `Set-Cookie` it on the change response. Cookie carries `mustChangePassword: false`.
- Result for the invitee: **login (temp) → change screen → dashboard.** One login total. Security invariant preserved: every *other* session/device is dead; the surviving credential is a rotated session created after proving temp password + OTP + intentional change.
- Response shape: forced mode returns success **without** `signInRequired: true` (cookie already rotated); voluntary mode untouched.

### 5. Resend (7-day expiry)

- New route **`POST /api/settings/users/[id]/resend-invite`**, `requirePermission("accounts","create")`; must pass `verify:auth`.
- Guards: employee must currently have `must_change_password = true` → else 400 ("already has a password set").
- Transaction: generate new temp password → update `password_hash`, `temp_credential_expires_at = NOW() + 7 days`, **bump `auth_version` + revoke sessions** (kills any session issued on the old temp password, e.g. an abandoned forced-change screen) → then email.
- **Resend email failure (asymmetric with create, deliberately):** the row cannot be deleted and the old hash was not kept, so the account temporarily holds a password *nobody* knows — safe (flag still set, login impossible until a successful resend). Admin gets an honest 5xx: "Temporary password could not be emailed — try Resend again." Each retry regenerates; success clears the dead state.
- Audit every resend.

## Data model

New migration (`supabase/migrations/NNN_temp_password_invite.sql`, number chosen via `npm run db:status` — never by listing files; idempotent):

```sql
ALTER TABLE employees ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS temp_credential_expires_at timestamptz;
```

- Existing rows: flag `false`, expiry `NULL` — zero behavioral change for current accounts.
- **No new tables/views** → no RLS/REVOKE migration, no `schema-contract.mjs` registration, `verify:anon`/`db:contract` expected unchanged (verify anyway after `db:dump`).

## Files touched (expected)

| Area | Files |
|---|---|
| Migration | `supabase/migrations/NNN_temp_password_invite.sql`, regenerated `schema.sql` |
| Register route | `src/app/api/auth/register/route.js` (precheck, temp generation, send, compensating delete) |
| Validation | `src/lib/validation/schemas.js` (`createUserSchema` drops `password`), `schemas.test.js` (password-parity tests move to the generator tests) |
| Login gate | `src/lib/auth.js` `authorize()` (expiry check, `mustChangePassword` claim); mobile route **not touched** (driver-only) |
| Route gate | `src/lib/api/utils.js` (`resolveIdentity`/`requireAuth` → 403 allowlist) |
| Change route | `src/app/api/auth/change-password/route.js` (forced mode + session rotation) |
| Email | `src/lib/email/smtp.js` (`sendTempPasswordEmail` + text/html builders) |
| New page | `src/app/set-password/page.js` — **outside** the `(dashboard)` route group (only a root layout exists; chrome is per-page), standalone like the `(auth)` recovery pages |
| Add User UI | `src/app/(dashboard)/settings/users/new/page.js` |
| Users list | badge "Password not set" + expiry + Resend button + confirm dialog |
| Service | `src/services/auth.service.js` (resend call; change call if response shape branches) |
| Harness | `scripts/verify-register-account.mjs` + `src/security-assessment/config-secrets.security.test.js` (`harness-adduser-probe@…`) — register payload changes; update to the new contract |
| Recovery codes | Verify whether account creation currently issues recovery codes (`Authentication.md` says "issued at account creation"); preserve whatever side effects the register path actually has today |

## Error matrix

| Failure | Response |
|---|---|
| SMTP unconfigured | 400 pre-insert, no row |
| Email send throws (create) | compensating DELETE + audit `invite_email_failed` + 5xx |
| Email send throws (resend) | row stays (nobody knows password) + 5xx "try Resend again" |
| Duplicate email | existing 409 |
| Expired temp password at login | rejected, explicit expiry message |
| `must_change` session → other API | 403 `PASSWORD_CHANGE_REQUIRED` |
| Resend to non-pending account | 400 |
| Privileged role grant | existing confirm dialog + audit — unchanged |

## Security invariants

- No new **public** endpoints; only permission-gated register/resend and the existing change route. `npm run verify:auth` must stay green.
- Temp password never appears in audit `newValues`, logs, or the email subject line (subject may say "Your FleetOps temporary password"; the value stays in the body, HTML + text).
- Server-side 403 gate is authoritative; the session claim is only a client redirect hint (client decoding is not security).
- Session rotation on forced change preserves the spirit of "password change revokes sessions": everything else dies; the current browser gets a new ID, not a kept-alive one.
- Voluntary change path behavior is untouched.

## Email content (`sendTempPasswordEmail`)

- Greeting by first name; the temp password rendered prominently; **"expires in 7 days"**; three-step instruction (sign in → you will be asked to change it immediately → done); "If you didn't expect this, contact your administrator"; do-not-reply footer.
- `FleetOps <address>` display-name From; multipart HTML + plain text (HTML-only is a spam signal — documented deliverability lesson in `Authentication.md`).
- Known Gmail-to-Spam caveat applies unchanged; demo mitigation remains the recipient-side filter setup.
- Two emails arrive on day one by design: the temp-password invite, then the mandatory login OTP. The invite's copy should say so ("you'll also receive a login verification code").

## UI copy

- **Add User credentials card:** "A temporary password will be generated and emailed. The employee must change it on first sign-in." Plus a 3-step info callout (invited → first login → forced change).
- **Success toast:** "Account created — temporary password sent to {email}" — truthful because success implies a successful send (fail-closed).
- **`/set-password` screen:** "Set your permanent password" — new password + confirm only, four-row policy checklist + strength indicator reused from `reset-password/page.js`, no skip/back while flagged.
- **Users list:** `Password not set` badge + expiry date + Resend (confirm dialog: "Generate a new temporary password and email it? The old one stops working immediately.").

## Testing & verification

1. **Unit:** temp generator passes `isPassword` (adversarial corpus, ≤72-byte edge); expiry boundary (6d23h59m active, 7d dead).
2. **Route:** happy path (row + flag + expiry + mocked email), SMTP-off → 400 with zero rows, send-throws → row deleted, 409 duplicate, role-assignment guards unchanged.
3. **Gate:** flagged session → 403 on a normal route **and** success on change route; after forced change → flag cleared, **old cookie dead, rotated cookie live**, other-device sessions dead (`auth_version`), no `signInRequired` in forced response; voluntary response still `signInRequired: true`.
4. **Resend:** regenerates (old password dead), extends 7 days, bumps `auth_version`, 400 on non-pending, email-failure → 5xx with row intact.
5. **Gates:** `npm test`, lint on touched files, `verify:auth`, `db:status` → `db:up` → `db:dump` (commit the `schema.sql` diff as review artifact — *when commits are requested*), `verify:anon`, `db:contract`.
6. **Manual E2E:** create → inbox/Spam → login (temp + OTP) → forced change → dashboard without a second OTP; expired-token login shows the resend message.

## Out of scope

- Driver account creation (Drivers Directory).
- Self-service registration (none exists; none added).
- Changing mandatory email OTP, lockout, or voluntary Settings change-password behavior.
- Email provider changes (Gmail SMTP stays as-is).

## Documentation updates (on implementation)

- `Capstone/04 - Architecture/Authentication.md` — new §"Staff account invite (temp password + forced change)" + rotate-and-stay.
- `Capstone/03 - Database/Tables/employees.md` — two new columns.
- `Capstone/06 - Decisions/Decision Log.md` — (a) temp password over setup link (reversal of the initial pick), (b) rotate-and-stay over double login.
- `Capstone/01 - System/System.md` — changelog line.

# Implementation Plan — Temp-Password Invite (Add User)

**Spec:** `docs/superpowers/specs/2026-09-23-temp-password-invite-design.md` (source of truth)
**Date:** 2026-09-23
**Status:** approved, ready to execute

## Goal

Admin adds a user with only email + first/last name + role. The server generates a
strong temporary password (valid 7 days), emails it, and the employee must change it
at first sign-in. The forced change **rotates the session and stays signed in**
(`rotate-and-stay`) — no second login.

## Global constraints

- **DO NOT COMMIT.** User instruction: *"yes yes and dont commit"*. Leave all changes
  uncommitted in the working tree. Do not `git add`, `git commit`, or push anywhere.
- **Fail closed:** no account row survives an unsent invite email (compensating DELETE).
- Temp passwords satisfy `isPassword` (`src/lib/validation/index.js`), ≤72 bytes,
  random via `node:crypto.randomInt`.
- Rotate-and-stay for the forced path; **voluntary Settings password change keeps its
  existing `signInRequired: true` behavior unchanged**.
- Server gate is authoritative (`403 PASSWORD_CHANGE_REQUIRED`); the frontend claim is
  a UX hint only.
- Passwords/temp passwords never appear in audit `newValues`, logs, or email subjects.
- Staff Add User only. Drivers/Drivers Directory and all mobile auth are out of scope
  (mobile login is driver-only → no mobile changes).
- Migration must be idempotent. Confirm the next free version with `npm run db:status`
  immediately before creating the file — expected **`120`** (never trust disk `ls`;
  the ledger records spent versions whose files are gone).
- `schema.sql` is generated — apply via `npm run db:up`, then `npm run db:dump`.
  Never hand-edit it. Never put credentials in scripts.
- Per `AGENTS.md`: read the relevant guide in `node_modules/next/dist/docs/` before
  writing Next-specific code (route-handler `params` sync-vs-Promise, middleware), and
  heed deprecation notices.
- New/changed route handlers must pass `npm run verify:auth`. Mutating handlers must
  NOT use bare `requireAuth(req)` (verify-route-auth line 134 fails them) — use
  `requirePermission(req, "accounts", "create")` where noted.
- After behavior/architecture changes: update `Capstone/` notes + `System.md`.

## Architecture summary

```
Add User form (email, name, role)
  → POST /api/auth/register  [accounts:create]
      validate → role checks → dup 409 → deliverability precheck (fail closed 400)
      → generateTempPassword → bcrypt(10) → INSERT (must_change_password=true, expiry)
      → sendTempPasswordEmail → 201 | on send fail: DELETE + audit invite_email_failed + 502
  → login: authorize() rejects expired temp (TEMP_PASSWORD_EXPIRED), returns mustChangePassword
  → session claim mustChangePassword=true
      → server gate: resolveIdentity 403 PASSWORD_CHANGE_REQUIRED (allowlist: change-password, profile, heartbeat)
      → UI: DashboardLayout forces /set-password
  → POST /api/auth/change-password (forced: no currentPassword; tx bumps auth_version,
      revokes all sessions, clears flags, then mints a NEW NextAuth cookie in the response)
  → mustChangePassword=false → /dashboard
Admin Resend: POST /api/settings/users/[id]/resend-invite → new hash+expiry, revoke, re-email
```

## Task 1 — Migration: employee invite columns

**Files**
- Create: `supabase/migrations/120_temp_password_invite.sql` (confirm number first)

**Steps**
1. Run `npm run db:status`. Read "in the ledger but missing from disk" + highest applied
   number. Use the next free number (expected `120`). If `120` is taken, increment.
2. Write the migration (idempotent):

```sql
-- 120_temp_password_invite.sql
ALTER TABLE employees ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS temp_credential_expires_at timestamptz;
```

3. `npm run db:up` → each pending file in its own transaction.
4. `npm run db:dump` → refresh `schema.sql` (expect a column-only diff).
5. Verify against live:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='employees'
  AND column_name IN ('must_change_password','temp_credential_expires_at');
```

**No new tables** → no RLS/REVOKE/`pg_policies` ceremony, no schema-contract addition.
`must_change_password` defaults `false`, so existing rows behave exactly as today.

**Verify:** `npm run db:status` clean; `npm run db:check` passes.

---

## Task 2 — Temp-password generator module (TDD)

**Files**
- Create: `src/lib/auth/temp-password.js`
- Create: `src/lib/auth/temp-password.test.js`

**Write the failing tests first**, then implement.

**Interface**

```js
// temp-password.js
export const TEMP_PASSWORD_TTL_DAYS = 7;
export const TEMP_PASSWORD_TTL_MS = TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000;
export function generateTempPassword(length = 16); // → string
export function tempPasswordExpiry(from = Date.now()); // → Date
```

**Implementation**

```js
import { randomInt } from "node:crypto";
import { isPassword } from "@/lib/validation/index";

export const TEMP_PASSWORD_TTL_DAYS = 7;
export const TEMP_PASSWORD_TTL_MS = TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000;

// No <, >, &, or quotes — keeps email HTML/text safe; HTML output is still escaped.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SPECIAL = "!@#$%^*?-_+=";
const ALL = UPPER + LOWER + DIGITS + SPECIAL;

const pick = (set) => set[randomInt(set.length)];

function shuffle(chars) {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

export function generateTempPassword(length = 16) {
  if (length < 8) throw new Error("length must be at least 8");
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
  while (chars.length < length) chars.push(pick(ALL));
  const password = shuffle(chars).join("");
  if (!isPassword(password)) throw new Error("generated password fails policy");
  return password;
}

export function tempPasswordExpiry(from = Date.now()) {
  return new Date(from + TEMP_PASSWORD_TTL_MS);
}
```

**Tests** (`temp-password.test.js`)
- Every generated password (500 iterations) passes `isPassword`.
- Default length is 16; contains ≥1 of each class.
- 500 consecutive default generations are unique (collision guard).
- `length: 8` accepted; `length: 7` throws.
- `tempPasswordExpiry()` ≈ now + 7 days (± 1 min) and is a `Date`.
- Byte length ≤ 72 (`Buffer.byteLength`).

**Verify:** `npx vitest run src/lib/auth/temp-password.test.js`

---

## Task 3 — Temp-password email template (TDD)

**Files**
- Modify: `src/lib/email/smtp.js`
- Modify: `src/lib/email/smtp.test.js`

**Interface**

```js
export function tempPasswordEmailText({ firstName, tempPassword, expiresAt });
export function tempPasswordEmailHtml({ firstName, tempPassword, expiresAt });
export async function sendTempPasswordEmail({ to, firstName, tempPassword, expiresAt });
```

**Implementation notes** — model on `sendPasswordResetEmail` / `resetEmailText` /
`resetEmailHtml` (transport, `emailFrom()`, `isEmailConfigured()` refusal behavior).

- Subject: `Your FleetOps temporary password` — **never contains the password value.**
- Multipart (HTML + plain text) is required (spam lessons — do not send text-only).
- Text body must include: greeting by firstName, the temp password on its own line,
  "you will be required to choose your own password immediately after signing in",
  expiry as `YYYY-MM-DD` from `expiresAt` + "7 days", resend note ("ask your
  administrator to resend it"), OTP note ("you will also receive a separate 6-digit
  login verification code when you sign in — that is normal"), ignore-if-unexpected
  warning, automated-message footer.
- HTML mirrors `resetEmailHtml` structure: header block, prominent mono password box,
  steps list, expiry line, OTP note, warning, footer. Escape the password in HTML
  anyway (`&`, `<`, `>` — generator avoids them, defense in depth).
- `sendTempPasswordEmail` throws when `to`/`tempPassword`/`expiresAt` missing or SMTP
  unconfigured (same refusal style as `sendPasswordResetEmail`).

**Tests** (append to `smtp.test.js` — `nodemailer` is already mocked)
- `tempPasswordEmailText` / `tempPasswordEmailHtml` include the password, firstName,
  and expiry date; run pure (no transport).
- `sendMailMock` called once with subject `Your FleetOps temporary password` and
  subject does NOT contain the password value; `html` and `text` parts both present.
- Missing credential refusal throws (parity with reset email test).

**Verify:** `npx vitest run src/lib/email/smtp.test.js`

---

## Task 4 — Register invite flow (schema, route, Add User page, harness)

**Files**
- Modify: `src/lib/validation/schemas.js`
- Modify: `src/lib/validation/schemas.test.js`
- Modify: `src/app/api/auth/register/route.js`
- Modify: `src/app/(dashboard)/settings/users/new/page.js`
- Modify: `scripts/verify-register-account.mjs`
- Modify: `src/security-assessment/config-secrets.security.test.js`
- Create: `src/app/api/auth/register/route.invite.test.js`
- Modify: `src/security-boundaries.test.js` (append structural guards)

### 4a. Schema

Remove `password` from `createUserSchema` (the three-line `.min(1, ...).refine(isPassword, ...)` chain).
If `isPassword` becomes unused in `schemas.js`, remove it from the `./index` import
(check other schemas first — `resetPassword`/`changePassword` schemas likely still use it).

Rewrite `schemas.test.js` (`createUserSchema` block) — `base` fixture already has no password:

```js
describe("createUserSchema invite flow", () => {
  it("accepts the invite payload without a password", () => {
    expect(createUserSchema.safeParse(base).success).toBe(true);
  });
  it("ignores a legacy password key (zod strips unknown keys)", () => {
    expect(createUserSchema.safeParse({ ...base, password: "Abcdef1!" }).success).toBe(true);
  });
  it("rejects invalid email / missing names / missing role", () => { /* 3 cases on `base` mutations */ });
});
```

(Password-policy parity tests move to Task 2's generator tests.)

### 4b. Register route — full replacement of `POST`

```js
import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { requirePermission, ok, err, handleError, errValidation } from "@/lib/api/utils";
import { validateBody, isValidObject, normalizeName, normalizeEmail } from "@/lib/validation/helpers";
import { writeAudit } from "@/lib/audit";
import { ROLE_IDS } from "@/lib/constants";
import { canAssignRole, assignRejectionHint } from "@/lib/auth/privilege";
import { isEmailConfigured, sendTempPasswordEmail } from "@/lib/email/smtp";
import { isDeliverableEmailAddress } from "@/lib/auth/otp-policy";
import { generateTempPassword, tempPasswordExpiry } from "@/lib/auth/temp-password";

export { canAssignRole }; // KEEP — imported by src/security-boundaries.test.js

const VALID_ROLE_IDS = new Set(Object.values(ROLE_IDS));

export async function POST(req) {
  try {
    const session = await requirePermission(req, "accounts", "create");
    const body = await req.json();
    const errors = validateBody(body, {
      email: { required: true, type: "email", label: "Email" },
      first_name: { required: true, type: "name", label: "First name", maxLength: 100 },
      last_name: { required: true, type: "name", label: "Last name", maxLength: 100 },
      role_id: { required: true, type: "id", label: "Role" },
    });
    if (!isValidObject(errors)) return errValidation(errors);

    const { email, first_name, last_name } = body;
    const roleId = Number(body.role_id);
    if (!VALID_ROLE_IDS.has(roleId)) return err("Invalid role.", 400);
    if (!canAssignRole(session.user.role, roleId)) return err(assignRejectionHint(roleId), 403);

    const lowerEmail = normalizeEmail(email);

    // Dup check BEFORE deliverability precheck (keeps 409 stable for seeded probes).
    const existing = await query(
      `SELECT employee_id FROM employees WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [lowerEmail]
    );
    if (existing.rows?.length > 0) return err("An account with this email already exists.", 409);

    // Fail closed BEFORE any insert.
    if (!isEmailConfigured()) {
      return err("Email delivery is not configured — accounts cannot be created right now.", 400);
    }
    if (!isDeliverableEmailAddress(lowerEmail)) {
      return err("This address cannot receive email — use a deliverable address.", 400);
    }

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    const expiresAt = tempPasswordExpiry();
    const { rows } = await query(
      `INSERT INTO employees (email, password_hash, first_name, last_name, role_id, must_change_password, temp_credential_expires_at)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       RETURNING employee_id`,
      [lowerEmail, hash, normalizeName(first_name), normalizeName(last_name), roleId, expiresAt]
    );
    const employeeId = rows[0]?.employee_id;

    try {
      await sendTempPasswordEmail({
        to: lowerEmail,
        firstName: normalizeName(first_name),
        tempPassword,
        expiresAt,
      });
    } catch (emailError) {
      // Fail closed: compensate so no account exists without a delivered credential.
      // If DELETE itself throws, the orphan row is still safe (flag set, nobody knows
      // the password, visible in the users list for a manual resend) — swallow it.
      try {
        await query(`DELETE FROM employees WHERE employee_id = $1`, [employeeId]);
      } catch (deleteError) {
        console.warn("Failed to remove invited account after email failure:", deleteError?.message || deleteError);
      }
      await writeAudit(req, session, {
        action: "invite_email_failed",
        resource: "employees",
        resourceId: employeeId,
        newValues: { email: lowerEmail, role_id: roleId },
      });
      return err("Account could not be created — the invitation email failed to send.", 502);
    }

    await writeAudit(req, session, {
      action: "create",
      resource: "employees",
      resourceId: employeeId,
      newValues: {
        email: lowerEmail,
        role_id: roleId,
        first_name: normalizeName(first_name),
        last_name: normalizeName(last_name),
        invited: true,
      },
    });

    return ok({ message: `Account created — temporary password sent to ${lowerEmail}`, employee_id: employeeId }, 201);
  } catch (e) {
    return handleError(e);
  }
}
```

**Interface contract:** `POST /api/auth/register` request = `{ email, first_name, last_name, role_id }`
(password rejected/ignored); 201 `{ message, employee_id }`; 400 invalid/undeliverable/no SMTP;
403 role assignment; 409 duplicate; 502 email failure (row compensated away).
The temp password appears ONLY in the outbound email — never in the response.

### 4c. Add User page (`settings/users/new/page.js`)

- Remove password `FloatingField`, eye-toggle state (`showPassword`), `CapsLockHint` /
  `useCapsLock` import+usage, `password: ""` from `defaultValues`, `password` from
  `submitPayload`, `setShowPassword(false)` from `onSuccess`.
- Credentials card subtitle → `"A temporary password will be generated and emailed.
  The employee must change it on first sign-in."`
- Toast: capture mutation `vars.email` in `onSuccess`; message
  `` `Account created — temporary password sent to ${vars.email}` ``.
- Add an info callout under the credentials card (style of the existing driver notice):
  **"What happens next:"** (1) temp password emailed, (2) employee signs in with it +
  verification code, (3) must set own password before the dashboard opens; expires in 7 days.

### 4d. Mocked route test — `route.invite.test.js`

- `vi.mock("@/lib/db")` with a `query` impl switching on SQL prefix
  (`SELECT employee_id` → empty / seeded; `INSERT INTO employees` → `{ rows: [{ employee_id: 42 }] }`;
  `DELETE FROM employees` → `{ rows: [] }`).
- `vi.mock("@/lib/audit")` (`writeAudit` spy).
- Partial-mock `@/lib/api/utils` keeping **only** `requirePermission` mocked
  (`vi.importActual` for `ok`/`err`/`handleError`/`errValidation` so real shapes are used).
- Mock `@/lib/email/smtp`: `sendTempPasswordEmail` success/fail spies + `isEmailConfigured: () => true`.
- Mock `@/lib/auth/otp-policy` `isDeliverableEmailAddress` to respect/observe the call
  (or keep real — `harness-adduser-probe@local.invalid` is already undeliverable).
- Cases: happy path 201 + INSERT params contain `true` + Date + audit `create` without
  password field; send-fail → 502 + DELETE called + audit `invite_email_failed`;
  undeliverable → 400 and **no INSERT**; duplicate → 409 before precheck;
  unauthorized role → 403.
- Assert response JSON never contains the generated password.

### 4e. Structural guards (append to `security-boundaries.test.js`)

```js
it("register invites: no password input, temp-password wiring present", () => {
  const route = readFileSync(new URL("./app/api/auth/register/route.js", import.meta.url), "utf8");
  expect(route).toContain("sendTempPasswordEmail");
  expect(route).toContain("must_change_password");
  expect(route).toMatch(/DELETE FROM employees/); // fail-closed compensation
  expect(route).not.toMatch(/password:\s*(body|password)/);
  const page = readFileSync(new URL("./app/(dashboard)/settings/users/new/page.js", import.meta.url), "utf8");
  expect(page).not.toMatch(/type="password"/);
  expect(page).not.toContain("showPassword");
});
```

### 4f. Harness `scripts/verify-register-account.mjs`

- `VALID`: drop the `password` key (also un-trips config-secrets `password:` literal scan).
- Delete the weak-password 400 section and the happy-path 201 section (live send is no
  longer possible — deliverability precheck blocks `.invalid`).
- Replace with: (1) happy-path-shaped payload on `harness-adduser-probe@local.invalid`
  → deterministic **400** "This address cannot receive email…" (fail closed, no INSERT);
  (2) seed duplicate via SQL `INSERT INTO employees (email, password_hash, first_name,
  last_name, role_id) VALUES ($1, '$2b$10$...', 'Probe', 'Account', $3)` using a
  **`password_hash:` key** (not `password:` — avoids the secrets regex) → same payload →
  **409**; cleanup deletes the seeded row.
- Keep `harness-adduser-probe@local.invalid`, the `__HARNESS_SESSION__` usage, and
  `finally { await cleanup() }` — required by
  `src/security-assessment/config-secrets.security.test.js:393-398`.
- `config-secrets.security.test.js`: remove the `scripts/verify-register-account.mjs`
  line from `REVIEWED_BENIGN` (line ~380) plus its comment lines.

**Verify:** `npx vitest run src/lib/validation/schemas.test.js src/app/api/auth/register/route.invite.test.js src/security-boundaries.test.js src/security-assessment/config-secrets.security.test.js`
then `node --import ./scripts/route-harness-loader.mjs scripts/verify-register-account.mjs`.

---

## Task 5 — Login: expiry rejection + `mustChangePassword` claim

**Files**
- Modify: `src/lib/auth.js`
- Modify: `src/app/(auth)/login/page.js`
- Modify: `src/security-boundaries.test.js` (append)

### 5a. `src/lib/auth.js`

- `credentials.authorize` supabase SELECT: add `must_change_password, temp_credential_expires_at`.
- After the invalid-credentials block, **before the Email-OTP branch** (no OTP emailed for
  an expired temp):

```js
if (employee.must_change_password && employee.temp_credential_expires_at
    && new Date(employee.temp_credential_expires_at).getTime() < Date.now()) {
  throw new Error("TEMP_PASSWORD_EXPIRED");
}
```

(Thrown messages surface to the client — only `return null` becomes the generic
`CredentialsSignin`; see `login/page.js` ~line 922.)
- `authorize` return adds `mustChangePassword: Boolean(employee.must_change_password)`.
- `jwt` callback (`if (user)` block): `token.mustChangePassword = Boolean(user.mustChangePassword);`
- `session` callback: `session.user.mustChangePassword = Boolean(token.mustChangePassword);`

### 5b. `login/page.js`

- In **both** `handleSubmit` and `handleMfaSubmit` catch chains, add a branch before the
  fallback:

```js
} else if (err.message === "TEMP_PASSWORD_EXPIRED") {
  setError("This temporary password has expired. Ask your administrator to resend it.");
}
```

- `redirectAfterSignIn` (~line 720): when `activeSession?.user?.mustChangePassword`,
  `router.replace("/set-password")` instead of the normal destination.

**Structural guard:** `auth.js` source contains `TEMP_PASSWORD_EXPIRED` +
`must_change_password`; `login/page.js` contains both message branches and `/set-password`.

---

## Task 6 — Server-side gate in `resolveIdentity`

**Files**
- Modify: `src/lib/api/utils.js`
- Modify: `src/security-boundaries.test.js` (append)

**Implementation**

```js
const MUST_CHANGE_ALLOWED_PATHS = new Set([
  "/api/auth/change-password",
  "/api/auth/profile",
  "/api/auth/heartbeat",
]);

function assertPasswordChangeGate(req, user) {
  if (!user?.mustChangePassword) return;
  let pathname = "";
  try { pathname = new URL(req.url).pathname; } catch { pathname = ""; }
  if (!MUST_CHANGE_ALLOWED_PATHS.has(pathname)) {
    throw new AuthError("You must set a permanent password before continuing.", 403, "PASSWORD_CHANGE_REQUIRED");
  }
}
```

- `resolveCurrentIdentity` SELECT adds `e.must_change_password`; returned user adds
  `mustChangePassword: Boolean(current.must_change_password)`.
- Call `assertPasswordChangeGate(req, user)` before **both** `resolveIdentity` returns
  (bearer path + session path). Session path runs after harness substitution — harness
  user has no `mustChangePassword` → skip (deliberate seam; gate cannot fire in harness).
- Allowlist rationale: change-password (the fix), profile (display name/avatar),
  heartbeat (idle keep-alive while filling the forced form).

**Structural guard:** source contains `PASSWORD_CHANGE_REQUIRED`, `"/api/auth/change-password"`,
and `assertPasswordChangeGate(req, user)`.

**Verify:** `npm run verify:auth`.

---

## Task 7 — Rotate-and-stay: session rotation helper + forced change-password

**Files**
- Create: `src/lib/auth/session-rotation.js`
- Create: `src/lib/auth/session-rotation.test.js`
- Modify: `src/app/api/auth/change-password/route.js`

### 7a. `session-rotation.js`

```js
import { encode } from "next-auth/jwt"; // next-auth 4.24.15
import { query } from "@/lib/db";

export function sessionCookieName(env = process.env) {
  return env.NODE_ENV === "production"
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
}

const SESSION_MAX_AGE_S = 43_200; // 12h — match authorize()'s web_sessions insert

export async function mintRotatedSession({ employee, ip, userAgent }) {
  const { rows } = await query(
    `INSERT INTO web_sessions (employee_id, ip_address, user_agent, idle_timeout)
     VALUES ($1, $2, $3, NOW() + interval '30 minutes')
     RETURNING session_id`,
    [employee.employeeId, ip || null, userAgent || null]
  );
  const sessionId = rows[0].session_id;
  const token = {
    name: [employee.firstName, employee.lastName].filter(Boolean).join(" "),
    email: employee.email,
    picture: null,
    sub: String(employee.employeeId),
    role: employee.role,
    employeeId: employee.employeeId,
    firstName: employee.firstName,
    lastName: employee.lastName,
    position: employee.position,
    status: employee.status,
    driverStatus: null,
    avatarUrl: null,
    authVersion: employee.authVersion,
    sessionId,
    mustChangePassword: false,
  };
  const encoded = await encode({ token, secret: process.env.NEXTAUTH_SECRET, maxAge: SESSION_MAX_AGE_S });
  const name = sessionCookieName();
  const attrs = [
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${SESSION_MAX_AGE_S}`,
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ];
  return { cookie: `${name}=${encoded}; ${attrs.join("; ")}`, sessionId, token };
}
```

**Test** (vitest `NODE_ENV=test` → non-`__Secure__` name): round-trip
`mintRotatedSession` cookie → `decode({ token, secret })` asserts `sessionId`,
`employeeId`, `authVersion`, `role`, `mustChangePassword === false`; `sessionCookieName`
returns `__Secure-next-auth.session-token` for `{ NODE_ENV: "production" }` and
`next-auth.session-token` otherwise; query param shape (mock `@/lib/db`).

### 7b. `change-password` route — forced branch

Restructure `POST`:

1. Parse body; `if (!newPassword) return err("New password is required", 400);`
2. Keep existing rate-limit blocks unchanged.
3. SELECT (add the columns):

```sql
SELECT e.password_hash, e.must_change_password, e.email, e.first_name, e.last_name,
       e.position, e.status, e.auth_version, r.role_name
  FROM employees e
  LEFT JOIN roles r ON r.role_id = e.role_id
 WHERE e.employee_id = $1 AND e.deleted_at IS NULL AND e.status = 'Active'
```

   No row → 404. `const forced = employee.must_change_password === true;`
4. Validation:
   - `if (!forced && (!currentPassword || !newPassword)) return err("Current password and new password are required", 400);` (exact legacy message)
   - Voluntary only: `currentPassword === newPassword` → 400 "New password must be
     different from current password"; missing `password_hash` → 404 "Account not found";
     `bcrypt.compare` fail → 403 "Current password is incorrect".
   - Forced: skip all of the above (temp password is not re-checked here).
5. `const hash = await bcrypt.hash(newPassword, 10);`
6. Transaction (`withTransaction`):

```sql
UPDATE employees
   SET password_hash = $1,
       auth_version = auth_version + 1,
       updated_at = NOW(),
       must_change_password = false,
       temp_credential_expires_at = NULL
 WHERE employee_id = $2 AND password_hash = $3 AND deleted_at IS NULL AND status = 'Active'
 RETURNING auth_version
```

   (`$3 = employee.password_hash` — optimistic lock; forced path still guarded.)
   Empty → return null → 409 "Password was changed already. Please sign in again."
   Then `revokeEmployeeSessions(tx, employeeId)` (`src/lib/auth/sessions.js:14`) and
   `DELETE FROM password_reset_tokens WHERE employee_id = $1 AND used_at IS NULL`.
7. After commit: `writeAudit` `action: "password_change"`,
   `newValues: { sessions_revoked: true, forced_initial_change: forced }` — never passwords.
8. Branch:

```js
if (forced) {
  const { cookie } = await mintRotatedSession({
    employee: {
      employeeId, email: employee.email, firstName: employee.first_name,
      lastName: employee.last_name, position: employee.position, status: employee.status,
      role: normalizeRoleName(employee.role_name),
      authVersion: Number(changed.auth_version),
    },
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent") || null,
  });
  const response = ok({ message: "Password set successfully", mustChangePassword: false });
  response.headers.set("Set-Cookie", cookie);
  return response;
}
return ok({ message: "Password updated successfully", signInRequired: true });
```

Imports to add: `mintRotatedSession`, `normalizeRoleName` (from `src/lib/auth/role-names`),
`clientIp` (already used by register — confirm existing import in this file, reuse if present).
The new session row is inserted **after** the tx (so it survives its own revoke).

**Structural guard (append):** change-password source contains `must_change_password = false`,
`mintRotatedSession`, and still contains `signInRequired: true` (voluntary path intact).

---

## Task 8 — Resend invite + users list/status

**Files**
- Create: `src/app/api/settings/users/[id]/resend-invite/route.js`
- Modify: `src/app/api/settings/users/route.js` (`EMPLOYEE_SELECT`)
- Modify: `src/app/(dashboard)/settings/users/page.js`

### 8a. Resend route

Before writing: open `node_modules/next/dist/docs/` route-handler docs and confirm whether
`params` is sync or a Promise in this Next version; if the repo's `cards/[id]` routes use
`params.id` synchronously and the docs allow it, match the repo convention
(`const { id } = params;`); if docs require awaiting, use `const { id } = await Promise.resolve(params);`.
**AGENTS.md mandate — do not skip this read.**

```js
import bcrypt from "bcryptjs";
import { withTransaction } from "@/lib/db"; // match change-password's import source
import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";
import { isEmailConfigured, sendTempPasswordEmail } from "@/lib/email/smtp";
import { isDeliverableEmailAddress } from "@/lib/auth/otp-policy";
import { generateTempPassword, tempPasswordExpiry } from "@/lib/auth/temp-password";
import { revokeEmployeeSessions } from "@/lib/auth/sessions";

export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, "accounts", "create");
    const { id } = params; // adjust per Next docs read above
    const employeeId = Number(id);
    if (!Number.isInteger(employeeId) || employeeId <= 0) return err("Invalid id.", 400);

    const { query } = await import("@/lib/db");
    const { rows } = await query(
      `SELECT employee_id, email, first_name, must_change_password, deleted_at, status
         FROM employees WHERE employee_id = $1`,
      [employeeId]
    );
    const employee = rows?.[0];
    if (!employee || employee.deleted_at) return err("Account not found", 404);
    if (!employee.must_change_password) {
      return err("This account already has a permanent password — use the password reset flow instead.", 400);
    }
    if (!isEmailConfigured()) return err("Email delivery is not configured.", 400);
    if (!isDeliverableEmailAddress(employee.email)) {
      return err("This address cannot receive email — use a deliverable address.", 400);
    }

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    const expiresAt = tempPasswordExpiry();

    const changed = await withTransaction(async (tx) => {
      const { rows: updated } = await tx.query(
        `UPDATE employees
            SET password_hash = $1, temp_credential_expires_at = $2,
                auth_version = auth_version + 1, updated_at = NOW()
          WHERE employee_id = $3 AND must_change_password = true AND deleted_at IS NULL
          RETURNING auth_version, email, first_name`,
        [hash, expiresAt, employeeId]
      );
      if (!updated.length) return null;
      await revokeEmployeeSessions(tx, employeeId);
      await tx.query(`DELETE FROM password_reset_tokens WHERE employee_id = $1 AND used_at IS NULL`, [employeeId]);
      return updated[0];
    });
    if (!changed) return err("Account state changed — refresh and try again.", 409);

    // Send AFTER tx: on failure the new password is unknown to everyone → 502 tells
    // the admin to hit Resend again (documented asymmetry vs create, which compensates).
    try {
      await sendTempPasswordEmail({
        to: employee.email,
        firstName: employee.first_name,
        tempPassword,
        expiresAt,
      });
    } catch {
      return err("The new temporary password could not be emailed — press Resend invite again.", 502);
    }

    await writeAudit(req, session, {
      action: "invite_resend",
      resource: "employees",
      resourceId: employeeId,
      newValues: { email: employee.email }, // password/hash NEVER logged
    });
    return ok({ message: `A new temporary password was emailed to ${employee.email}` });
  } catch (e) {
    return handleError(e);
  }
}
```

(Adjust `query`/`withTransaction` imports to the file's actual style — static imports at
top, not dynamic; the snippet above just makes dependencies explicit.)

**verify-route-auth contract:** `requirePermission(req, "accounts", "create")` is on the
recognized list (line 100); bare `requireAuth(req)` would fail line 134 — do not use it.
Gate from Task 6 does not block this path (admin has `mustChangePassword: false`).

### 8b. Users list GET

`EMPLOYEE_SELECT` in `settings/users/route.js`: add
`e.must_change_password, e.temp_credential_expires_at`.

### 8c. Users page UI

- Column defs: import `Mail` from `lucide-react`; add
  `canResendInvite = rolesFor("accounts", "create").includes(user?.role)` (memo deps).
- **Status cell** (accessor `deleted_at`, ~line 130) — order matters: disabled first,
  then pending, else active:

```js
const u = info.row.original;
if (disabled) return <span …>Disabled</span>;          // existing markup
if (u.must_change_password) {
  const exp = u.temp_credential_expires_at
    ? new Date(u.temp_credential_expires_at).toLocaleDateString(undefined,
        { year: "numeric", month: "short", day: "numeric" })
    : null;
  return (
    <span className="inline-flex items-center gap-1.5" title="Temporary password not yet replaced">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
      <span className="text-xs font-medium text-warning">
        Password not set{exp ? ` · expires ${exp}` : ""}
      </span>
    </span>
  );
}
return <span …>Active</span>;                           // existing markup
```

- **Actions cell** (~line 155): before the Reset-password button:

```jsx
{canResendInvite && u.must_change_password && (
  <Button variant="ghost" size="sm" onClick={() => setResendTarget(u)}
    disabled={resendMutation.isPending} title="Email a new temporary password">
    <Mail className="w-3.5 h-3.5 mr-1.5" /> Resend invite
  </Button>
)}
```

- Mutation + dialog state:

```js
const resendMutation = useMutation({
  mutationFn: (employee_id) =>
    apiFetch(`/api/settings/users/${employee_id}/resend-invite`, { method: "POST", body: {} }),
  onSuccess: (result) => {
    toast.success(result?.message || "A new temporary password was emailed");
    setResendTarget(null);
    queryClient.invalidateQueries({ queryKey: ["staff-users"] });
  },
  onError: (e) => toast.error(e.message || "Failed to resend invitation"),
});
```

- Second `ConfirmDialog` instance:

```jsx
<ConfirmDialog
  open={Boolean(resendTarget)}
  onOpenChange={(open) => !open && setResendTarget(null)}
  variant="warning"
  title="Resend invitation?"
  message={`A new temporary password will be emailed to ${resendTarget?.email}. The previous temporary password stops working immediately.`}
  confirmLabel="Send new password"
  cancelLabel="Cancel"
  loading={resendMutation.isPending}
  onConfirm={() => resendTarget && resendMutation.mutate(resendTarget.employee_id)}
/>
```

- Add all new symbols to the `columns` memo dependency array.

**Verify:** `npm run verify:auth`.

---

## Task 9 — `/set-password` page + layout gate + service

**Files**
- Modify: `src/services/auth.service.js`
- Modify: `src/components/dashboard/dashboard-layout.jsx`
- Create: `src/app/set-password/page.js`

### 9a. Service

```js
export function setInitialPassword(newPassword) {
  return apiFetch("/api/auth/change-password", { method: "POST", body: { newPassword } });
}
```

### 9b. Layout gate (`dashboard-layout.jsx`)

- `authRoutes` (line ~17): append `"/set-password"` (page sits outside `(dashboard)` —
  only the root layout exists — so it must bypass the `"/login"`-only redirect).
- In `DashboardLayout`: add `const { employee, loading, user } = useAuth();` (add `user`),
  `const router = useRouter();` (already imported), then after the authRoutes check:

```js
if (!loading && user?.mustChangePassword && pathname !== "/set-password") {
  router.replace("/set-password");
  return null; // prevents children mounting and firing 403 fetches
}
```

### 9c. Page `src/app/set-password/page.js`

- Reuse `RecoveryShell` / `RecoveryIcon` / `AccessState` etc. from
  `src/components/auth/recovery-shell.jsx`; form/strength pattern from
  `src/app/(auth)/reset-password/page.js` (`RULE_CHECKS`, `RequirementList`,
  `StrengthIndicator`) — **no** current-password field, **no** step-1 email stage.
- Session handling: `useSession()` → loading → shell loading state; unauthenticated →
  `router.replace("/login")`; authenticated but `!session.user.mustChangePassword` →
  `router.replace("/dashboard")`.
- Submit: call `setInitialPassword(newPassword)`; on success `const { update } = useSession()`;
  `await update()` (refetches `/api/auth/session` → decodes the NEW cookie →
  `mustChangePassword: false`); success phase auto-redirects after ~1s via
  `router.replace("/dashboard")` + `router.refresh()`, with an immediate
  "Go to dashboard now" button as fallback.
- Error: render `error.message` (403 `PASSWORD_CHANGE_REQUIRED` for non-allowlisted
  calls should not occur here; show inline like reset-password does).
- `npm run lint` must pass on this file (no unused imports from the copy-paste).

**Verify:** `npm run verify:auth`.

---

## Task 10 — Full verification gates

Run, in order; fix failures before proceeding:

```bash
npm run test:run        # NOT `npm test` (watch mode)
npm run lint            # or npx eslint <touched files> if lint is whole-repo slow
npm run verify:auth
npm run verify:anon
npm run db:contract
npm run db:check
npm run db:status       # no pending/changed migrations
node --import ./scripts/route-harness-loader.mjs scripts/verify-register-account.mjs
```

**Manual E2E checklist** (against dev server + real DB; use a real deliverable mailbox):

1. Add User with valid email → 201 toast "temporary password sent"; no password field anywhere.
2. Inbox: temp-password email (HTML+text, password present, subject has NO password) +
   no other leaks; OTP email still arrives at login.
3. Users list: amber "Password not set · expires …" + Resend invite action.
4. Sign in with temp password → OTP → forced `/set-password` (hard-refresh stays there;
   deep-link to `/dashboard` bounces back).
5. While forced: fetch an arbitrary API (e.g. settings users GET) with the session →
   `403 PASSWORD_CHANGE_REQUIRED`; `/api/auth/heartbeat` and profile still 200.
6. Set new password → lands on `/dashboard` **without re-login**; old temp password now
   rejected; new password works after `signOut`/return.
7. Resend invite → old temp dead, new email arrives, expiry resets.
8. Expired temp (set `temp_credential_expires_at` in the past via SQL) → login shows
   "This temporary password has expired…" with no OTP email sent.
9. Voluntary Settings change still returns `signInRequired: true` + logout behavior (unchanged).
10. Fail-closed: stop SMTP (`SMTP_PASS` unset) → Add User returns 400; no employee row.

**DO NOT COMMIT ANYTHING.**

---

## Task 11 — Capstone documentation

**Files**
- Modify: `Capstone/04 - Architecture/Authentication.md` — new "Temporary password
  invitations" section: flow diagram, 7-day expiry, rotate-and-stay, gate allowlist,
  `TEMP_PASSWORD_EXPIRED`, resend semantics, fail-closed create.
- Modify: `Capstone/03 - Database/Tables/employees.md` — document
  `must_change_password` (bool, default false) + `temp_credential_expires_at` (timestamptz, nullable).
- Modify: `Capstone/06 - Decisions/Decision Log.md` — two entries:
  1. Temp password over one-time setup link (reverses earlier leanings — rejected link
     for: no magic-link infra, OTP already trains "two emails", simpler audit).
  2. Rotate-and-stay over double login (forced change returns a fresh session cookie).
- Modify: `Capstone/01 - System/System.md` — changelog line for the invite flow.
- Closest feature note if one exists for Settings/Users — update workflow copy.
- Mention this documentation update in the final response (repo policy).

---

## Interfaces at a glance (consistency checklist)

| Symbol | File |
|---|---|
| `generateTempPassword`, `tempPasswordExpiry`, `TEMP_PASSWORD_TTL_DAYS` | `src/lib/auth/temp-password.js` |
| `sendTempPasswordEmail`, `tempPasswordEmailText/Html` | `src/lib/email/smtp.js` |
| `mintRotatedSession`, `sessionCookieName` | `src/lib/auth/session-rotation.js` |
| `setInitialPassword` | `src/services/auth.service.js` |
| `assertPasswordChangeGate`, `MUST_CHANGE_ALLOWED_PATHS` | `src/lib/api/utils.js` |
| `PASSWORD_CHANGE_REQUIRED` (403 code) | `utils.js` → thrown |
| `TEMP_PASSWORD_EXPIRED` (thrown) | `src/lib/auth.js` → login catches |
| `invite_email_failed`, `invite_resend`, `password_change` | audit actions |
| `mustChangePassword` | authorize return → token → `session.user` → UI/gate |
| DB columns | `employees.must_change_password`, `employees.temp_credential_expires_at` |

## Open verification points (resolve during execution, not blockers)

- Next `params` sync-vs-Promise — **read `node_modules/next/dist/docs/` first** (Task 8a).
- Confirm next migration number via `db:status` (Task 1).
- Confirm whether account creation has any recovery-code side effect (Authentication.md
  claims it; register route shows none) — preserve whatever register truly does today.
- Confirm `clientIp`/`withTransaction` import style inside the change-password file.

## Post-execution

1. Update Capstone notes (Task 11) + mention in final response.
2. Remind user everything is **left uncommitted** per their instruction.

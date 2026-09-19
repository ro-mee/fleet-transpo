---
type: plan
status: implemented
title: OTP Verification Modal
tags: [development, authentication, mfa, ux]
source:
  - src/app/(auth)/login/page.js
  - src/services/auth.service.js
  - src/lib/auth.js
  - src/lib/auth/trusted-device.js
  - src/app/api/auth/trusted-device/route.js
  - supabase/migrations/117_trusted_web_devices.sql
  - src/components/ui/dialog.jsx
last_verified: 2026-09-19
related:
  - "[[Authentication]]"
  - "[[UI UX Audit - Web]]"
---

# OTP Verification Modal Plan

## Recommendation

Use a modal for the existing authenticator-code step first. The current web
flow is NextAuth credentials plus server-enforced TOTP/recovery-code MFA:
`login/page.js` passes `mfaCode` as `totpCode` to `auth.service.js`, and
`lib/auth.js` atomically consumes the factor before creating a session.

Email OTP should not be treated as a copy change. It needs a separate,
short-lived email challenge, delivery provider, rate limits, one-time
consumption, and a server contract. The same modal shell can support it later.

## Target experience

1. Keep the email and password fields in the existing login card.
2. After the server returns `MFA_REQUIRED`, open a centered verification modal
   over the login page instead of adding an inline field.
3. Show six equal visual code cells backed by one accessible numeric input,
   supporting paste, keyboard entry, and `autocomplete="one-time-code"`.
4. Submit automatically on six digits. Replace the fields with a scanning
   state while the server confirms, then animate a success check. Recovery
   mode submits automatically for a complete 20-character code or Enter; do
   not add a duplicate verification button.
5. On a valid response, show a short verified/check state, then use the
   existing role-aware return path to navigate to `/dashboard` or the saved
   internal route.
6. On invalid or replayed code, keep the modal open, clear the cells, focus
   the first cell, and expose the existing truthful error copy.

## Visual direction

- Preserve the light Executive Dashboard language: cool paper backdrop, white
  surface, midnight-ink action, semantic status colors, and the login page's
  existing double-bezel card.
- Use the shared Radix `Dialog` primitive with a calmer auth overlay aligned
  to `SessionTimeoutDialog`: dimmed navy backdrop, only a slight blur, compact
  floating surface, and soft structural elevation.
- Modal anatomy: small shield/status mark, `Verify it's you` title, one-line
  instruction, six code cells, quiet helper/recovery action, and automatic
  verification feedback.
- Do not add glassmorphism, confetti, decorative illustrations, or another
  large card inside the modal. The login page is already visually rich.
- For email OTP later, change only the factual copy to mention the masked
  destination address after the server has actually sent the message.

## Motion

- Modal entrance: opacity plus a small translate/scale settle; no layout
  movement in the underlying login card.
- Digit entry: the active cell receives a restrained primary tint and a
  150–200ms scale settle. No bouncing or per-keystroke sound.
- Verification: the lock becomes a bounded scan line and breathing ring while
  the server confirms the code; keep the input disabled and prevent duplicate
  submissions during this state.
- Success: all cells receive a subtle success tint, a checkmark draws/scales
  in, and navigation follows after roughly 300–400ms only after the server
  confirms the code.
- Invalid: one short horizontal shake plus an inline error; reset focus to
  the first cell. Avoid a persistent red modal or repeated pulsing.
- Reuse the existing Framer Motion `MotionConfig reducedMotion="user"` path;
  reduced motion becomes an instant state change.

## Required states

`closed` → `entering` → `ready` → `verifying` → `success` → dashboard.

Failure states remain in the modal: invalid/replayed code, MFA unavailable,
verification throttled, and recovery-code mode. Close/Escape/Back to sign in
returns to the credential form without creating a session.

## Implementation boundary

For the TOTP version, change only the login surface and add the smallest local
verification-modal component if the JSX becomes difficult to read. Reuse the
existing `mfaRequired`, `mfaCode`, `signIn`, `getSession`, and
`getAndClearReturnTo` flow. No migration, provider, or new auth endpoint is
needed.

If email OTP becomes mandatory, add the backend contract before polishing the
UI: cryptographically random code, hashed challenge storage, five-minute
expiry, one-time consume, resend cooldown, per-IP/account attempt limits,
generic failure responses, and a configured transactional SMTP provider.
Never store or audit the plaintext code, and never put it in a URL.

## Acceptance checks

- Password-only accounts still sign in exactly as before.
- Enrolled MFA accounts open the modal only after valid credentials; a valid
  unrevoked trusted-device cookie for the same `auth_version` can skip the
  second factor.
- Six-digit entry, paste, backspace, recovery code, invalid/replayed code,
  throttling, Escape, refresh, and reduced-motion behavior are covered.
- Success navigates only after server confirmation and preserves the existing
  saved internal return route and role landing behavior.
- Focus is trapped in the dialog, the first cell receives focus, labels are
  announced, and the compact modal works at narrow mobile widths and in dark
  mode.
- Remember-device is an explicit opt-in. The server issues a random 32-byte
  opaque token in an HttpOnly 30-day cookie, stores only its SHA-256 hash in
  the private `trusted_web_devices` table, binds it to `auth_version`, and
  revokes it on security-sensitive auth/session changes. The raw token is
  never logged or stored in localStorage.

## Implementation result

- `src/app/(auth)/login/page.js` now opens `MfaVerificationDialog` only after
  valid credentials return `MFA_REQUIRED`.
- The modal now matches the supplied reference as a centered ~512px surface:
  pale blue-gray blurred backdrop, scalloped pale-blue lock halo, six compact
  OTP cells, authenticator helper row, opt-in remember-device affordance,
  trouble divider, and outlined recovery action.
- The six cells remain backed by one accessible numeric input with paste,
-  auto-submit on six digits, recovery-code auto-submit at 20 characters or
  Enter, focus recovery after a failed attempt, and reduced-motion-compatible
  Framer Motion feedback.
- During verification the code fields transition into an animated lock scan;
  server confirmation then draws a green check and releases the existing
  role-aware redirect. The duplicate primary verify button was removed.
- Successful verification waits for the authenticated session, shows the
  confirmed state briefly, and preserves the existing role-aware return route.
- `src/components/ui/dialog.jsx` now accepts an optional `overlayClassName`,
  allowing this auth modal to use the calmer navy overlay without changing
  other dialogs.
- The “Remember this device for 30 days” row is now functional. A successful
  MFA sign-in calls `POST /api/auth/trusted-device` when opted in and
  `DELETE` when opted out; subsequent password sign-ins atomically validate
  the cookie, expiry, revocation state, and current `auth_version` before
  bypassing MFA.

Verified: touched-file ESLint passed; `npm run build` passed; focused auth and
schema security tests passed with `npm run test:run -- --configLoader runner`
(**61/61**); `db:contract` confirmed RLS on, no anon SELECT grant, and the
unique token-hash constraint; `npm run db:status` reports no pending or
changed migrations.
Repo-wide `lint:ci` remains blocked by pre-existing generated Expo bundles
under `mobile/.expo`, not by these files.

## Status

Implemented for the existing TOTP/recovery-code MFA flow, including the
server-backed trusted-device opt-in. Email OTP delivery remains a separate
backend/provider decision.

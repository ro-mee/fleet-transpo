# Design: OTP Verification Screen — Hierarchy, Clay Cells, AuthHeader

**Date:** 2026-09-24
**Status:** Approved (design), not yet implemented
**Scope:** Mobile OTP step only (`mobile/components/otp/*` + the three auth brand blocks). No server, no schema, no auth-flow changes.

## Goal

Give the mobile OTP step the premium/minimalist treatment and the visual weight of the rest of the auth family, without touching a single line of verification logic. The screen currently has no brand anchor, cells whose empty and filled states are the same colour, a duplicated instruction, and a divider + three stacked footer rows all rendered at equal weight.

## Decisions (with rationale)

| # | Decision | Notes |
|---|---|---|
| 1 | **Restructure for hierarchy, not cosmetic polish** | Drop the duplicated initial instruction, add the missing brand/security anchor, rebuild the card footer into two clear rows. Chosen over "leave structure, restyle only". State machine, auto-submit, timers, resend and recovery mode are untouched. |
| 2 | **Extract a shared `AuthHeader`** | The `ClayTile → title → tagline` block is byte-identical across `login.js:143-155`, `forgot-password.js:90-102`, `reset-password.js:110-122`. Extract once; use in all three plus the new OTP header. Chosen over the broader option that also fixed the login-form footer — **that AA fix was explicitly declined** and is recorded as an out-of-scope follow-up. |
| 3 | **Header = family block, pill absorbed** | `ClayTile size="lg"` (56×56, radius 20) + `appName` at 28/36 `displayBold` + `tagline` at 16/24 `body`. Mint email pill folds into the tagline. Back button stays as its own row above. |
| 4 | **Title bumps 24 → 28** | Real change, not a no-op: current OTP title is `moderateScale(24)/32` (`OtpVerificationView.jsx:474-479`); family `appName` is `28/36`. |
| 5 | **One instruction, not two** | Today the instruction appears at `:279` ("Enter the 6-digit code sent to") *and* at `:366` (the card's info row, seeded from `notice`). **Implementation rule:** stop seeding `infoMsg` from the prop (`useState(null)`) and delete the `notice` prop plus the `mfaNotice` state in `login.js` — it has no other consumer. The `infoMsg` *state* stays, because the component still sets it itself ("A new code is on its way…" at `:160` and `:202`). |
| 6 | **Footer → one meta row** | `Expires in 04:19` left, `Resend in 00:19` right; when the cooldown elapses the right side becomes a tappable primary `Resend`. Recovery drops below as a quiet tertiary. Divider removed. Three rows + divider → two rows. |
| 7 | **Cell recipe B — filled lifts, empty stays carved** | **Root cause:** `resolveCellBg` returns the *identical* value for filled and empty (`OtpInput.jsx:225-228`), so every cell is flat `#FFFFFF` on a `#FBF8F3` card. Rejected A (uniform trough — you must read the digits to know progress) and C (filled tints `primaryContainer` — a third colour meaning beside the existing red/green cell states). B uses the clay light model itself as the information channel: raised = filled, carved = empty. Depth, not hue → cannot fail on contrast in dark mode. |
| 8 | **Dark mode uses real tokens, not eyeballed values** | Stage `#0D1713`, card `#151D1A`, empty cell `#0D1311` (`surfaceContainerLowest`), filled cell `#25302B` (`surfaceContainerHigh`), tile/title `#A6C7B8`, tagline `#C2CBC4`. Shadows taken from `moldedMaterials` formulas verbatim (below). |
| 9 | **Tagline copy = single flowing instruction** | `"Enter the 6-digit code sent to {mask}"`. Family voice (`reset-password.js:120`), one line, wraps naturally. Rejected "Code sent to …" (never says what to enter) and "instruction + keep the pill" (re-adds chrome on a screen asked to stay minimalist). Non-email fallback stays `"Enter the 6-digit code sent to your registered email"`. |
| 10 | **Dash fix (bug, not taste)** | `OtpInput` row is `gap: moderateScale(6)` (`:374`) but the separator is `left:-12, width:12` (`:385-386`) holding a `7`px dash (`:393`) — the box is twice its slot and the dash is wider than the gap, so it overruns cell 3. Fix: `gap 6→8`, separator `left:-8, width:8`, dash stays `7`. 6×44 + 5×8 = 304 inside the 320 container → nothing reflows. |
| 11 | **Keep the reserved status band** | `statusArea` `minHeight: 26` (`:506`) stays. Collapsing it would jump the footer on "Verifying code…" and on errors — the worst moment to move layout under someone's thumb. It starts empty once the duplicate notice is gone; that quiet vertical space is the accepted cost. |
| 12 | **Footer type unified to 14px** | Merged row currently mixes `13px` (`timerText`) and `14px` (`resendLink`). One row, one size. |
| 13 | **Card padding stays OTP's own `18/14`** | Siblings use `20/16`. Deliberately not aligned — this card carries six cells and a keyboard-driven flow; aligning grows it for no functional reason. |
| 14 | **AA fix scoped to the OTP branch only** | Exactly one failing pair exists across all four palettes (table below). Fix `login.js:121` `colors.outline` → `colors.onSurfaceVariant`. The form-branch copy at `login.js:221` was **declined** and stays broken. |
| 15 | **The email mask cannot be reformatted** | It is a client/server contract: `otp-policy.js:104-105` (`head + "•".repeat(max(3, local-head))`), pinned by `otp.test.js:40-44` (mobile ≡ server) and `email-otp.test.js:340-341`. Dot count is dynamic; copy must survive a long mask. |

## Visual spec

### Materials (exact, from `moldedMaterials`)

```
shade     = dark ? rgba(0,0,0,0.48)      : rgba(83,74,53,0.20)
highlight = dark ? rgba(220,240,229,0.07) : rgba(255,255,255,0.92)
inputShade= dark ? rgba(0,0,0,0.40)      : rgba(83,74,53,0.12)

card   : 2px 7px 14px {shade}, inset 1px 2px 5px {highlight}
tile   : 2px 4px 7px {shade}, inset 1px 2px 4px {highlight}
input  : inset 1px 2px 4px {inputShade}, 0 1px 2px {highlight}   ← carved cell
filled : 2px 3px 6px {shade}, inset 1px 2px 3px {highlight}      ← lifted cell (recipe B)
```

### Colours

| Element | Light | Dark |
|---|---|---|
| Stage | `#F5F2EC` | `#0D1713` |
| Card | `#FBF8F3` (`surfaceContainerLow`) | `#151D1A` |
| Tile bg / icon | `primary #285448` / `onPrimary #FFFFFF` | `primary #A6C7B8` / `onPrimary #103A30` |
| Title | `primary #285448` | `primary #A6C7B8` |
| Tagline | `onSurfaceVariant #53615A` | `onSurfaceVariant #C2CBC4` |
| Empty cell (carved) | `surfaceContainerHigh #ECE7DE` | `surfaceContainerLowest #0D1311` |
| Filled cell (lifted) | `surfaceContainerLowest #FFFFFF` | `surfaceContainerHigh #25302B` |
| Focus ring | `primary` + `0 0 0 3px rgba(40,84,72,0.12)` | `primary #A6C7B8` + `rgba(166,199,184,0.16)` |
| Digit | `onSurface #1F2925` | `onSurface #F5F1E9` |
| App tagline footer | `onSurfaceVariant #53615A` (**fixed**) | `outline #97A39C` (already passes) |

Tile/title/tagline colours are not a new choice — they are exactly what the three sibling brand blocks already pass (`backgroundColor={colors.primary}`, `color={colors.onPrimary}`, `color={colors.primary}`, `color={colors.onSurfaceVariant}`).

### Typography

| Role | Spec |
|---|---|
| Title | `moderateScale(28)` / `36`, `fonts.displayBold` (`PlusJakartaSans_700Bold`) |
| Tagline | `moderateScale(16)` / `24`, `fonts.body` (`PlusJakartaSans_400Regular`) |
| Cell digit | `moderateScale(22)`, `fonts.dataSemiBold` (`IBMPlexMono_600SemiBold`) — unchanged |
| Meta row | `moderateScale(14)` / `20` — unified |
| Recovery | `moderateScale(13)` / `18`, `fonts.bodyMedium` |

### Brand block styles (copied verbatim from siblings)

```
brand    : { alignItems: "center", gap: moderateScale(8), marginBottom: moderateScale(4) }
logoTile : { marginBottom: moderateScale(4) }
```

### `AuthHeader` contract

```jsx
<AuthHeader icon="shield-checkmark-outline" title="Verify your identity" tagline={...} />
```

Renders `<View style={styles.brand}>` → `ClayTile` (`icon`, `size="lg"`, `backgroundColor={colors.primary}`, `color={colors.onPrimary}`, `style={styles.logoTile}`) → `Text` title (`color={colors.primary}`) → `Text` tagline (`color={colors.onSurfaceVariant}`). Owns the four styles above; callers pass no layout. It does **not** render the back button — each screen keeps its own.

### Recipe B cell states

`resolveCellBg` branches only on the **idle** path. The behavioural state overrides already in `:215-229` are preserved unchanged:

| State | Behaviour |
|---|---|
| `status === "error"` | existing error tint (`rgba(168,67,64,0.06)` light / `rgba(242,163,156,0.10)` dark) |
| `status === "success"` | existing success tint |
| `status === "verifying"` | existing tints; unfilled cells stay at `opacity: 0.6` |
| focused | **keeps its fill-state material** (carved if empty, lifted if filled) and gains the primary ring + blinking cursor. It must NOT get its own background — a third fill colour would break the depth channel. |
| idle + empty | carved trough — `surfaceContainerHigh #ECE7DE` / `#0D1311` |
| idle + filled | lifted — `surfaceContainerLowest #FFFFFF` / `surfaceContainerHigh #25302B` |

Border colours from `resolveBorderColor` (`:204-213`) are unchanged.

## Contrast audit — all four palettes

| Palette | App tagline (`login.js:121`) | Cooldown (inside card) | Verdict |
|---|---|---|---|
| Light | `#68736D` on `#F5F2EC` — **4.41:1** | `#68736D` on `#FBF8F3` — 4.65:1 | **tagline fails** |
| Dark | `#97A39C` on `#0D1713` — 7.06:1 | `#97A39C` on `#151D1A` — 6.64:1 | passes |
| HC Light | `#000000` on `#FFFFFF` — 21:1 | `#000000` on `#FBF8F3` — ~20:1 | passes |
| HC Dark | `#FFFFFF` on `#000000` — 21:1 | `#FFFFFF` on `#151D1A` — ~17:1 | passes |

Exactly one failure, normal-light only. `colors.outline` → `colors.onSurfaceVariant` (`#53615A`) gives **6.21:1**.

Note: the OTP card's own "Resend in" sits *on the card* at 4.65:1 and already passes — it is not the failure and is left alone.

## Files touched (expected)

| Area | Files |
|---|---|
| New shared component | `mobile/components/auth/AuthHeader.jsx` |
| OTP view | `mobile/components/otp/OtpVerificationView.jsx` (header, drop duplicate notice, merge footer, remove divider, status band untouched) |
| OTP cells | `mobile/components/otp/OtpInput.jsx` (recipe B fills + dash geometry) |
| Auth screens | `mobile/app/login.js` (use `AuthHeader`; drop `mfaNotice` state + `notice={mfaNotice}` at `:111`; `:121` AA fix), `mobile/app/forgot-password.js`, `mobile/app/reset-password.js` (use `AuthHeader`) |

No server, API, migration, RLS or schema-contract work. No new tables/views → `db:status`/`verify:anon`/`db:contract` not in play.

## Verification

1. **Automated:** `npm run test:run` — `otp.test.js` parity and `email-otp.test.js` mask pins must stay green (they are the guard that the mask was not "improved"). `npm run lint` on touched files (repo baseline: 38 errors / 33 warnings, all pre-existing).
2. **Known gap:** `vitest.config.mjs:12` includes `["src/**/*.test.js", "mobile/lib/**/*.test.js"]`. So `mobile/lib` **is** covered — but the `.jsx` components under `mobile/components/**` and `mobile/app/**` are **not**. To get real TDD coverage, recipe B and the dash geometry are extracted into a pure `mobile/lib/otp-cell-style.js` with its own test file; the `.jsx` changes that consume it are verified by ESLint + device. Do not claim unit coverage for the `.jsx` files.
3. **Device, all four palettes:** light, dark, high-contrast light, high-contrast dark — check tile/title/tagline, carved vs lifted cells, focus ring, meta row, footer contrast.
4. **Behavioural regression (must be unchanged):** auto-submit on 6th digit with no confirm button; state machine `ENTERING → COMPLETE → VERIFYING → ERROR → ENTERING ↘ SUCCESS → NAVIGATING`; shake + refocus; ≥500ms loader hold; transport failure preserves the code; back clears state; resend cooldown + expiry countdowns; recovery-code path.
5. **AuthHeader regression:** login, forgot-password and reset-password must render identically to before extraction (the block is byte-identical today — any visual diff is a bug in the extraction).
6. **Dash:** cell 3 shows no stray mark at rest and while focused.
7. **No info-message regression:** the resting card shows no instruction row, but after Resend or an `MFA_REQUIRED` refresh the status band still displays *"A new code is on its way to your registered email."* — removing the `notice` prop must not remove `infoMsg`.

## Out of scope

- **Login-form footer AA failure** (`login.js:221`, `outline` on stage = 4.41:1) — explicitly declined. Record as a known follow-up.
- The email mask format, OTP TTL/cooldown constants, server `otp-policy.js`.
- Back-button restyle: current `44×44` / `borderRadius: 14` already matches the Round 10 radius standard. Downgraded to a non-issue; size 44 vs 40 is a cosmetic nit, not touched.
- High-contrast light card/stage near-collision (`#FBF8F3` card on `#FFFFFF` stage) — pre-existing, app-wide, unverified whether `ClayCard` adds an HC border.
- Password state machine, lockout, or any `src/` auth code.

## Documentation updates (on implementation)

- `Capstone/04 - Architecture/Authentication.md` — §OTP verification: correct the claim at `:303` that "a security shield badge" exists (it does not; the sole shield today is the recovery-mode input icon at `:319`). Document the new `AuthHeader` and the family block.
- `Capstone/04 - Architecture/Mobile Architecture.md` — clay component inventory gains `AuthHeader`; OTP cell material model (recipe B).
- `Capstone/01 - System/UI UX Audit - Mobile.md` — record the OTP pass, the dash geometry bug and its fix, and the one remaining AA failure at `login.js:221`.
- `Capstone/06 - Decisions/Decision Log.md` — recipe B over A/C (depth over hue as the progress channel); OTP-branch-only AA scope.
- `Capstone/01 - System/System.md` — changelog line.
- `Capstone/07 - Development/OTP Verification Modal Plan.md` — mark superseded by this design where it disagrees.

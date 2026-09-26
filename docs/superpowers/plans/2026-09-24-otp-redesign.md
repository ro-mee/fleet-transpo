# OTP Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the mobile OTP step the auth family's brand block, a depth-based clay cell treatment, a two-row footer and one AA fix — with zero change to verification behaviour.

**Architecture:** Extract the byte-identical auth brand block into a shared `AuthHeader`; extract OTP cell presentation into a pure `mobile/lib` module (so it is unit-testable, because `.jsx` files are outside vitest's include); then rewire `OtpInput`, `OtpVerificationView` and `login.js` to consume those. No server, schema, migration or `src/` auth changes.

**Tech Stack:** Expo SDK 54 (`expo ~54.0.8`), expo-router ~6.0.24, React Native 0.81.5, Hermes, vitest (`mobile/lib` suite), ESLint `--max-warnings 0`

## Global Constraints

- **Verification logic is frozen:** state machine `ENTERING → COMPLETE → VERIFYING → ERROR → ENTERING ↘ SUCCESS → NAVIGATING`, auto-submit on the 6th digit with no confirm button, ≥500ms loader hold (`OTP_VERIFY_MIN_MS`), transport failure preserves the code, back clears state, resend cooldown + expiry countdowns, recovery-code path. None of it may change.
- **The email mask is a client/server contract** — do not reformat. Formula `head + "•".repeat(max(3, local.length - head.length))` at `src/lib/auth/otp-policy.js:104-105`, pinned by `mobile/lib/otp.test.js:40-44` (mobile ≡ server) and `src/lib/auth/email-otp.test.js:340-341`. Those tests must stay green.
- **AA fix is scoped to the OTP branch only:** `mobile/app/login.js:121` `colors.outline` → `colors.onSurfaceVariant`. `mobile/app/login.js:221` was explicitly declined and **stays broken**.
- **Card padding stays OTP's own `18/14`** (`OtpVerificationView.jsx:501-504`); siblings keep `20/16`.
- **Status band `minHeight: 26` stays** (`OtpVerificationView.jsx:505-508`) — collapsing it makes the footer jump on errors.
- **Type specs:** title `moderateScale(28)/36` `fonts.displayBold`; tagline `moderateScale(16)/24` `fonts.body`; meta row `moderateScale(14)/20`; cell digit `moderateScale(22)` `fonts.dataSemiBold` (unchanged).
- **All four palettes must work:** light, dark, high-contrast light, high-contrast dark. Switch via Settings → Appearance (moon = dark, contrast = high-contrast).
- **Every task ends warning-clean:** `npx eslint <touched files> --max-warnings 0`, and `npx vitest run mobile/lib` stays green.
- `mobile/components/**` and `mobile/app/**` `.jsx`/`.js` UI files are **outside** `vitest.config.mjs:12` (`["src/**/*.test.js", "mobile/lib/**/*.test.js"]`) — do not claim unit coverage for them.

---

### Task 1: Extract shared `AuthHeader`

**Files:**
- Create: `mobile/components/auth/AuthHeader.jsx`
- Modify: `mobile/app/login.js:143-155` (brand block), `:18` (import), `:237-254` (dead styles)
- Modify: `mobile/app/forgot-password.js:90-102`, `:17`, `:165-182`
- Modify: `mobile/app/reset-password.js:110-122`, `:17`, `:219-237`

**Interfaces:**
- Consumes: `ClayTile` from `mobile/components/clay/index.js`, `useTheme()`, `fonts` from `mobile/lib/theme`, `moderateScale` from `mobile/lib/scaling`.
- Produces: `<AuthHeader icon={string} title={string} tagline={string} />` — renders the brand block only, **no back button**. Consumed by Task 4 (`OtpVerificationView`).

- [ ] **Step 1: Write `AuthHeader`**

```jsx
// mobile/components/auth/AuthHeader.jsx
import { StyleSheet, Text, View } from "react-native";
import { ClayTile } from "../clay";
import { useTheme } from "../../lib/theme-context";
import { fonts } from "../../lib/theme";
import { moderateScale } from "../../lib/scaling";

/**
 * AuthHeader — the shared FleetOps auth brand block.
 *
 * Extracted from the block that was duplicated byte-for-byte across
 * login / forgot-password / reset-password. It deliberately does NOT render
 * a back button: every screen keeps its own, above this block.
 */
export function AuthHeader({ icon, title, tagline }) {
  const { colors } = useTheme();
  return (
    <View style={styles.brand}>
      <ClayTile
        icon={icon}
        size="lg"
        backgroundColor={colors.primary}
        color={colors.onPrimary}
        style={styles.logoTile}
      />
      <Text style={[styles.appName, { color: colors.primary }]}>{title}</Text>
      <Text style={[styles.tagline, { color: colors.onSurfaceVariant }]}>{tagline}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    alignItems: "center",
    gap: moderateScale(8),
    marginBottom: moderateScale(4),
  },
  logoTile: {
    marginBottom: moderateScale(4),
  },
  appName: {
    fontSize: moderateScale(28),
    fontFamily: fonts.displayBold,
    lineHeight: moderateScale(36),
    textAlign: "center",
  },
  tagline: {
    fontSize: moderateScale(16),
    fontFamily: fonts.body,
    lineHeight: moderateScale(24),
    textAlign: "center",
  },
});
```

> **Known, deliberate deviation:** `appName`/`tagline` gain `textAlign: "center"`. Single-line renders are pixel-identical to today; a *wrapped* tagline now centres instead of left-aligning under a centred title. The OTP tagline wraps (long mask), so this is required there — and it matches what `reset-password.js:236` already does.

- [ ] **Step 2: Baseline the suite before refactoring**

Run: `npx vitest run mobile/lib`
Expected: PASS (baseline — capture the count; it must not drop)

- [ ] **Step 3: Swap the login brand block**

In `mobile/app/login.js`, add `AuthHeader` to the component import and drop the now-unused `ClayTile`:

```js
import { ClayCard, ClayButton, ClayInput } from "../components/clay";
import { AuthHeader } from "../components/auth/AuthHeader";
```

Replace lines 142-155 (the `{/* ─── Branding ─── */}` block through `</View>`) with:

```jsx
        {/* ─── Branding ─── */}
        <AuthHeader
          icon="car-sport"
          title="FleetOps"
          tagline="Driver Portal Access"
        />
```

Delete the now-unused `brand`, `logoTile`, `appName`, `tagline` entries from `styles` (lines 237-254).

- [ ] **Step 4: Swap the forgot-password brand block**

Same import change in `mobile/app/forgot-password.js`. Replace lines 89-102 with:

```jsx
        <AuthHeader
          icon="key-outline"
          title="Reset Password"
          tagline="Enter your account email to start recovery"
        />
```

Delete `brand`, `logoTile`, `appName`, `tagline` from `styles` (lines 165-182).

- [ ] **Step 5: Swap the reset-password brand block**

Same import change in `mobile/app/reset-password.js`. Replace lines 109-122 with:

```jsx
        <AuthHeader
          icon="shield-checkmark-outline"
          title="New Password"
          tagline="Enter the reset code from your email"
        />
```

Delete `brand`, `logoTile`, `appName`, `tagline` from `styles` (lines 219-237).

- [ ] **Step 6: Run the suite**

Run: `npx vitest run mobile/lib`
Expected: PASS (same count as Step 2 — a refactor must not move it)

- [ ] **Step 7: Lint the touched files**

Run: `npx eslint "mobile/components/auth/AuthHeader.jsx" "mobile/app/login.js" "mobile/app/forgot-password.js" "mobile/app/reset-password.js" --max-warnings 0`
Expected: no output, exit 0. (An unused `ClayTile` import would fail here.)

- [ ] **Step 8: Device check — no visual regression**

Run the app, visit Login, Forgot Password and Reset Password in **light** mode.
Expected: each renders its tile + title + tagline exactly as before. Any diff means the extraction is wrong.

- [ ] **Step 9: Commit**

```bash
git add mobile/components/auth/AuthHeader.jsx mobile/app/login.js mobile/app/forgot-password.js mobile/app/reset-password.js
git commit -m "refactor(auth): extract shared AuthHeader brand block"
```

---

### Task 2: Pure OTP cell presentation module (recipe B + dash geometry)

**Files:**
- Create: `mobile/lib/otp-cell-style.js`
- Test: `mobile/lib/otp-cell-style.test.js` (new)

**Interfaces:**
- Consumes: nothing (pure module — takes a `colors` object as an argument).
- Produces:
  - `otpCellFill({ status, filled, isDark, colors }) → string` (a CSS colour)
  - `OTP_DASH = { rowGap: 8, separatorLeft: -8, separatorWidth: 8, dashWidth: 7 }`
  Both consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```js
// mobile/lib/otp-cell-style.test.js
import { describe, it, expect } from "vitest";
import { otpCellFill, OTP_DASH } from "./otp-cell-style.js";

const light = { surfaceContainerLowest: "#FFFFFF", surfaceContainerHigh: "#ECE7DE" };
const dark = { surfaceContainerLowest: "#0D1311", surfaceContainerHigh: "#25302B" };

describe("otpCellFill — recipe B depth channel", () => {
  it("separates empty from filled in light (the root-cause fix)", () => {
    const empty = otpCellFill({ status: "idle", filled: false, isDark: false, colors: light });
    const filled = otpCellFill({ status: "idle", filled: true, isDark: false, colors: light });
    expect(empty).toBe("#ECE7DE");
    expect(filled).toBe("#FFFFFF");
    expect(empty).not.toBe(filled);
  });

  it("separates empty from filled in dark", () => {
    expect(otpCellFill({ status: "idle", filled: false, isDark: true, colors: dark })).toBe("#0D1311");
    expect(otpCellFill({ status: "idle", filled: true, isDark: true, colors: dark })).toBe("#25302B");
  });

  it("keeps the existing error and success tints untouched", () => {
    expect(otpCellFill({ status: "error", filled: false, isDark: false, colors: light })).toBe("rgba(168,67,64,0.06)");
    expect(otpCellFill({ status: "error", filled: true, isDark: true, colors: dark })).toBe("rgba(242,163,156,0.10)");
    expect(otpCellFill({ status: "success", filled: false, isDark: false, colors: light })).toBe("rgba(40,107,84,0.08)");
    expect(otpCellFill({ status: "success", filled: true, isDark: true, colors: dark })).toBe("rgba(130,190,163,0.12)");
  });

  it("gives a focused cell its fill-state material, never a third colour", () => {
    // `focused` is intentionally not a parameter: focus changes the ring, not the fill.
    expect(otpCellFill({ status: "idle", filled: false, isDark: false, colors: light })).toBe("#ECE7DE");
    expect(otpCellFill({ status: "idle", filled: true, isDark: false, colors: light })).toBe("#FFFFFF");
  });

  it("verifying keeps the depth channel (opacity handles the dimming)", () => {
    expect(otpCellFill({ status: "verifying", filled: true, isDark: false, colors: light })).toBe("#FFFFFF");
    expect(otpCellFill({ status: "verifying", filled: false, isDark: false, colors: light })).toBe("#ECE7DE");
  });
});

describe("OTP_DASH — the separator must fit its slot", () => {
  it("never lets the dash overflow the row gap", () => {
    expect(OTP_DASH.dashWidth).toBeLessThanOrEqual(OTP_DASH.rowGap);
    expect(OTP_DASH.separatorWidth).toBe(OTP_DASH.rowGap);
    expect(OTP_DASH.separatorLeft).toBe(-OTP_DASH.rowGap);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run mobile/lib/otp-cell-style.test.js`
Expected: FAIL — `Failed to load ./otp-cell-style.js` / `Cannot find module`

- [ ] **Step 3: Write the minimal implementation**

```js
// mobile/lib/otp-cell-style.js

/**
 * OTP_DASH — geometry for the 3|4 group separator.
 *
 * The bug this replaces: the row used `gap: 6` while the separator box was
 * `width: 12` at `left: -12` holding a 7px dash — twice the size of the slot
 * it sits in, so the dash overran cell 3. The box now equals the gap and the
 * dash fits inside it with 0.5px clearance either side.
 *
 * Raw dp; the component wraps each value in `moderateScale()`.
 */
export const OTP_DASH = {
  rowGap: 8,
  separatorLeft: -8,
  separatorWidth: 8,
  dashWidth: 7,
};

/**
 * otpCellFill — recipe B: depth, not hue, carries progress.
 *
 * Filled cells lift (`surfaceContainerLowest` / `surfaceContainerHigh`),
 * empty cells are carved the other way. Error and success keep their
 * pre-existing tints — those are behavioural states, not the progress channel.
 *
 * `focused` is deliberately absent: focus draws the ring and cursor, it must
 * never introduce a third fill colour or the depth channel stops meaning
 * "filled vs empty".
 */
export function otpCellFill({ status, filled, isDark, colors }) {
  if (status === "error") {
    return isDark ? "rgba(242,163,156,0.10)" : "rgba(168,67,64,0.06)";
  }
  if (status === "success") {
    return isDark ? "rgba(130,190,163,0.12)" : "rgba(40,107,84,0.08)";
  }
  if (filled) {
    return isDark ? colors.surfaceContainerHigh : colors.surfaceContainerLowest;
  }
  return isDark ? colors.surfaceContainerLowest : colors.surfaceContainerHigh;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run mobile/lib/otp-cell-style.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Lint**

Run: `npx eslint "mobile/lib/otp-cell-style.js" "mobile/lib/otp-cell-style.test.js" --max-warnings 0`
Expected: no output, exit 0

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/otp-cell-style.js mobile/lib/otp-cell-style.test.js
git commit -m "feat(otp): add pure cell-fill and dash-geometry module"
```

---

### Task 3: Rewire `OtpInput` to the new material model

**Files:**
- Modify: `mobile/components/otp/OtpInput.jsx:1-13` (import), `:215-229` (`resolveCellBg`), `:243` (call site), `:370-396` (`row`/`separator`/`separatorDash` styles)

**Interfaces:**
- Consumes: `otpCellFill`, `OTP_DASH` from Task 2 (`mobile/lib/otp-cell-style.js`).
- Produces: no new exports — purely visual wiring. Task 4 relies on this file's behaviour being unchanged apart from fills and dash.

- [ ] **Step 1: Baseline (characterization — no new unit test; `.jsx` is outside vitest)**

Run: `npx vitest run mobile/lib`
Expected: PASS (same count as before — proves the guard rails are intact before touching the component)

- [ ] **Step 2: Import the new module**

Add to `mobile/components/otp/OtpInput.jsx` after the existing `mobile/lib` imports:

```js
import { OTP_DASH, otpCellFill } from "../../lib/otp-cell-style";
```

- [ ] **Step 3: Replace `resolveCellBg` with the pure helper**

Delete the whole `resolveCellBg` function (lines 215-229). Leave `resolveBorderColor` (lines 204-213) completely untouched — border colours are unchanged.

Change the call site (line 243) from:

```js
          const cellBg = resolveCellBg(focused, filled);
```

to:

```js
          const cellBg = otpCellFill({ status, filled, isDark, colors });
```

- [ ] **Step 4: Give filled cells a visible lift**

On the `cellShadow` `Animated.View` (lines 263-274), add a filled-only shadow so the lift reads even where the two fills are close in value:

```jsx
              <Animated.View
                style={[
                  styles.cellShadow,
                  filled &&
                    !focused &&
                    status === "idle" && {
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: isDark ? 0.32 : 0.16,
                      shadowRadius: 4,
                      elevation: 2,
                    },
                  focused && {
                    shadowColor: colors.primary,
                    shadowOpacity: isDark ? 0.35 : 0.2,
                    shadowRadius: 5,
                    elevation: 3,
                  },
                  { transform: [{ scale: popAnims.current[index] || 1 }] },
                ]}
              >
```

- [ ] **Step 5: Fix the dash geometry**

Replace the three style entries (lines 370-396):

```js
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: moderateScale(OTP_DASH.rowGap),
    width: "100%",
  },
  cellWrapper: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    maxWidth: moderateScale(44),
  },
  separator: {
    position: "absolute",
    left: moderateScale(OTP_DASH.separatorLeft),
    width: moderateScale(OTP_DASH.separatorWidth),
    height: moderateScale(48),
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  separatorDash: {
    width: moderateScale(OTP_DASH.dashWidth),
    height: 2,
    borderRadius: 1,
  },
```

- [ ] **Step 6: Run the suite**

Run: `npx vitest run mobile/lib`
Expected: PASS (count unchanged)

- [ ] **Step 7: Lint**

Run: `npx eslint "mobile/components/otp/OtpInput.jsx" --max-warnings 0`
Expected: no output, exit 0. (`resolveCellBg` is deleted — a leftover reference fails here.)

- [ ] **Step 8: Device check**

Run the app → Settings → Appearance, check **light** and **dark**:
- Empty cells read as carved troughs, filled cells as lifted — you can tell progress without reading the digits.
- No stray mark over cell 3 at rest or while focused.
- Error (wrong code) and success tints look unchanged.
- Focus ring and blinking cursor still present.

- [ ] **Step 9: Commit**

```bash
git add mobile/components/otp/OtpInput.jsx
git commit -m "fix(otp): carve empty cells, lift filled cells, fit dash to its gap"
```

---

### Task 4: Restructure `OtpVerificationView` + `login.js`

**Files:**
- Modify: `mobile/components/otp/OtpVerificationView.jsx:1-27` (imports/props), `:58` (`infoMsg` seed), `:272-303` (intro → `AuthHeader`), `:380-431` (divider + timer + resend → meta row), `:469-485` and `:529-567` (dead styles)
- Modify: `mobile/app/login.js:31`, `:61-62`, `:111`, `:115-118`, `:121`

**Interfaces:**
- Consumes: `AuthHeader` from Task 1 (`icon`, `title`, `tagline`).
- Produces: no new exports. `notice` prop is removed — `login.js` must stop passing it in the same task (Step 5), or the prop becomes dead.

- [ ] **Step 1: Baseline (characterization)**

Run: `npx vitest run mobile/lib`
Expected: PASS (count unchanged)

- [ ] **Step 2: Import `AuthHeader`, drop the `notice` prop, stop seeding `infoMsg`**

In `mobile/components/otp/OtpVerificationView.jsx` add:

```js
import { AuthHeader } from "../auth/AuthHeader";
```

Change the props signature (lines 44-51) — remove `notice`:

```jsx
export function OtpVerificationView({
  identifier = "",
  onVerify,
  onResend,
  onVerified,
  onBack,
}) {
```

Change line 58 from `useState(notice || null)` to:

```js
  const [infoMsg, setInfoMsg] = useState(null);
```

> `infoMsg` **stays** — the component still assigns it itself at `:160` and `:202` ("A new code is on its way…"). Only the initial seed from the prop goes away. Removing the state entirely would silence Resend.

- [ ] **Step 3: Replace the intro block with `AuthHeader`**

Delete lines 272-303 (the whole `{/* ─── Intro ─── */}` `View`). Replace with:

```jsx
      {/* ─── Brand block + single instruction ─── */}
      <AuthHeader
        icon="shield-checkmark-outline"
        title="Verify your identity"
        tagline={
          masked
            ? `Enter the ${OTP_CODE_DIGITS}-digit code sent to ${masked}`
            : `Enter the ${OTP_CODE_DIGITS}-digit code sent to your registered email`
        }
      />
```

Delete the now-unused `styles.intro`, `styles.title`, `styles.description`, `styles.emailPill`, `styles.maskedEmail`.

- [ ] **Step 4: Merge the footer into one meta row, drop the divider**

Delete lines 380-431 (the divider `View`, the timer `View`, the resend `View`). Replace with:

```jsx
        {/* ─── Meta: expiry and resend share one row ─── */}
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons
              name="time-outline"
              size={15}
              color={expired ? colors.error : colors.onSurfaceVariant}
            />
            <Text
              style={[
                styles.metaText,
                { color: expired ? colors.error : colors.onSurfaceVariant },
              ]}
            >
              {expired ? "Code expired" : `Expires in ${formatCountdown(remainingSec)}`}
            </Text>
          </View>

          {resending ? (
            <View style={styles.metaItem}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.metaText, { color: colors.primary }]}>Sending…</Text>
            </View>
          ) : canResend ? (
            <Pressable
              onPress={handleResend}
              accessibilityRole="button"
              accessibilityLabel="Resend verification code"
              style={styles.metaTap}
            >
              <Text style={[styles.metaText, styles.metaLink, { color: colors.primary }]}>
                Resend
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.metaText, { color: colors.outline }]}>
              Resend in {formatCountdown(cooldownSec)}
            </Text>
          )}
        </View>
```

> The expired copy shortens from *"Code expired — resend a new code below"* to *"Code expired"* because Resend now sits on the same row — the "below" instruction was only there because it used to be three rows down.

Delete `styles.divider`, `styles.timerRow`, `styles.timerText`, `styles.resendRow`, `styles.resendHint`, `styles.resendTap`, `styles.resendLink`. **Keep** `styles.statusArea`, `statusRow`, `statusText`, `checkBadge`, `recoveryTap`, `recoveryText`, `root`, `header`, `backBtn`, `card`.

Add:

```js
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: moderateScale(8),
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(6),
    flexShrink: 1,
  },
  metaText: {
    fontSize: moderateScale(14),
    fontFamily: fonts.body,
    lineHeight: moderateScale(20),
    flexShrink: 1,
    textAlign: "center",
  },
  metaLink: {
    fontFamily: fonts.bodySemiBold,
  },
  metaTap: {
    paddingVertical: moderateScale(8),
    paddingHorizontal: moderateScale(6),
    minHeight: moderateScale(40),
    justifyContent: "center",
  },
```

`styles.card` and `styles.statusArea` are **not** touched (padding stays `18/14`; band stays `minHeight: 26`).

- [ ] **Step 5: Remove `mfaNotice` from `login.js` and apply the AA fix**

All four `mfaNotice` sites and the contrast fix in `mobile/app/login.js`:

```js
// line 31 — delete the whole line
  const [mfaNotice, setMfaNotice] = useState(null);
```

```js
// lines 61-62 — keep setMfaRequired, drop setMfaNotice
        setMfaRequired(true);
```

```jsx
// line 111 — delete the notice prop
          <OtpVerificationView
            identifier={username.trim()}
            onVerify={handleVerifyOtp}
```

```jsx
// lines 115-118
            onBack={() => {
              setMfaRequired(false);
            }}
```

```jsx
// line 121 — the single in-scope AA fix (4.41:1 → 6.21:1)
          <Text style={[styles.footer, { color: colors.onSurfaceVariant }]}>
            FleetOps Tactical Driver Companion
          </Text>
```

> `login.js:221` (the form-branch copy of the same footer) is **out of scope by decision** — do not change it.

- [ ] **Step 6: Run the suite**

Run: `npx vitest run mobile/lib`
Expected: PASS — includes `mobile/lib/otp.test.js` mask-parity pins (they must still be green; the mask was not touched)

- [ ] **Step 7: Lint**

Run: `npx eslint "mobile/components/otp/OtpVerificationView.jsx" "mobile/app/login.js" --max-warnings 0`
Expected: no output, exit 0. (A leftover `notice` reference or unused `Ionicons`/`formatCountdown` import fails here.)

- [ ] **Step 8: Device check — all four palettes**

Settings → Appearance: toggle **dark**, then **high-contrast**, and repeat in **light**. On the OTP step confirm:

- Shield tile + 28px title + tagline where the duplicated instruction used to be — exactly one instruction, no card info row.
- One meta row: expiry left, resend right; recovery below; **no divider**.
- Reserved band does not move the card when "Verifying code…", an error or "A new code is on its way…" appears.
- App tagline footer is legible in all four palettes.

- [ ] **Step 9: Device check — behaviour unchanged (frozen per Global Constraints)**

- Type 6 digits → auto-verifies with no confirm button; loader holds ≥500ms.
- Wrong code → shake, refocus, error tint, code cleared.
- Kill the network mid-verify → error shown, **the typed code is still there**.
- Back → returns to the login form with no OTP residue.
- Resend → cooldown restarts, expiry resets, "A new code is on its way…" appears in the band.
- Cooldown elapses → right side becomes a tappable `Resend`.
- Recovery link → swaps to the recovery `ClayInput`; "Back to code entry" returns.

- [ ] **Step 10: Commit**

```bash
git add mobile/components/otp/OtpVerificationView.jsx mobile/app/login.js
git commit -m "feat(otp): family brand block, one instruction, two-row footer"
```

---

## Spec coverage check

| Spec section | Task |
|---|---|
| Decisions 2, 3 (AuthHeader, family block) | 1 |
| Decision 4 (title 24→28) | 1 (in `AuthHeader` `appName`) |
| Decision 7 + Colours (recipe B) | 2, 3 |
| Decision 8 (dark tokens) | 2 (token-driven, not literals) |
| Decision 9 (tagline copy) | 4 |
| Decision 10 (dash fix) | 2, 3 |
| Decisions 11, 12, 13 (status band, 14px, card padding) | 4 |
| Decision 14 (AA fix `:121`) | 4 |
| Decision 15 (mask untouched) | verified by `otp.test.js` in Tasks 2-4 |
| Decision 5 (one instruction / `notice` removal) | 4 |
| Contrast audit + `AuthHeader` contract + Recipe B state table | Tasks 1-4 above |

## Out of scope (do not do these)

- `mobile/app/login.js:221` AA fix — declined.
- Back-button restyle — already `44×44`/radius `14`; non-issue.
- Mask format, OTP TTL/cooldown constants, any `src/` auth code.
- High-contrast light card/stage near-collision — pre-existing, app-wide.

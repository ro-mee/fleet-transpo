/**
 * Biometric app-lock storage for the FleetOps driver app.
 *
 * ## What this file does NOT do
 *
 * FleetOps never collects, reads, transmits or stores biometric data. There is
 * no fingerprint, face scan, template or image anywhere in this module, and
 * nothing here ever reaches the backend — there is no biometric endpoint, no
 * biometric token, and no second refresh-token family. The OS performs the
 * match and hands back a result; that is the entire input.
 *
 * ## What the gated item actually holds
 *
 * A **non-secret, device-local unlock sentinel**. Reading it is the whole
 * point: the OS refuses the read until it has authenticated the driver, so the
 * *success of the read* is the assertion. Its contents are deliberately
 * meaningless and are never sent anywhere, never compared against anything
 * server-side, and never used as a credential.
 *
 * The sentinel is **not** the session. The refresh token stays in
 * `fleetops_refresh_token` (see storage.js) for two load-bearing reasons:
 *
 * 1. On Android `requireAuthentication` puts the keystore key behind
 *    `setUserAuthenticationRequired(true)`, which gates **every** operation
 *    including writes — re-sealing a copy after each 15-minute rotation would
 *    prompt the driver every 15 minutes.
 * 2. Re-sealing only at lock time hands back a superseded token, and refresh
 *    rotation is single-use: presenting a consumed token wipes the entire
 *    family server-side (`src/app/api/mobile/auth/refresh/route.js`), forcing a
 *    password + OTP sign-in. Leaving the token readable is also what keeps
 *    background trip GPS (`mobile/lib/tracking.js`) alive while locked.
 *
 * So this is an **OS-enforced application lock**, not encryption of the
 * session token. That distinction is stated plainly in the threat model rather
 * than glossed over.
 *
 * ## Why a separate keychain service
 *
 * `expo-secure-store` documents that a `requireAuthentication` item "would not
 * work in tandem with the `keychainService` value used for the others
 * non-authenticated operations". The gated sentinel therefore uses its own
 * service; the ungated metadata uses the default one so the lock screen can
 * render its label without raising a prompt.
 */

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { methodFromTypes, authenticationPrompt } from "./biometric-method";
import { BIOMETRIC_STATE, classifyThrown, describeCapability, messageFor } from "./biometric-errors";

/** Gated item: unreadable without a successful OS authentication. */
const SENTINEL_KEY = "fleetops_biometric_sentinel";
/** Android keystore alias / iOS `kSecAttrService`, kept apart from the session keys. */
const BIOMETRIC_KEYCHAIN_SERVICE = "fleetops.biometric";

/** Ungated item: drives the lock screen and the settings row without a prompt. */
const META_KEY = "fleetops_biometric_meta";

/** Bumped if the metadata shape ever changes, so a stale blob is discarded. */
const META_VERSION = 1;

/**
 * The stored value. Cosmetic only — see the module note: possession of this
 * string is not a credential and proves nothing, because the OS will not hand
 * it over without authenticating the driver first. A random value is used when
 * the platform offers a CSPRNG purely so the item does not read as a shared
 * constant during inspection; the constant fallback changes nothing about the
 * security properties.
 */
const SENTINEL_FALLBACK = "fleetops-app-lock-sentinel";

function makeSentinelValue() {
  try {
    const bytes = new Uint8Array(16);
    const crypto = globalThis.crypto;
    if (typeof crypto?.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // ignored — the value is not security-relevant
  }
  return SENTINEL_FALLBACK;
}

// ---------------------------------------------------------------------------
// Metadata (ungated)
// ---------------------------------------------------------------------------

/**
 * Reads the enrollment metadata. Never throws: an unreadable or malformed blob
 * is reported as "not enabled" so a corrupt store cannot present a lock the
 * driver can never satisfy.
 *
 * @returns {Promise<object|null>}
 */
export async function getMeta() {
  try {
    const raw = await SecureStore.getItemAsync(META_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw);
    if (!meta || typeof meta !== "object") return null;
    if (meta.version !== META_VERSION) return null;
    if (meta.enabled !== true) return null;
    if (typeof meta.employeeId !== "string" || !meta.employeeId) return null;
    return meta;
  } catch {
    return null;
  }
}

/**
 * True when biometric lock is currently switched on for this device — cheap,
 * ungated, and safe to call during render or on cold start.
 *
 * @returns {Promise<boolean>}
 */
export async function isBiometricEnabled() {
  return (await getMeta()) !== null;
}

async function setMeta(meta) {
  await SecureStore.setItemAsync(META_KEY, JSON.stringify({ ...meta, version: META_VERSION }));
}

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

/**
 * Whether the platform's secure store can actually enforce a biometric gate
 * here. Web has no SecureStore at all, so the lock is never offered there.
 */
async function isSecureStorageAvailable() {
  if (Platform.OS === "web") return false;
  try {
    if (typeof SecureStore.canUseBiometricAuthentication === "function") {
      // Synchronous, on both Android and iOS: `true` only when the device has a
      // biometric enrolled *and* it is strong enough to gate a keychain item.
      // That is exactly the question being asked here, so a `false` is trusted
      // rather than second-guessed — offering an enable toggle that cannot work
      // is worse than not offering it.
      return SecureStore.canUseBiometricAuthentication() !== false;
    }
  } catch {
    // ignored — fall through to the platform assumption below
  }
  return Platform.OS === "ios" || Platform.OS === "android";
}

/**
 * The full device-support verdict for the settings screen: whether biometric
 * login can be offered, why not when it cannot, and which modality to name.
 *
 * @returns {Promise<{ available: boolean, state: string, message: string, method: string,
 *                     hasHardware: boolean, isEnrolled: boolean, secureStorageAvailable: boolean }>}
 */
export async function getCapability() {
  const secureStorageAvailable = await isSecureStorageAvailable();
  let hasHardware = false;
  let isEnrolled = false;
  let types = [];

  if (secureStorageAvailable) {
    try {
      hasHardware = (await LocalAuthentication.hasHardwareAsync()) === true;
      if (hasHardware) {
        isEnrolled = (await LocalAuthentication.isEnrolledAsync()) === true;
        types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      }
    } catch {
      // A probe that throws tells us nothing good; report no hardware rather
      // than optimistically offering a lock that cannot be satisfied.
      hasHardware = false;
      isEnrolled = false;
      types = [];
    }
  }

  const method = methodFromTypes(types);
  const verdict = describeCapability({ hasHardware, isEnrolled, secureStorageAvailable });
  return { ...verdict, method, hasHardware, isEnrolled, secureStorageAvailable };
}

// ---------------------------------------------------------------------------
// Enable / disable
// ---------------------------------------------------------------------------

/**
 * Turns biometric login on for the signed-in driver.
 *
 * Requires an authenticated session to exist (the caller checks that) and
 * proves the driver is present with an explicit OS prompt **before** anything
 * is written, so a device left unlocked on a depot bench cannot be enrolled by
 * whoever picks it up.
 *
 * @param {{ employeeId: string, driverId?: string|null, firstName?: string|null }} identity
 * @returns {Promise<{ ok: boolean, state: string, message: string, meta?: object }>}
 */
export async function enable({ employeeId, driverId = null, firstName = null } = {}) {
  if (!employeeId) {
    return { ok: false, state: BIOMETRIC_STATE.UNKNOWN_ERROR, message: "Sign in again before enabling biometric login." };
  }

  const capability = await getCapability();
  if (!capability.available) {
    return { ok: false, state: capability.state, message: capability.message };
  }

  // Deliberate confirmation. `disableDeviceFallback` keeps the OS from
  // accepting the phone's PIN or pattern in place of a biometric — the brief
  // forbids a passcode fallback, and a device passcode would be a weaker,
  // different factor than the one being enrolled.
  try {
    const prompt = await LocalAuthentication.authenticateAsync({
      promptMessage: "Enable biometric login",
      cancelLabel: "Cancel",
      disableDeviceFallback: true,
    });
    if (prompt?.success !== true) {
      const classified = classifyThrown({ code: prompt?.error, message: prompt?.error });
      return { ok: false, state: classified.state, message: classified.message };
    }
  } catch (error) {
    const classified = classifyThrown(error);
    return { ok: false, state: classified.state, message: classified.message };
  }

  const meta = {
    enabled: true,
    employeeId,
    driverId: driverId ?? null,
    firstName: firstName ?? null,
    method: capability.method,
    enrolledAt: new Date().toISOString(),
    lastUnlockAt: null,
  };

  try {
    // Android gates the write behind the keystore too, so this can raise a
    // second prompt on that platform. Roll back cleanly if the driver backs
    // out, rather than leaving a sentinel with no metadata (or the reverse).
    await SecureStore.setItemAsync(SENTINEL_KEY, makeSentinelValue(), {
      requireAuthentication: true,
      keychainService: BIOMETRIC_KEYCHAIN_SERVICE,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      authenticationPrompt: authenticationPrompt("Confirm it is you to enable biometric login."),
    });
    await setMeta(meta);
    return { ok: true, state: BIOMETRIC_STATE.SUCCESS, message: "Biometric login is on.", meta };
  } catch (error) {
    await clearBiometric().catch(() => {});
    const classified = classifyThrown(error);
    return { ok: false, state: classified.state, message: classified.message };
  }
}

/**
 * Turns biometric login off and destroys the gated item.
 *
 * Idempotent, so it is safe on paths that may run more than once (sign-out,
 * enrollment change, a failed enable).
 *
 * @returns {Promise<{ ok: boolean, state: string, message: string }>}
 */
export async function disable() {
  await clearBiometric();
  return { ok: true, state: BIOMETRIC_STATE.SUCCESS, message: "Biometric login is off." };
}

/**
 * Deletes both items — the OS-gated sentinel and the metadata.
 *
 * Called on Sign Out and whenever the platform invalidates the enrollment. It
 * never falls back to storing anything in a less protected place: if the
 * gated item cannot exist, biometric login simply does not.
 */
export async function clearBiometric() {
  await Promise.all([
    SecureStore.deleteItemAsync(SENTINEL_KEY, { keychainService: BIOMETRIC_KEYCHAIN_SERVICE }).catch(() => {}),
    SecureStore.deleteItemAsync(META_KEY).catch(() => {}),
  ]);
}

// ---------------------------------------------------------------------------
// Unlock
// ---------------------------------------------------------------------------

/**
 * Attempts a biometric unlock by reading the gated sentinel.
 *
 * There is no separate `authenticateAsync` call: the SecureStore read *is* the
 * prompt, and calling both would ask the driver twice for one unlock.
 *
 * A settled read that comes back empty means the platform destroyed the item —
 * on iOS `biometryCurrentSet` invalidates it the moment the enrolled biometric
 * set changes, which is how an added fingerprint on a seized phone stops
 * working. That is treated as `CREDENTIAL_INVALIDATED`: biometric login is
 * switched off locally, the driver keeps their existing session, and the lock
 * screen's password path takes over. It never silently downgrades to an
 * unprotected local credential.
 *
 * @param {{ reason?: string }} [options]
 * @returns {Promise<{ ok: boolean, state: string, message: string }>}
 */
export async function verifyUnlock({ reason = "Confirm it is you to unlock FleetOps." } = {}) {
  const meta = await getMeta();
  if (!meta) {
    return {
      ok: false,
      state: BIOMETRIC_STATE.BIOMETRIC_UNAVAILABLE,
      message: messageFor(BIOMETRIC_STATE.BIOMETRIC_UNAVAILABLE),
    };
  }

  let value;
  try {
    value = await SecureStore.getItemAsync(SENTINEL_KEY, {
      requireAuthentication: true,
      keychainService: BIOMETRIC_KEYCHAIN_SERVICE,
      authenticationPrompt: authenticationPrompt(reason),
    });
  } catch (error) {
    // A cancel, lockout or failed match arrives here. Note that this does NOT
    // disable biometric login: the driver may simply have missed the prompt,
    // and the next attempt should still be allowed to work.
    return { ok: false, ...classifyThrown(error) };
  }

  if (!value) {
    // The OS released the read but there was nothing there — enumeration
    // changed or the item was removed. Fail closed and stop offering a lock
    // that can no longer be satisfied.
    await clearBiometric();
    return {
      ok: false,
      state: BIOMETRIC_STATE.CREDENTIAL_INVALIDATED,
      message: messageFor(BIOMETRIC_STATE.CREDENTIAL_INVALIDATED),
    };
  }

  // Best-effort telemetry for the settings row. A failure to record the time
  // must never fail the unlock itself.
  setMeta({ ...meta, lastUnlockAt: new Date().toISOString() }).catch(() => {});

  return { ok: true, state: BIOMETRIC_STATE.SUCCESS, message: messageFor(BIOMETRIC_STATE.SUCCESS) };
}

/**
 * Clears a stale enrollment left by a *different* driver on a shared device.
 *
 * Password + OTP is the only way to establish a session, so a second driver
 * reaching this point has already authenticated; dropping the previous
 * driver's lock is what stops driver B from ever being prompted into driver
 * A's session.
 *
 * @param {string} employeeId  the employee who just signed in
 * @returns {Promise<boolean>} whether a previous enrollment was cleared
 */
export async function clearEnrollmentForOtherEmployee(employeeId) {
  const meta = await getMeta();
  if (!meta || meta.employeeId === employeeId) return false;
  await clearBiometric();
  return true;
}

/**
 * Maps every native biometric outcome onto one FleetOps state and one
 * user-facing sentence.
 *
 * Dependency-free and pure so the whole matrix is unit-testable without a
 * device or a simulator.
 *
 * Rules this module exists to hold:
 *
 * - **No technical detail reaches the driver.** Native error codes, stack
 *   traces and keystore wording stay on this side of the boundary.
 * - **No credential material, ever.** Messages describe the authentication
 *   result only; nothing here reads, carries or logs a token.
 * - **The password path is always named.** Every failure message that could
 *   strand someone ends by pointing at it, because a biometric lock must never
 *   become a biometric-only login loop.
 */

export const BIOMETRIC_STATE = {
  SUCCESS: "SUCCESS",
  USER_CANCEL: "USER_CANCEL",
  USER_FALLBACK: "USER_FALLBACK",
  AUTHENTICATION_FAILED: "AUTHENTICATION_FAILED",
  BIOMETRIC_LOCKOUT: "BIOMETRIC_LOCKOUT",
  BIOMETRIC_NOT_ENROLLED: "BIOMETRIC_NOT_ENROLLED",
  BIOMETRIC_UNAVAILABLE: "BIOMETRIC_UNAVAILABLE",
  NO_HARDWARE: "NO_HARDWARE",
  SECURE_STORAGE_UNAVAILABLE: "SECURE_STORAGE_UNAVAILABLE",
  CREDENTIAL_INVALIDATED: "CREDENTIAL_INVALIDATED",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
};

const MESSAGES = {
  [BIOMETRIC_STATE.SUCCESS]: "Unlocked.",
  [BIOMETRIC_STATE.USER_CANCEL]: "Biometric authentication was cancelled. Try again, or sign in with your password.",
  [BIOMETRIC_STATE.USER_FALLBACK]: "Biometric authentication was skipped. Try again, or sign in with your password.",
  [BIOMETRIC_STATE.AUTHENTICATION_FAILED]: "That did not match. Try again, or sign in with your password.",
  [BIOMETRIC_STATE.BIOMETRIC_LOCKOUT]:
    "Too many failed attempts. Unlock your phone once with its screen lock, then try again — or sign in with your password.",
  [BIOMETRIC_STATE.BIOMETRIC_NOT_ENROLLED]:
    "No biometric authentication is enrolled on this device. Set up Face ID or a fingerprint in your device settings, or sign in with your password.",
  [BIOMETRIC_STATE.BIOMETRIC_UNAVAILABLE]:
    "Biometric authentication is unavailable on this device right now. Sign in with your password.",
  [BIOMETRIC_STATE.NO_HARDWARE]:
    "This device does not support biometric authentication. Sign in with your password.",
  [BIOMETRIC_STATE.SECURE_STORAGE_UNAVAILABLE]:
    "Secure storage is unavailable on this device, so biometric login cannot be used. Sign in with your password.",
  [BIOMETRIC_STATE.CREDENTIAL_INVALIDATED]:
    "Your device's biometric settings changed, so biometric login was turned off. Sign in with your password to enable it again.",
  [BIOMETRIC_STATE.UNKNOWN_ERROR]:
    "Biometric authentication could not be completed. Try again, or sign in with your password.",
};

/**
 * Native `error` code → FleetOps state.
 *
 * The keys are the complete `LocalAuthenticationError` union from the installed
 * `expo-local-authentication` typings — every one is mapped deliberately rather
 * than left to a fallback, so a new code showing up is a diff someone has to
 * look at. Unknown codes still degrade instead of throwing.
 */
const ERROR_CODE_STATES = {
  user_cancel: BIOMETRIC_STATE.USER_CANCEL,
  app_cancel: BIOMETRIC_STATE.USER_CANCEL,
  system_cancel: BIOMETRIC_STATE.USER_CANCEL,
  user_fallback: BIOMETRIC_STATE.USER_FALLBACK,
  authentication_failed: BIOMETRIC_STATE.AUTHENTICATION_FAILED,
  lockout: BIOMETRIC_STATE.BIOMETRIC_LOCKOUT,
  not_enrolled: BIOMETRIC_STATE.BIOMETRIC_NOT_ENROLLED,
  // `not_available` is the real code (there is no `unavailable` in the union):
  // no biometric the OS is willing to use right now, e.g. hardware busy.
  not_available: BIOMETRIC_STATE.BIOMETRIC_UNAVAILABLE,
  passcode_not_set: BIOMETRIC_STATE.BIOMETRIC_UNAVAILABLE,
  // A prompt nobody answered asserted nothing, so it is a cancel rather than a
  // failed match — the message says so instead of blaming the driver's finger.
  timeout: BIOMETRIC_STATE.USER_CANCEL,
  // Enumerated as unknown on purpose: each of these is a device-side failure
  // with no actions a driver could take that differ from the generic advice.
  no_space: BIOMETRIC_STATE.UNKNOWN_ERROR,
  unable_to_process: BIOMETRIC_STATE.UNKNOWN_ERROR,
  invalid_context: BIOMETRIC_STATE.UNKNOWN_ERROR,
  unknown: BIOMETRIC_STATE.UNKNOWN_ERROR,
};

/**
 * The sentence for a state.
 *
 * @param {string} state  a BIOMETRIC_STATE value
 * @returns {string}
 */
export function messageFor(state) {
  return MESSAGES[state] || MESSAGES[BIOMETRIC_STATE.UNKNOWN_ERROR];
}

/**
 * Classifies a native `authenticateAsync` result, or an error code alone.
 *
 * @param {{ success?: boolean, error?: string, warning?: string }|string|null} result
 * @returns {{ state: string, message: string, ok: boolean }}
 */
export function classifyNativeResult(result) {
  if (result === true) return build(BIOMETRIC_STATE.SUCCESS);
  if (!result) return build(BIOMETRIC_STATE.UNKNOWN_ERROR);

  if (typeof result === "string") return build(ERROR_CODE_STATES[result] || BIOMETRIC_STATE.UNKNOWN_ERROR);

  if (result.success === true) {
    // `warning` is informational only — the OS still authenticated the driver.
    // `passcode_not_set` can arrive here alongside success on Android, and
    // treating it as a failure would break unlock on a device that works.
    return build(BIOMETRIC_STATE.SUCCESS);
  }

  return build(ERROR_CODE_STATES[result.error] || BIOMETRIC_STATE.UNKNOWN_ERROR);
}

/**
 * Classifies a thrown error from the biometric or secure-storage layers.
 *
 * @param {unknown} error
 * @returns {{ state: string, message: string, ok: boolean }}
 */
export function classifyThrown(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (ERROR_CODE_STATES[code]) return build(ERROR_CODE_STATES[code]);
  const message = String(error?.message || "");
  if (/not available|unavailable|not supported/i.test(message)) {
    return build(BIOMETRIC_STATE.BIOMETRIC_UNAVAILABLE);
  }
  if (/cancel/i.test(message)) return build(BIOMETRIC_STATE.USER_CANCEL);
  return build(BIOMETRIC_STATE.UNKNOWN_ERROR);
}

function build(state) {
  return { state, message: messageFor(state), ok: state === BIOMETRIC_STATE.SUCCESS };
}

/**
 * Device-support verdict for the settings screen, from the three capability
 * probes. Ordered so the most specific reason wins.
 *
 * @param {{ hasHardware: boolean, isEnrolled: boolean, secureStorageAvailable: boolean }} args
 * @returns {{ state: string, available: boolean, message: string }}
 */
export function describeCapability({ hasHardware, isEnrolled, secureStorageAvailable } = {}) {
  if (!secureStorageAvailable) {
    const state = BIOMETRIC_STATE.SECURE_STORAGE_UNAVAILABLE;
    return { state, available: false, message: messageFor(state) };
  }
  if (!hasHardware) {
    const state = BIOMETRIC_STATE.NO_HARDWARE;
    return { state, available: false, message: messageFor(state) };
  }
  if (!isEnrolled) {
    const state = BIOMETRIC_STATE.BIOMETRIC_NOT_ENROLLED;
    return { state, available: false, message: messageFor(state) };
  }
  return { state: BIOMETRIC_STATE.SUCCESS, available: true, message: "Available" };
}

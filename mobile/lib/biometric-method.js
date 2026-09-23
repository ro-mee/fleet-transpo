/**
 * Turns the platform's enrolled-authentication types into the words the driver
 * actually sees.
 *
 * Dependency-free and pure, so the labels are unit-testable without a device.
 * The numeric values mirror `AuthenticationType` from expo-local-authentication;
 * they are re-declared here rather than imported so this module stays loadable
 * by plain `node` in tests (the native module cannot be).
 *
 * **Never hard-code "fingerprint".** The OS is the only thing that knows whether
 * this phone uses a fingerprint, a face, or an iris, and the label follows it.
 */

export const AUTH_TYPE = {
  FINGERPRINT: 1,
  FACIAL_RECOGNITION: 2,
  IRIS: 3,
};

/** Stable, storable identifier for the enrolled method. */
export const METHOD = {
  FACE: "face",
  FINGERPRINT: "fingerprint",
  IRIS: "iris",
  BIOMETRIC: "biometric",
};

/**
 * Reduces the platform's type list to one method.
 *
 * A device enrolling more than one modality (common on Android) is reported as
 * generic biometrics — claiming "Face ID" there would be a lie about the
 * hardware, and the prompt that follows is the OS's, not ours.
 *
 * @param {number[]} types  AuthenticationType values from supportedAuthenticationTypesAsync()
 * @returns {string} a METHOD value
 */
export function methodFromTypes(types) {
  const set = new Set((Array.isArray(types) ? types : []).map(Number).filter(Number.isFinite));
  if (set.size !== 1) return METHOD.BIOMETRIC;
  if (set.has(AUTH_TYPE.FACIAL_RECOGNITION)) return METHOD.FACE;
  if (set.has(AUTH_TYPE.FINGERPRINT)) return METHOD.FINGERPRINT;
  if (set.has(AUTH_TYPE.IRIS)) return METHOD.IRIS;
  return METHOD.BIOMETRIC;
}

/**
 * The primary action label, e.g. on the lock screen's unlock button.
 *
 * "Face ID" is Apple's product name and is only correct on iOS; Android face
 * unlock is a different system, so it gets a different word.
 *
 * @param {string} method  a METHOD value
 * @param {string} platform  Platform.OS
 * @returns {string}
 */
export function unlockActionLabel(method, platform) {
  switch (method) {
    case METHOD.FACE:
      return platform === "ios" ? "Unlock with Face ID" : "Unlock with face";
    case METHOD.FINGERPRINT:
      return "Unlock with fingerprint";
    case METHOD.IRIS:
      return "Unlock with iris";
    default:
      return "Unlock with biometrics";
  }
}

/**
 * The short noun for the method, for settings rows and status lines.
 *
 * @param {string} method  a METHOD value
 * @param {string} platform  Platform.OS
 * @returns {string}
 */
export function methodNoun(method, platform) {
  switch (method) {
    case METHOD.FACE:
      return platform === "ios" ? "Face ID" : "Face unlock";
    case METHOD.FINGERPRINT:
      return "Fingerprint";
    case METHOD.IRIS:
      return "Iris";
    default:
      return "Biometrics";
  }
}

/**
 * Ionicons glyph for the method, so the lock screen and settings agree.
 *
 * @param {string} method  a METHOD value
 * @returns {string}
 */
export function methodIcon(method) {
  switch (method) {
    case METHOD.FINGERPRINT:
      return "finger-print";
    case METHOD.FACE:
      return "scan";
    case METHOD.IRIS:
      return "eye-outline";
    default:
      return "lock-closed-outline";
  }
}

/**
 * What the OS will show inside its own prompt. Apple caps this at 150
 * characters and Android rejects an empty string, so both limits are enforced
 * here rather than trusted to the caller.
 *
 * @param {string} purpose  short reason shown under the prompt title
 * @returns {string}
 */
export function authenticationPrompt(purpose) {
  const text = String(purpose || "").trim() || "Confirm it is you to unlock FleetOps.";
  return text.slice(0, 150);
}

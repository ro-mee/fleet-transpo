import { describe, it, expect } from "vitest";
import {
  BIOMETRIC_STATE,
  messageFor,
  classifyNativeResult,
  classifyThrown,
  describeCapability,
} from "./biometric-errors";

const ALL_STATES = Object.values(BIOMETRIC_STATE);

/** A sentence that would leak native internals or credential material. */
const LEAKY = /(keystore|keychain|token|jwt|bearer|sentinel|stack|undefined|NaN|null|error code|0x[0-9a-f])/i;

describe("MESSAGES coverage", () => {
  it("has an honest sentence for every state", () => {
    for (const state of ALL_STATES) {
      const message = messageFor(state);
      expect(message, `missing message for ${state}`).toBeTruthy();
      // SUCCESS is a confirmation, not an explanation — "Unlocked." is enough.
      if (state !== BIOMETRIC_STATE.SUCCESS) {
        expect(message.length, `${state} is too terse to help`).toBeGreaterThan(10);
      }
    }
  });

  it("never leaks native internals or credential vocabulary", () => {
    for (const state of ALL_STATES) {
      expect(messageFor(state), `${state} leaks internals`).not.toMatch(LEAKY);
    }
  });

  // A biometric lock that can strand someone with no way back in is worse than
  // no lock at all, so every message that could dead-end must name the way out.
  it("names the password path on every dead-end message", () => {
    const deadEnds = [
      BIOMETRIC_STATE.USER_CANCEL,
      BIOMETRIC_STATE.USER_FALLBACK,
      BIOMETRIC_STATE.AUTHENTICATION_FAILED,
      BIOMETRIC_STATE.BIOMETRIC_LOCKOUT,
      BIOMETRIC_STATE.BIOMETRIC_NOT_ENROLLED,
      BIOMETRIC_STATE.BIOMETRIC_UNAVAILABLE,
      BIOMETRIC_STATE.NO_HARDWARE,
      BIOMETRIC_STATE.SECURE_STORAGE_UNAVAILABLE,
      BIOMETRIC_STATE.CREDENTIAL_INVALIDATED,
      BIOMETRIC_STATE.UNKNOWN_ERROR,
    ];
    for (const state of deadEnds) {
      expect(messageFor(state).toLowerCase(), `${state} strands the driver`).toContain("password");
    }
  });

  it("falls back to the unknown message rather than undefined", () => {
    expect(messageFor("NOT_A_STATE")).toBe(messageFor(BIOMETRIC_STATE.UNKNOWN_ERROR));
    expect(messageFor(undefined)).toBe(messageFor(BIOMETRIC_STATE.UNKNOWN_ERROR));
  });
});

describe("classifyNativeResult", () => {
  it("treats a successful prompt as success", () => {
    const result = classifyNativeResult({ success: true });
    expect(result.state).toBe(BIOMETRIC_STATE.SUCCESS);
    expect(result.ok).toBe(true);
  });

  it("accepts a bare true", () => {
    expect(classifyNativeResult(true).ok).toBe(true);
  });

  // Android can report passcode_not_set in `warning` alongside success; failing
  // on it would break unlock on a device that authenticated fine.
  it("ignores an informational warning next to success", () => {
    const result = classifyNativeResult({ success: true, warning: "passcode_not_set" });
    expect(result.state).toBe(BIOMETRIC_STATE.SUCCESS);
  });

  // The full `LocalAuthenticationError` union as of expo-local-authentication
  // 17.0.9. Every member is listed so a code that stops being handled, or a new
  // one that arrives silently, shows up as a failing test rather than as a
  // vague message on a driver's phone.
  it("maps every documented native error code", () => {
    const cases = {
      user_cancel: BIOMETRIC_STATE.USER_CANCEL,
      app_cancel: BIOMETRIC_STATE.USER_CANCEL,
      system_cancel: BIOMETRIC_STATE.USER_CANCEL,
      user_fallback: BIOMETRIC_STATE.USER_FALLBACK,
      authentication_failed: BIOMETRIC_STATE.AUTHENTICATION_FAILED,
      lockout: BIOMETRIC_STATE.BIOMETRIC_LOCKOUT,
      not_enrolled: BIOMETRIC_STATE.BIOMETRIC_NOT_ENROLLED,
      not_available: BIOMETRIC_STATE.BIOMETRIC_UNAVAILABLE,
      passcode_not_set: BIOMETRIC_STATE.BIOMETRIC_UNAVAILABLE,
      timeout: BIOMETRIC_STATE.USER_CANCEL,
      no_space: BIOMETRIC_STATE.UNKNOWN_ERROR,
      unable_to_process: BIOMETRIC_STATE.UNKNOWN_ERROR,
      invalid_context: BIOMETRIC_STATE.UNKNOWN_ERROR,
      unknown: BIOMETRIC_STATE.UNKNOWN_ERROR,
    };
    for (const [code, state] of Object.entries(cases)) {
      const result = classifyNativeResult({ success: false, error: code });
      expect(result.state, `wrong state for ${code}`).toBe(state);
      expect(result.ok).toBe(false);
    }
  });

  // Guards the regression this suite was written against: the map previously
  // keyed on `unavailable`, which the native layer never emits, so a genuinely
  // unavailable sensor fell through to the generic message.
  it("does not rely on an error code the platform never emits", () => {
    expect(classifyNativeResult({ success: false, error: "unavailable" }).state).toBe(
      BIOMETRIC_STATE.UNKNOWN_ERROR
    );
  });

  // A prompt nobody answered asserted nothing — saying "that did not match"
  // would blame the driver's finger for a timeout.
  it("treats a timeout as a cancel, not a failed match", () => {
    expect(classifyNativeResult({ success: false, error: "timeout" }).state).toBe(BIOMETRIC_STATE.USER_CANCEL);
  });

  it("degrades an unrecognised code to the unknown state", () => {
    expect(classifyNativeResult({ success: false, error: "some_future_code" }).state).toBe(
      BIOMETRIC_STATE.UNKNOWN_ERROR
    );
  });

  it("handles a bare error-code string", () => {
    expect(classifyNativeResult("lockout").state).toBe(BIOMETRIC_STATE.BIOMETRIC_LOCKOUT);
    expect(classifyNativeResult("nonsense").state).toBe(BIOMETRIC_STATE.UNKNOWN_ERROR);
  });

  it("degrades null and undefined without throwing", () => {
    expect(classifyNativeResult(null).state).toBe(BIOMETRIC_STATE.UNKNOWN_ERROR);
    expect(classifyNativeResult(undefined).state).toBe(BIOMETRIC_STATE.UNKNOWN_ERROR);
    expect(classifyNativeResult(null).ok).toBe(false);
  });

  it("never marks anything but success as ok", () => {
    for (const state of ALL_STATES) {
      const result = classifyNativeResult(state === BIOMETRIC_STATE.SUCCESS ? { success: true } : { success: false, error: state });
      expect(result.ok).toBe(state === BIOMETRIC_STATE.SUCCESS);
    }
  });
});

describe("classifyThrown", () => {
  it("uses a recognised error code when one is present", () => {
    expect(classifyThrown(Object.assign(new Error("boom"), { code: "lockout" })).state).toBe(
      BIOMETRIC_STATE.BIOMETRIC_LOCKOUT
    );
  });

  it("reads an unavailability message", () => {
    expect(classifyThrown(new Error("Biometric authentication is not available")).state).toBe(
      BIOMETRIC_STATE.BIOMETRIC_UNAVAILABLE
    );
    expect(classifyThrown(new Error("This device is not supported")).state).toBe(
      BIOMETRIC_STATE.BIOMETRIC_UNAVAILABLE
    );
  });

  it("reads a cancellation message", () => {
    expect(classifyThrown(new Error("User canceled the operation")).state).toBe(BIOMETRIC_STATE.USER_CANCEL);
  });

  // SecureStore throws on a missing/renamed keychain item; that must never
  // surface as a raw message and must never be mistaken for success.
  it("degrades anything else, including non-Error throws", () => {
    expect(classifyThrown(new Error("something odd")).state).toBe(BIOMETRIC_STATE.UNKNOWN_ERROR);
    expect(classifyThrown("just a string").state).toBe(BIOMETRIC_STATE.UNKNOWN_ERROR);
    expect(classifyThrown(null).state).toBe(BIOMETRIC_STATE.UNKNOWN_ERROR);
    expect(classifyThrown(undefined).state).toBe(BIOMETRIC_STATE.UNKNOWN_ERROR);
    expect(classifyThrown(undefined).ok).toBe(false);
  });

  it("does not echo the thrown message back to the driver", () => {
    const result = classifyThrown(new Error("keystore: signature verification failed at 0xdeadbeef"));
    expect(result.message).not.toMatch(LEAKY);
    expect(result.message).not.toContain("0xdeadbeef");
  });
});

describe("describeCapability", () => {
  it("reports available when all three probes pass", () => {
    const result = describeCapability({ hasHardware: true, isEnrolled: true, secureStorageAvailable: true });
    expect(result.available).toBe(true);
    expect(result.state).toBe(BIOMETRIC_STATE.SUCCESS);
    expect(result.message).toBe("Available");
  });

  // Ordered most-specific-first: a device with no hardware AND no secure store
  // should say the thing the driver can actually act on.
  it("prefers secure storage over hardware over enrollment", () => {
    expect(
      describeCapability({ hasHardware: false, isEnrolled: false, secureStorageAvailable: false }).state
    ).toBe(BIOMETRIC_STATE.SECURE_STORAGE_UNAVAILABLE);

    expect(
      describeCapability({ hasHardware: false, isEnrolled: false, secureStorageAvailable: true }).state
    ).toBe(BIOMETRIC_STATE.NO_HARDWARE);

    expect(
      describeCapability({ hasHardware: true, isEnrolled: false, secureStorageAvailable: true }).state
    ).toBe(BIOMETRIC_STATE.BIOMETRIC_NOT_ENROLLED);
  });

  it("treats missing probes as unavailable rather than assuming the best", () => {
    expect(describeCapability({}).available).toBe(false);
    expect(describeCapability(undefined).available).toBe(false);
  });

  it("never returns an unavailable verdict without a reason for the driver", () => {
    const probes = [
      { hasHardware: false, isEnrolled: false, secureStorageAvailable: false },
      { hasHardware: false, isEnrolled: true, secureStorageAvailable: true },
      { hasHardware: true, isEnrolled: false, secureStorageAvailable: true },
    ];
    for (const probe of probes) {
      const result = describeCapability(probe);
      expect(result.available).toBe(false);
      expect(result.message.length).toBeGreaterThan(10);
      expect(result.message).not.toMatch(LEAKY);
    }
  });
});

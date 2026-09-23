import { describe, it, expect } from "vitest";
import {
  AUTH_TYPE,
  METHOD,
  methodFromTypes,
  unlockActionLabel,
  methodNoun,
  methodIcon,
  authenticationPrompt,
} from "./biometric-method";

describe("methodFromTypes", () => {
  it("reads a fingerprint-only device", () => {
    expect(methodFromTypes([AUTH_TYPE.FINGERPRINT])).toBe(METHOD.FINGERPRINT);
  });

  it("reads a face-only device", () => {
    expect(methodFromTypes([AUTH_TYPE.FACIAL_RECOGNITION])).toBe(METHOD.FACE);
  });

  it("reads an iris-only device", () => {
    expect(methodFromTypes([AUTH_TYPE.IRIS])).toBe(METHOD.IRIS);
  });

  // Common on Android: claiming "Face ID" or "fingerprint" here would be a lie
  // about which hardware is about to prompt.
  it("falls back to generic biometrics when several are enrolled", () => {
    expect(methodFromTypes([AUTH_TYPE.FINGERPRINT, AUTH_TYPE.FACIAL_RECOGNITION])).toBe(METHOD.BIOMETRIC);
    expect(methodFromTypes([1, 2, 3])).toBe(METHOD.BIOMETRIC);
  });

  it("degrades to generic biometrics on empty, junk or absent input", () => {
    expect(methodFromTypes([])).toBe(METHOD.BIOMETRIC);
    expect(methodFromTypes(null)).toBe(METHOD.BIOMETRIC);
    expect(methodFromTypes(undefined)).toBe(METHOD.BIOMETRIC);
    expect(methodFromTypes(["nope", null, NaN])).toBe(METHOD.BIOMETRIC);
    expect(methodFromTypes([99])).toBe(METHOD.BIOMETRIC);
  });

  it("ignores unparseable entries alongside a real one", () => {
    expect(methodFromTypes([AUTH_TYPE.FINGERPRINT, "x"])).toBe(METHOD.FINGERPRINT);
  });
});

describe("unlockActionLabel", () => {
  it("never hard-codes fingerprint", () => {
    expect(unlockActionLabel(METHOD.FINGERPRINT, "android")).toBe("Unlock with fingerprint");
    expect(unlockActionLabel(METHOD.FACE, "android")).toBe("Unlock with face");
    expect(unlockActionLabel(METHOD.IRIS, "android")).toBe("Unlock with iris");
    expect(unlockActionLabel(METHOD.BIOMETRIC, "android")).toBe("Unlock with biometrics");
  });

  // "Face ID" is Apple's product name and is only correct on iOS.
  it("uses Face ID on iOS and face unlock elsewhere", () => {
    expect(unlockActionLabel(METHOD.FACE, "ios")).toBe("Unlock with Face ID");
    expect(unlockActionLabel(METHOD.FACE, "android")).not.toContain("Face ID");
  });

  it("degrades to a generic label for an unknown method", () => {
    expect(unlockActionLabel("something-new", "ios")).toBe("Unlock with biometrics");
    expect(unlockActionLabel(undefined, "ios")).toBe("Unlock with biometrics");
  });
});

describe("methodNoun", () => {
  it("names each method, platform-aware", () => {
    expect(methodNoun(METHOD.FACE, "ios")).toBe("Face ID");
    expect(methodNoun(METHOD.FACE, "android")).toBe("Face unlock");
    expect(methodNoun(METHOD.FINGERPRINT, "ios")).toBe("Fingerprint");
    expect(methodNoun(METHOD.IRIS, "android")).toBe("Iris");
    expect(methodNoun(METHOD.BIOMETRIC, "ios")).toBe("Biometrics");
    expect(methodNoun("unknown", "ios")).toBe("Biometrics");
  });
});

describe("methodIcon", () => {
  it("returns an Ionicons name for every method", () => {
    const icons = [
      methodIcon(METHOD.FINGERPRINT),
      methodIcon(METHOD.FACE),
      methodIcon(METHOD.IRIS),
      methodIcon(METHOD.BIOMETRIC),
      methodIcon("unknown"),
    ];
    for (const icon of icons) {
      expect(typeof icon).toBe("string");
      expect(icon.length).toBeGreaterThan(0);
    }
  });
});

describe("authenticationPrompt", () => {
  it("supplies a default rather than an empty string", () => {
    expect(authenticationPrompt("")).toBe("Confirm it is you to unlock FleetOps.");
    expect(authenticationPrompt(null)).toBe("Confirm it is you to unlock FleetOps.");
    expect(authenticationPrompt("   ")).toBe("Confirm it is you to unlock FleetOps.");
  });

  it("passes a caller's purpose through", () => {
    expect(authenticationPrompt("Enable biometric login")).toBe("Enable biometric login");
  });

  // Apple caps the prompt string at 150 characters and truncation is silent.
  it("caps the prompt at 150 characters", () => {
    const long = "x".repeat(400);
    const result = authenticationPrompt(long);
    expect(result).toHaveLength(150);
  });
});

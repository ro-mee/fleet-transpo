// Security & session policy — defaults, merge, validation, derivation.
//
// Two things are pinned here. First, that a database with no row behaves
// exactly as the code did before the policy existed: every default is the
// shipped constant, and every default is inside its own declared range, because
// a default that fails its own bounds would make an unconfigured system
// unsaveable. Second, that the cross-field rule holds both ways — validated as
// a 400 on save, repaired on read — so a stored pair that cannot behave never
// reaches the session machinery.
import { describe, it, expect } from "vitest";
import {
  IDLE_TIMEOUT_SECONDS,
  WEB_SESSION_TTL_SECONDS,
} from "@/lib/auth/session-policy";
import {
  SECURITY_POLICY_KEY,
  DEFAULT_SECURITY_POLICY,
  SECURITY_POLICY_RANGES,
  SECURITY_POLICY_FIELDS,
  SECURITY_POLICY_KEYS,
  mergeSecurityPolicy,
  validateSecurityPolicy,
  deriveIdleWindows,
  splitDurationParts,
  joinDurationParts,
} from "@/lib/security-policy";

describe("defaults", () => {
  it("is stored under a single settings key", () => {
    expect(SECURITY_POLICY_KEY).toBe("security_policy");
  });

  it("takes the two session numbers from session-policy rather than retyping them", () => {
    // A second literal here would be exactly the drift the module header says
    // it exists to prevent.
    expect(DEFAULT_SECURITY_POLICY.idleTimeoutSeconds).toBe(IDLE_TIMEOUT_SECONDS);
    expect(DEFAULT_SECURITY_POLICY.absoluteTtlSeconds).toBe(WEB_SESSION_TTL_SECONDS);
    expect(DEFAULT_SECURITY_POLICY.idleTimeoutSeconds).toBe(300);
    expect(DEFAULT_SECURITY_POLICY.absoluteTtlSeconds).toBe(43200);
  });

  it("ships every default inside its own declared range", () => {
    for (const key of SECURITY_POLICY_KEYS) {
      const { min, max } = SECURITY_POLICY_RANGES[key];
      expect(DEFAULT_SECURITY_POLICY[key], key).toBeGreaterThanOrEqual(min);
      expect(DEFAULT_SECURITY_POLICY[key], key).toBeLessThanOrEqual(max);
    }
  });

  it("declares a range for every stored key, and a form field for every editable one", () => {
    expect(SECURITY_POLICY_KEYS).toEqual(Object.keys(DEFAULT_SECURITY_POLICY));
    expect(Object.keys(SECURITY_POLICY_RANGES).sort()).toEqual([...SECURITY_POLICY_KEYS].sort());

    // FIELDS is the EDITABLE subset of KEYS, in display order. absoluteTtlSeconds
    // is stored and read by the session machinery but is not offered in the
    // settings form — a direct PUT still carries it, so it must stay in KEYS.
    expect(SECURITY_POLICY_FIELDS.map((f) => f.key)).toEqual(
      SECURITY_POLICY_KEYS.filter((key) => key !== "absoluteTtlSeconds")
    );
    expect(SECURITY_POLICY_FIELDS).toHaveLength(6);

    for (const f of SECURITY_POLICY_FIELDS) {
      expect(f.label, f.key).toBeTruthy();
      expect(f.unit, f.key).toBeTruthy();
      expect(f.hint, f.key).toBeTruthy();
    }

    // The idle timeout is entered as a minutes + seconds pair, not as raw seconds.
    const idle = SECURITY_POLICY_FIELDS.find((f) => f.key === "idleTimeoutSeconds");
    expect(idle.parts).toEqual(["minutes", "seconds"]);
    // ...and only it is split; every other field keeps the plain single input.
    expect(SECURITY_POLICY_FIELDS.filter((f) => f.parts)).toHaveLength(1);
  });
});

describe("mergeSecurityPolicy", () => {
  it("returns the defaults for a missing or corrupt row", () => {
    expect(mergeSecurityPolicy(null)).toEqual(DEFAULT_SECURITY_POLICY);
    expect(mergeSecurityPolicy(undefined)).toEqual(DEFAULT_SECURITY_POLICY);
    expect(mergeSecurityPolicy("nonsense")).toEqual(DEFAULT_SECURITY_POLICY);
    expect(mergeSecurityPolicy([1, 2, 3])).toEqual(DEFAULT_SECURITY_POLICY);
  });

  it("keeps stored values that are in range and fills in everything else", () => {
    const merged = mergeSecurityPolicy({ idleTimeoutSeconds: 600, lockoutLimit: 20 });
    expect(merged).toEqual({ ...DEFAULT_SECURITY_POLICY, idleTimeoutSeconds: 600, lockoutLimit: 20 });
  });

  it("clamps an out-of-range stored value back to the default instead of throwing", () => {
    expect(mergeSecurityPolicy({ lockoutLimit: 500 }).lockoutLimit).toBe(
      DEFAULT_SECURITY_POLICY.lockoutLimit
    );
    expect(mergeSecurityPolicy({ idleTimeoutSeconds: "soon" }).idleTimeoutSeconds).toBe(
      DEFAULT_SECURITY_POLICY.idleTimeoutSeconds
    );
  });

  it("drops unknown keys so the stored shape carries exactly the known fields", () => {
    const merged = mergeSecurityPolicy({ isAdmin: true, idleTimeoutSeconds: 600 });
    expect(Object.keys(merged).sort()).toEqual([...SECURITY_POLICY_KEYS].sort());
  });

  it("repairs a stored pair whose absolute lifetime does not outlive the idle window", () => {
    const merged = mergeSecurityPolicy({ idleTimeoutSeconds: 3600, absoluteTtlSeconds: 1800 });
    expect(merged.absoluteTtlSeconds).toBeGreaterThan(merged.idleTimeoutSeconds);
    expect(merged.absoluteTtlSeconds).toBe(DEFAULT_SECURITY_POLICY.absoluteTtlSeconds);
    expect(merged.idleTimeoutSeconds).toBe(3600);
  });
});

describe("validateSecurityPolicy", () => {
  it("accepts nothing at all — a partial PUT must not restate the policy", () => {
    expect(validateSecurityPolicy(undefined)).toEqual({ ok: true });
    expect(validateSecurityPolicy(null)).toEqual({ ok: true });
    expect(validateSecurityPolicy({})).toEqual({ ok: true });
  });

  it("rejects a value outside the declared range with the field named in the error", () => {
    const res = validateSecurityPolicy({ lockoutLimit: 500 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("lockoutLimit");
    expect(validateSecurityPolicy({ idleTimeoutSeconds: 30 }).ok).toBe(false);
    expect(validateSecurityPolicy({ tempPasswordTtlDays: 0 }).ok).toBe(false);
  });

  it("checks only the fields present, so an untouched one cannot fail the save", () => {
    expect(validateSecurityPolicy({ idleTimeoutSeconds: 900 })).toEqual({ ok: true });
    // An unknown key is not a stored field, so it is not validated either —
    // the route strips it before it can be written.
    expect(validateSecurityPolicy({ isAdmin: true })).toEqual({ ok: true });
  });

  it("rejects a non-object instead of reading properties off it", () => {
    expect(validateSecurityPolicy("idleTimeoutSeconds").ok).toBe(false);
    expect(validateSecurityPolicy([1]).ok).toBe(false);
  });

  it("rejects an absolute lifetime that does not outlive the idle window", () => {
    const res = validateSecurityPolicy({ idleTimeoutSeconds: 3600, absoluteTtlSeconds: 1800 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("absoluteTtlSeconds");
    expect(validateSecurityPolicy({ idleTimeoutSeconds: 900, absoluteTtlSeconds: 7200 }).ok).toBe(
      true
    );
  });
});

describe("deriveIdleWindows", () => {
  it("matches the shipped constants at the default", () => {
    const derived = deriveIdleWindows(DEFAULT_SECURITY_POLICY.idleTimeoutSeconds);
    expect(derived.idleWarningSeconds).toBe(Math.min(300, Math.round(IDLE_TIMEOUT_SECONDS / 5)));
    expect(derived.heartbeatIntervalSeconds).toBe(Math.round(IDLE_TIMEOUT_SECONDS / 2));
    expect(derived.heartbeatMinGapSeconds).toBe(Math.round(IDLE_TIMEOUT_SECONDS / 5));
  });

  it.each([60, 300, 900, 3600])("keeps every derived window inside a %ss idle timeout", (idle) => {
    const derived = deriveIdleWindows(idle);
    expect(derived.idleWarningSeconds).toBeGreaterThan(0);
    expect(derived.idleWarningSeconds).toBeLessThan(idle);
    expect(derived.heartbeatMinGapSeconds).toBeGreaterThan(0);
    expect(derived.heartbeatMinGapSeconds).toBeLessThan(idle);
    expect(derived.heartbeatIntervalSeconds).toBeGreaterThan(0);
    expect(derived.heartbeatIntervalSeconds).toBeLessThan(idle);
  });

  it("falls back to the default rather than emitting NaN for a bad input", () => {
    for (const bad of [undefined, null, 0, -1, "soon", NaN]) {
      expect(deriveIdleWindows(bad).idleWarningSeconds).toBe(
        deriveIdleWindows(DEFAULT_SECURITY_POLICY.idleTimeoutSeconds).idleWarningSeconds
      );
    }
  });
});

describe("split/join duration parts", () => {
  it("splits a stored total into minutes + seconds strings", () => {
    expect(splitDurationParts(300)).toEqual({ minutes: "5", seconds: "0" });
    expect(splitDurationParts(90)).toEqual({ minutes: "1", seconds: "30" });
    expect(splitDurationParts("300")).toEqual({ minutes: "5", seconds: "0" });
  });

  it("joins a typed pair back into whole seconds, with empty counting as 0", () => {
    expect(joinDurationParts("5", "0")).toBe(300);
    // Clearing one box to retype it must not freeze the other half.
    expect(joinDurationParts("5", "")).toBe(300);
    expect(joinDurationParts("", "")).toBe(0);
    // Leading zeros typed mid-edit join to the same total blur normalizes to.
    expect(joinDurationParts("0", "015")).toBe(15);
  });

  it("round-trips through the form helpers", () => {
    for (const total of [60, 300, 315, 3600]) {
      const { minutes, seconds } = splitDurationParts(total);
      expect(joinDurationParts(minutes, seconds)).toBe(total);
    }
  });
});

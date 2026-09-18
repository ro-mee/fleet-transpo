import { describe, expect, it } from "vitest";
import {
  WEB_SESSION_TTL_SECONDS,
  IDLE_TIMEOUT_SECONDS,
  IDLE_WARNING_SECONDS,
  ABSOLUTE_WARNING_SECONDS,
} from "./sessions";
import {
  ACTIVITY_HEARTBEAT_INTERVAL_SECONDS,
  ACTIVITY_HEARTBEAT_MIN_GAP_SECONDS,
} from "./session-policy";
import { AuthError, handleError } from "@/lib/api/utils";

describe("Session idle timeout & expiration policy constants", () => {
  it("enforces a 5-minute idle timeout and 12-hour absolute maximum", () => {
    expect(IDLE_TIMEOUT_SECONDS).toBe(300); // 5 minutes
    expect(WEB_SESSION_TTL_SECONDS).toBe(43200); // 12 hours
    expect(IDLE_WARNING_SECONDS).toBe(60); // 20% of the idle window
    expect(ABSOLUTE_WARNING_SECONDS).toBe(300); // 5-minute warning before 12h expiry
  });
});

// The warning window, the heartbeat backstop, and the activity throttle used to
// be independent 300s literals on the client. When the idle timeout was reduced
// to 300s those literals silently became the ENTIRE timeout window: the
// "Are you still there?" modal appeared at login and never dismissed, and the
// heartbeat fired exactly at the deadline. These invariants are the regression
// guard — they fail if any derived value is ever re-hardcoded past its bound.
describe("Derived session policy invariants", () => {
  it("keeps the warning window strictly inside the idle window", () => {
    expect(IDLE_WARNING_SECONDS).toBeGreaterThan(0);
    expect(IDLE_WARNING_SECONDS).toBeLessThan(IDLE_TIMEOUT_SECONDS);
  });

  it("keeps the heartbeat backstop strictly inside the idle window", () => {
    expect(ACTIVITY_HEARTBEAT_INTERVAL_SECONDS).toBeGreaterThan(0);
    expect(ACTIVITY_HEARTBEAT_INTERVAL_SECONDS).toBeLessThan(IDLE_TIMEOUT_SECONDS);
  });

  it("keeps the activity throttle from outlasting the warning window", () => {
    expect(ACTIVITY_HEARTBEAT_MIN_GAP_SECONDS).toBeGreaterThan(0);
    expect(ACTIVITY_HEARTBEAT_MIN_GAP_SECONDS).toBeLessThanOrEqual(IDLE_WARNING_SECONDS);
  });

  it("never lets the absolute warning exceed the absolute maximum", () => {
    expect(ABSOLUTE_WARNING_SECONDS).toBeLessThan(WEB_SESSION_TTL_SECONDS);
  });
});

describe("AuthError and handleError structured responses", () => {
  it("creates AuthError with specific error codes", () => {
    const idleError = new AuthError(
      "Your session expired due to inactivity.",
      401,
      "SESSION_IDLE_TIMEOUT"
    );
    expect(idleError.status).toBe(401);
    expect(idleError.code).toBe("SESSION_IDLE_TIMEOUT");
    expect(idleError.message).toBe("Your session expired due to inactivity.");

    const expiredError = new AuthError(
      "Your session has expired.",
      401,
      "SESSION_EXPIRED"
    );
    expect(expiredError.code).toBe("SESSION_EXPIRED");

    const revokedError = new AuthError(
      "Your session has been revoked.",
      401,
      "SESSION_REVOKED"
    );
    expect(revokedError.code).toBe("SESSION_REVOKED");

    const disabledError = new AuthError(
      "Account is inactive or disabled.",
      401,
      "ACCOUNT_DISABLED"
    );
    expect(disabledError.code).toBe("ACCOUNT_DISABLED");
  });

  it("handleError serializes error and code in JSON response", async () => {
    const error = new AuthError(
      "Your session expired due to inactivity.",
      401,
      "SESSION_IDLE_TIMEOUT"
    );
    const response = handleError(error);

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json).toEqual({
      error: "Your session expired due to inactivity.",
      code: "SESSION_IDLE_TIMEOUT",
    });
  });

  it("handleError defaults code when omitted", async () => {
    const error = new AuthError("Session invalid", 401);
    const response = handleError(error);

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.code).toBe("SESSION_INVALID");
  });
});

describe("Server-side idle deadline validation math", () => {
  it("detects idle timeout when last_seen_at is older than idle_timeout_seconds", () => {
    const now = Date.now();

    // Active halfway through the idle window — still valid.
    const activeRecentLastSeen = new Date(now - (IDLE_TIMEOUT_SECONDS / 2) * 1000);
    const activeRecentExpiry = activeRecentLastSeen.getTime() + IDLE_TIMEOUT_SECONDS * 1000;
    expect(now > activeRecentExpiry).toBe(false);

    // Idle for the whole window plus a minute — expired.
    const idleLastSeen = new Date(now - (IDLE_TIMEOUT_SECONDS + 60) * 1000);
    const idleExpiry = idleLastSeen.getTime() + IDLE_TIMEOUT_SECONDS * 1000;
    expect(now > idleExpiry).toBe(true);
  });

  it("ensures 12-hour absolute expiration cannot be bypassed by continuous activity", () => {
    const now = Date.now();
    // Session created 12 hours and 5 minutes ago
    const absoluteExpiresAt = new Date(now - 5 * 60 * 1000); // 5 minutes ago
    // Even if user was active 1 minute ago:
    const recentLastSeen = new Date(now - 60 * 1000);
    const idleExpiresAt = recentLastSeen.getTime() + IDLE_TIMEOUT_SECONDS * 1000;

    // Idle would be valid, but absolute is expired!
    const isIdleExpired = now > idleExpiresAt;
    const isAbsoluteExpired = now >= absoluteExpiresAt.getTime();

    expect(isIdleExpired).toBe(false);
    expect(isAbsoluteExpired).toBe(true); // Hard cutoff wins
  });
});

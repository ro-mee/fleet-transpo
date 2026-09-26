// GET /api/auth/login-status — reports the account (password) and IP locks with
// a countdown, and never reveals whether an account exists. It deliberately
// does NOT report the account-level OTP lock: answering `locked:true` for that
// means resolving the email to an employee_id first, which makes the answer
// conditional on the account existing. The locked-out password-holder gets
// `OTP_LOCKED:<seconds>` from authorize/mobile 429 instead.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import * as db from "@/lib/db";
import { peekRateLimit } from "@/lib/rate-limit";
import { checkAccountLockout } from "@/lib/auth/account-lockout";
import { checkOtpLockout } from "@/lib/auth/email-otp";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  peekRateLimit: vi.fn(),
  clientIp: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/auth/account-lockout", () => ({ checkAccountLockout: vi.fn() }));
// Mocked even though the route no longer imports this module: if a future edit
// re-introduces the OTP peek, these stubs go live and the "no observable state"
// pins below fail instead of silently re-opening the existence oracle.
vi.mock("@/lib/auth/email-otp", () => ({ checkOtpLockout: vi.fn() }));

const statusUrl = (email) =>
  `http://localhost/api/auth/login-status${email ? `?email=${encodeURIComponent(email)}` : ""}`;

const body = (res) => res.json();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(peekRateLimit).mockResolvedValue({ allowed: true, remaining: 5, retryAfter: 0 });
  vi.mocked(checkAccountLockout).mockResolvedValue({ allowed: true, retryAfter: 0 });
  vi.mocked(checkOtpLockout).mockResolvedValue({ allowed: true, retryAfter: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/auth/login-status", () => {
  it("an active OTP lock produces no observable state", async () => {
    // The account's OTP bucket is refusing AND the IP bucket is refusing, so
    // the only thing the response may differ on is the IP verdict.
    vi.mocked(checkOtpLockout).mockResolvedValue({ allowed: false, retryAfter: 420 });
    vi.mocked(peekRateLimit).mockResolvedValue({ allowed: false, retryAfter: 30 });

    const known = await body(await GET(new Request(statusUrl("a@b.test"))));
    const unknown = await body(await GET(new Request(statusUrl("stranger@x.test"))));
    const noEmail = await body(await GET(new Request(statusUrl(null))));

    // Byte-identical: an OTP lock cannot make the answer depend on the account
    // existing, so it must not be observable in the body at all.
    expect(known).toEqual(unknown);
    expect(known).toEqual(noEmail);
    expect(known).toEqual({ locked: true, retryAfterSec: 30, reason: "ip" });
    expect(known.reason).not.toBe("otp");
    expect(db.query).not.toHaveBeenCalled();
    expect(checkOtpLockout).not.toHaveBeenCalled();
  });

  it("falls through to the IP verdict even when the OTP bucket would refuse", async () => {
    vi.mocked(checkOtpLockout).mockResolvedValue({ allowed: false, retryAfter: 420 });

    const known = await body(await GET(new Request(statusUrl("a@b.test"))));
    const unknown = await body(await GET(new Request(statusUrl("stranger@x.test"))));

    expect(known).toEqual({ locked: false, retryAfterSec: 0, reason: "ip" });
    expect(known).toEqual(unknown);
    expect(checkOtpLockout).not.toHaveBeenCalled();
  });

  it("still reports the password account lock first", async () => {
    vi.mocked(checkAccountLockout).mockResolvedValue({ allowed: false, retryAfter: 500 });

    const res = await GET(new Request(statusUrl("a@b.test")));

    expect(await res.json()).toEqual({ locked: true, retryAfterSec: 500, reason: "account" });
    expect(checkOtpLockout).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it("reports the IP verdict for a known account", async () => {
    vi.mocked(peekRateLimit).mockResolvedValue({ allowed: false, retryAfter: 30 });

    const res = await GET(new Request(statusUrl("a@b.test")));

    expect(await res.json()).toEqual({ locked: true, retryAfterSec: 30, reason: "ip" });
  });

  it("answers locked:false for an unknown account — never an oracle", async () => {
    const res = await GET(new Request(statusUrl("stranger@x.test")));

    expect(await res.json()).toEqual({ locked: false, retryAfterSec: 0, reason: "ip" });
    expect(db.query).not.toHaveBeenCalled();
    expect(checkOtpLockout).not.toHaveBeenCalled();
  });

  it("does not look anything up when no email is given", async () => {
    const res = await GET(new Request(statusUrl(null)));

    expect(await res.json()).toEqual({ locked: false, retryAfterSec: 0, reason: "ip" });
    expect(db.query).not.toHaveBeenCalled();
    expect(checkOtpLockout).not.toHaveBeenCalled();
    expect(checkAccountLockout).not.toHaveBeenCalled();
  });
});

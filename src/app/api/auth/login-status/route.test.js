// GET /api/auth/login-status — reports IP, account AND OTP locks with a
// countdown, and never reveals whether an account exists.
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
vi.mock("@/lib/auth/email-otp", () => ({ checkOtpLockout: vi.fn() }));

const statusUrl = (email) =>
  `http://localhost/api/auth/login-status${email ? `?email=${encodeURIComponent(email)}` : ""}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(peekRateLimit).mockResolvedValue({ allowed: true, remaining: 5, retryAfter: 0 });
  vi.mocked(checkAccountLockout).mockResolvedValue({ allowed: true, retryAfter: 0 });
  vi.mocked(checkOtpLockout).mockResolvedValue({ allowed: true, retryAfter: 0 });
  vi.mocked(db.query).mockResolvedValue({ rows: [{ employee_id: 7 }] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/auth/login-status", () => {
  it("reports an OTP account lock with its countdown", async () => {
    vi.mocked(checkOtpLockout).mockResolvedValue({ allowed: false, retryAfter: 420 });

    const res = await GET(new Request(statusUrl("a@b.test")));

    expect(await res.json()).toEqual({ locked: true, retryAfterSec: 420, reason: "otp" });
    expect(checkOtpLockout).toHaveBeenCalledWith(7);
  });

  it("keeps the IP verdict when a known account's OTP bucket allows", async () => {
    vi.mocked(peekRateLimit).mockResolvedValue({ allowed: false, retryAfter: 30 });

    const res = await GET(new Request(statusUrl("a@b.test")));

    expect(await res.json()).toEqual({ locked: true, retryAfterSec: 30, reason: "ip" });
    expect(checkOtpLockout).toHaveBeenCalledWith(7);
  });

  it("answers locked:false for an unknown account — never an oracle", async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] });

    const res = await GET(new Request(statusUrl("stranger@x.test")));

    expect(await res.json()).toEqual({ locked: false, retryAfterSec: 0, reason: "ip" });
    expect(checkOtpLockout).not.toHaveBeenCalled();
  });

  it("does not touch the employee table when no email is given", async () => {
    const res = await GET(new Request(statusUrl(null)));

    expect(await res.json()).toEqual({ locked: false, retryAfterSec: 0, reason: "ip" });
    expect(db.query).not.toHaveBeenCalled();
    expect(checkOtpLockout).not.toHaveBeenCalled();
  });

  it("still reports the password account lock first", async () => {
    vi.mocked(checkAccountLockout).mockResolvedValue({ allowed: false, retryAfter: 500 });

    const res = await GET(new Request(statusUrl("a@b.test")));

    expect(await res.json()).toEqual({ locked: true, retryAfterSec: 500, reason: "account" });
    expect(checkOtpLockout).not.toHaveBeenCalled();
  });
});

// POST /api/auth/forgot-password — self-service recovery stays
// enumeration-safe with and without email delivery configured.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import * as db from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { issueResetToken } from "@/lib/auth/reset-token";
import { isEmailConfigured, sendPasswordResetEmail } from "@/lib/email/smtp";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ allowed: true })),
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/reset-token", () => ({ issueResetToken: vi.fn() }));
vi.mock("@/lib/email/smtp", () => ({
  isEmailConfigured: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

function req(email) {
  return new Request("http://localhost/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(issueResetToken).mockResolvedValue({
    token: "tok",
    resetUrl: "https://app/reset-password?token=tok",
  });
  vi.mocked(sendPasswordResetEmail).mockResolvedValue({ id: "email-1" });
  vi.mocked(db.query).mockImplementation(async (sql, params) => {
    if (String(sql).includes("FROM employees")) {
      return params?.[0] === "driver@fleetops.ph"
        ? { rows: [{ employee_id: 7, email: "driver@fleetops.ph" }] }
        : { rows: [] };
    }
    return { rows: [] };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/forgot-password", () => {
  it("emails a token to an existing account and answers generically", async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(true);

    const res = await POST(req("driver@fleetops.ph"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toMatch(/reset link has been sent/i);
    expect(issueResetToken).toHaveBeenCalledWith(7);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({
      to: "driver@fleetops.ph",
      resetUrl: "https://app/reset-password?token=tok",
      token: "tok",
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.objectContaining({ action: "password_reset_requested" })
    );
  });

  it("answers an unknown email with the IDENTICAL message and sends nothing", async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(true);

    const [known, unknown] = await Promise.all([
      (await POST(req("driver@fleetops.ph"))).json(),
      (await POST(req("nobody@fleetops.ph"))).json(),
    ]);

    expect(unknown.message).toBe(known.message);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1); // only the known one
    expect(issueResetToken).toHaveBeenCalledTimes(1);
  });

  it("falls back to the administrator message when email is not configured", async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(false);

    const res = await POST(req("driver@fleetops.ph"));
    const body = await res.json();

    expect(body.message).toMatch(/administrator/i);
    expect(issueResetToken).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("still answers generically when delivery fails (no leak, no 500)", async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    vi.mocked(sendPasswordResetEmail).mockRejectedValue(new Error("boom"));

    const res = await POST(req("driver@fleetops.ph"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toMatch(/reset link has been sent/i);
  });

  it("rejects a missing email", async () => {
    const res = await POST(req(""));
    expect(res.status).toBe(400);
  });
});

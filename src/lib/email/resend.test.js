import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send: sendMock } };
  }),
}));

import { isEmailConfigured, emailFrom, sendPasswordResetEmail } from "./resend";

const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  sendMock.mockReset();
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe("isEmailConfigured", () => {
  it("is false without a key and true with one", () => {
    expect(isEmailConfigured()).toBe(false);
    process.env.RESEND_API_KEY = "re_test";
    expect(isEmailConfigured()).toBe(true);
  });

  it("treats a blank key as missing", () => {
    process.env.RESEND_API_KEY = "   ";
    expect(isEmailConfigured()).toBe(false);
  });
});

describe("emailFrom", () => {
  it("defaults to the Resend test sender and honors EMAIL_FROM", () => {
    expect(emailFrom()).toBe("onboarding@resend.dev");
    process.env.EMAIL_FROM = "noreply@fleetops.ph";
    expect(emailFrom()).toBe("noreply@fleetops.ph");
  });
});

describe("sendPasswordResetEmail", () => {
  it("refuses without a key instead of silently dropping the email", async () => {
    await expect(
      sendPasswordResetEmail({ to: "a@b.co", resetUrl: "https://x/reset?token=t", token: "t" })
    ).rejects.toThrow(/not configured/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends link + paste-able code through the configured sender", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "noreply@fleetops.ph";
    sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });

    const data = await sendPasswordResetEmail({
      to: "driver@fleetops.ph",
      resetUrl: "https://app/reset-password?token=abc",
      token: "abc",
    });

    expect(data).toEqual({ id: "email-1" });
    const payload = sendMock.mock.calls[0][0];
    expect(payload.from).toBe("noreply@fleetops.ph");
    expect(payload.to).toBe("driver@fleetops.ph");
    expect(payload.html).toContain("https://app/reset-password?token=abc");
    expect(payload.html).toContain("abc");
  });

  it("surfaces a Resend rejection instead of claiming delivery", async () => {
    process.env.RESEND_API_KEY = "re_test";
    sendMock.mockResolvedValue({ data: null, error: { message: "Invalid from" } });

    await expect(
      sendPasswordResetEmail({ to: "a@b.co", resetUrl: "https://x/r?t=t", token: "t" })
    ).rejects.toThrow(/Invalid from/);
  });
});

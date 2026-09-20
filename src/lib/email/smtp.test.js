import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMailMock = vi.fn();

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

import {
  isEmailConfigured,
  emailFrom,
  sendPasswordResetEmail,
} from "./smtp";

const ENV_BACKUP = { ...process.env };

function setSmtp(over = {}) {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_SECURE;
  delete process.env.EMAIL_FROM;
  Object.assign(process.env, {
    SMTP_HOST: "smtp.gmail.com",
    SMTP_USER: "fleetops@gmail.com",
    SMTP_PASS: "app-password",
    ...over,
  });
}

beforeEach(() => {
  sendMailMock.mockReset();
  setSmtp();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe("isEmailConfigured", () => {
  it("is true with host/user/pass and false when any is missing", () => {
    expect(isEmailConfigured()).toBe(true);
    delete process.env.SMTP_PASS;
    expect(isEmailConfigured()).toBe(false);
    setSmtp({ SMTP_HOST: "   " });
    expect(isEmailConfigured()).toBe(false);
  });
});

describe("emailFrom", () => {
  it("defaults to the SMTP user and honors EMAIL_FROM", () => {
    expect(emailFrom()).toBe("fleetops@gmail.com");
    process.env.EMAIL_FROM = "noreply@fleetops.ph";
    expect(emailFrom()).toBe("noreply@fleetops.ph");
  });
});

describe("sendPasswordResetEmail", () => {
  it("refuses without credentials instead of silently dropping the email", async () => {
    delete process.env.SMTP_HOST;
    await expect(
      sendPasswordResetEmail({ to: "a@b.co", resetUrl: "https://x/reset?token=t", token: "t" })
    ).rejects.toThrow(/not configured/i);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sends link + paste-able code through the configured sender", async () => {
    process.env.EMAIL_FROM = "noreply@fleetops.ph";
    sendMailMock.mockResolvedValue({ messageId: "smtp-1" });

    const info = await sendPasswordResetEmail({
      to: "driver@fleetops.ph",
      resetUrl: "https://app/reset-password?token=abc",
      token: "abc",
    });

    expect(info).toEqual({ messageId: "smtp-1" });
    const payload = sendMailMock.mock.calls[0][0];
    expect(payload.from).toBe("noreply@fleetops.ph");
    expect(payload.to).toBe("driver@fleetops.ph");
    expect(payload.html).toContain("https://app/reset-password?token=abc");
    expect(payload.html).toContain("abc");
  });

  it("surfaces an SMTP rejection instead of claiming delivery", async () => {
    sendMailMock.mockRejectedValue(new Error("Invalid credentials"));

    await expect(
      sendPasswordResetEmail({ to: "a@b.co", resetUrl: "https://x/r?t=t", token: "t" })
    ).rejects.toThrow(/Invalid credentials/);
  });
});

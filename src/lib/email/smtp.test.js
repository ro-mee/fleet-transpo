import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMailMock = vi.fn();

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

import {
  isEmailConfigured,
  emailFrom,
  sendPasswordResetEmail,
  sendOtpEmail,
  sendNewSignInAlertEmail,
  sendTempPasswordEmail,
  resetEmailHtml,
  resetEmailText,
  otpEmailHtml,
  otpEmailText,
  newSignInAlertHtml,
  newSignInAlertText,
  tempPasswordEmailHtml,
  tempPasswordEmailText,
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

describe("resetEmailHtml", () => {
  it("renders a self-contained premium template with link, code and expiry", () => {
    const html = resetEmailHtml({
      resetUrl: "https://app/reset-password?token=abc",
      token: "abc",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('href="https://app/reset-password?token=abc"');
    expect(html).toContain("abc");
    expect(html).toContain("30 minutes");
    expect(html).toContain("FleetOps");
    // Email-safe: table layout, inline styles, no external assets.
    expect(html).toContain("<table");
    expect(html).not.toMatch(/<link|<style|http[^s].*\.(png|jpg)/);
  });
});

describe("sendOtpEmail", () => {
  it("refuses without credentials instead of silently dropping the code", async () => {
    delete process.env.SMTP_HOST;
    await expect(sendOtpEmail({ to: "a@b.co", code: "123456" })).rejects.toThrow(/not configured/i);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("refuses a missing recipient or code", async () => {
    await expect(sendOtpEmail({ to: "", code: "123456" })).rejects.toThrow(/required/);
    await expect(sendOtpEmail({ to: "a@b.co", code: "" })).rejects.toThrow(/required/);
  });

  it("surfaces an SMTP rejection instead of claiming delivery", async () => {
    sendMailMock.mockRejectedValue(new Error("535 Authentication failed"));
    await expect(sendOtpEmail({ to: "a@b.co", code: "123456" })).rejects.toThrow(
      /Authentication failed/
    );
  });

  // The gate writes `delivery: "sent"` only when this resolves, so a rejected
  // send must never resolve — that is the whole basis for trusting the audit
  // trail when a user reports a code never arriving.
  it("sends a multipart message, so the mail filter has a text part to read", async () => {
    sendMailMock.mockResolvedValue({ messageId: "smtp-2" });

    await sendOtpEmail({ to: "driver@fleetops.ph", code: "654321" });

    const payload = sendMailMock.mock.calls[0][0];
    expect(payload.to).toBe("driver@fleetops.ph");
    expect(payload.html).toContain("654321");
    expect(payload.text).toContain("654321");
    expect(payload.text).toBeTruthy();
  });
});

describe("sendNewSignInAlertEmail", () => {
  it("refuses without credentials rather than silently dropping the notice", async () => {
    delete process.env.SMTP_HOST;
    await expect(
      sendNewSignInAlertEmail({ to: "a@b.co", deviceLabel: "Chrome on Windows" })
    ).rejects.toThrow(/not configured/i);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("refuses a missing recipient or device label", async () => {
    await expect(sendNewSignInAlertEmail({ to: "", deviceLabel: "x" })).rejects.toThrow(/required/);
    await expect(sendNewSignInAlertEmail({ to: "a@b.co", deviceLabel: "" })).rejects.toThrow(
      /required/
    );
  });

  it("sends multipart, naming the device in both parts", async () => {
    sendMailMock.mockResolvedValue({ messageId: "smtp-3" });

    await sendNewSignInAlertEmail({ to: "driver@fleetops.ph", deviceLabel: "Chrome on Windows" });

    const payload = sendMailMock.mock.calls[0][0];
    expect(payload.to).toBe("driver@fleetops.ph");
    expect(payload.subject).toMatch(/new sign-in/i);
    expect(payload.html).toContain("Chrome on Windows");
    expect(payload.text).toContain("Chrome on Windows");
  });
});

describe("newSignInAlertHtml / newSignInAlertText", () => {
  it("carries the device and what to do about it", () => {
    const html = newSignInAlertHtml({ deviceLabel: "Safari on macOS" });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Safari on macOS");
    expect(html).toContain("no action is needed");
    expect(html).toContain("change your password");
    expect(html).toContain("<table");
    // Email-safe: no external assets, which clients block by default.
    expect(html).not.toMatch(/<link|<style|http[^s].*\.(png|jpg)/);
  });

  it("stands alone as plain text, with no link to break", () => {
    const text = newSignInAlertText({ deviceLabel: "Safari on macOS" });

    expect(text).toContain("Safari on macOS");
    expect(text).toContain("no action is needed");
    expect(text).toContain("change your password");
    expect(text).not.toContain("<");
    // No base URL is guaranteed, so a link here could read `localhost`.
    expect(text).not.toMatch(/https?:\/\//);
  });
});

describe("otpEmailHtml", () => {
  it("carries the code, its lifetime, and the unexpected-code warning", () => {
    const html = otpEmailHtml({ code: "654321" });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("654321");
    expect(html).toContain("5 minutes");
    // An unrequested code means the password is already known to someone else.
    expect(html).toContain("someone else has your password");
    expect(html).toContain("<table");
    expect(html).not.toMatch(/<link|<style|http[^s].*\.(png|jpg)/);
  });
});

describe("otpEmailText / resetEmailText", () => {
  it("otpEmailText stands alone without the HTML part", () => {
    const text = otpEmailText({ code: "654321" });
    expect(text).toContain("654321");
    expect(text).toContain("5 minutes");
    expect(text).toContain("did not try to sign in");
    expect(text).not.toContain("<");
  });

  it("resetEmailText carries both the link and the mobile code", () => {
    const text = resetEmailText({
      resetUrl: "https://app/reset-password?token=abc",
      token: "abc",
    });
    expect(text).toContain("https://app/reset-password?token=abc");
    expect(text).toContain("abc");
    expect(text).toContain("30 minutes");
    expect(text).not.toContain("<");
  });
});

describe("sendTempPasswordEmail", () => {
  const expiresAt = new Date("2026-09-30T12:00:00Z");

  it("refuses without credentials instead of silently dropping the invite", async () => {
    delete process.env.SMTP_HOST;
    await expect(
      sendTempPasswordEmail({ to: "a@b.co", firstName: "Ada", tempPassword: "Ab1!x", expiresAt })
    ).rejects.toThrow(/not configured/i);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("refuses missing fields", async () => {
    await expect(sendTempPasswordEmail({ to: "", tempPassword: "Ab1!x", expiresAt })).rejects.toThrow(
      /required/
    );
    await expect(
      sendTempPasswordEmail({ to: "a@b.co", firstName: "Ada", tempPassword: "", expiresAt })
    ).rejects.toThrow(/required/);
    await expect(
      sendTempPasswordEmail({ to: "a@b.co", firstName: "Ada", tempPassword: "Ab1!x", expiresAt: null })
    ).rejects.toThrow(/required/);
  });

  it("sends multipart with the password in the body but NEVER in the subject", async () => {
    sendMailMock.mockResolvedValue({ messageId: "smtp-4" });
    const tempPassword = "Kx9!mpQ2rT7wZa4C";

    await sendTempPasswordEmail({
      to: "newbie@fleetops.ph",
      firstName: "Ada",
      tempPassword,
      expiresAt,
    });

    const payload = sendMailMock.mock.calls[0][0];
    expect(payload.from).toBe("fleetops@gmail.com");
    expect(payload.to).toBe("newbie@fleetops.ph");
    expect(payload.subject).toBe("Your FleetOps temporary password");
    expect(payload.subject).not.toContain(tempPassword);
    expect(payload.html).toContain(tempPassword);
    expect(payload.text).toContain(tempPassword);
    expect(payload.text).toBeTruthy();
    expect(payload.html).toContain("2026-09-30");
  });

  it("surfaces an SMTP rejection instead of claiming delivery", async () => {
    sendMailMock.mockRejectedValue(new Error("535 Authentication failed"));
    await expect(
      sendTempPasswordEmail({ to: "a@b.co", firstName: "Ada", tempPassword: "Ab1!x", expiresAt })
    ).rejects.toThrow(/Authentication failed/);
  });
});

describe("tempPasswordEmailHtml / tempPasswordEmailText", () => {
  const expiresAt = new Date("2026-09-30T12:00:00Z");

  it("html carries the password, expiry, OTP note and warning — email-safe markup", () => {
    const html = tempPasswordEmailHtml({ firstName: "Ada", tempPassword: "Kx9!mpQ2", expiresAt });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Kx9!mpQ2");
    expect(html).toContain("2026-09-30");
    expect(html).toContain("6-digit login verification code");
    expect(html).toContain("did not expect this account");
    expect(html).toContain("<table");
    expect(html).not.toMatch(/<link|<style|http[^s].*\.(png|jpg)/);
    // No password-shaped value may appear in anything resembling a header.
    expect(html).not.toMatch(/subject/i);
  });

  it("html escapes the recipient name", () => {
    const html = tempPasswordEmailHtml({
      firstName: "<script>alert(1)</script>",
      tempPassword: "Kx9!mpQ2",
      expiresAt,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("text stands alone: password, expiry, resend path, OTP heads-up", () => {
    const text = tempPasswordEmailText({ firstName: "Ada", tempPassword: "Kx9!mpQ2", expiresAt });

    expect(text).toContain("Hi Ada");
    expect(text).toContain("Kx9!mpQ2");
    expect(text).toContain("2026-09-30");
    expect(text).toContain("ask your administrator to resend it");
    expect(text).toContain("separate 6-digit login verification code");
    expect(text).not.toContain("<");
  });
});

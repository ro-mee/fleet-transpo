import nodemailer from "nodemailer";
import { OTP_TTL_SECONDS, describeOtpTtl } from "@/lib/auth/otp-policy";

// Server-only email delivery over SMTP (Nodemailer).
//
// Nothing in here may be imported from a client component: the SMTP
// credentials must never reach the browser bundle. Callers live behind
// authenticated (or intentionally public + rate-limited) API routes.
//
// Configuration (all server-only env, never NEXT_PUBLIC_):
//   SMTP_HOST  e.g. smtp.gmail.com (Gmail) — required
//   SMTP_PORT  465 for implicit TLS (default), 587 for STARTTLS
//   SMTP_USER  full address, e.g. you@gmail.com — required
//   SMTP_PASS  Gmail App Password (not the login password) — required
//   EMAIL_FROM sender shown to recipients, defaults to SMTP_USER
//   SMTP_SECURE set "false" only when using port 587 without implicit TLS
//   (Nodemailer upgrades via STARTTLS automatically when secure:false).
//
// When the credentials are absent the module reports "not configured"
// instead of throwing at import time, so routes can fall back to their
// pre-email behavior (e.g. administrator-issued reset links) with an honest
// message rather than crashing.

export const RESET_LINK_TTL_MINUTES = 30;

/** True when a reset email can actually be delivered. */
export function isEmailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      String(process.env.SMTP_HOST).trim() &&
      process.env.SMTP_USER &&
      String(process.env.SMTP_USER).trim() &&
      process.env.SMTP_PASS &&
      String(process.env.SMTP_PASS).trim()
  );
}

/** Verified sender. Defaults to the authenticated SMTP user. */
export function emailFrom() {
  const configured = process.env.EMAIL_FROM && String(process.env.EMAIL_FROM).trim();
  if (configured) return configured;
  const user = process.env.SMTP_USER && String(process.env.SMTP_USER).trim();
  return user || "noreply@localhost";
}

function buildTransporter() {
  const user = process.env.SMTP_USER && String(process.env.SMTP_USER).trim();
  const pass = process.env.SMTP_PASS && String(process.env.SMTP_PASS).trim();
  const host = process.env.SMTP_HOST && String(process.env.SMTP_HOST).trim();
  if (!host || !user || !pass) {
    throw new Error("Email is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS are missing)");
  }
  // Built per send on purpose: no shared connection to go stale across
  // serverless invocations or long-lived container idle periods.
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== "false",
    auth: { user, pass },
  });
}

/**
 * Sends the password-reset email. The body carries BOTH the web link and the
 * standalone code: web users click through, mobile drivers paste the code
 * into the app's reset screen (a URL pasted into that field would not match).
 */
export async function sendPasswordResetEmail({ to, resetUrl, token }) {
  if (!to || !resetUrl || !token) {
    throw new Error("to, resetUrl and token are required");
  }

  const info = await buildTransporter().sendMail({
    from: emailFrom(),
    to,
    subject: "Reset your FleetOps password",
    html: resetEmailHtml({ resetUrl, token }),
    text: resetEmailText({ resetUrl, token }),
  });
  return info;
}

/**
 * Sends the login verification code.
 *
 * This is the second factor, so the message is deliberately narrow: one code,
 * one expiry, and a warning that explains what an unexpected delivery means.
 * The code is only ever sent after the correct password was verified, so an
 * unrequested code in an inbox is evidence the password is already known to
 * somebody else — which is worth saying plainly rather than leaving the
 * recipient to guess.
 */
export async function sendOtpEmail({ to, code, ttlSeconds = OTP_TTL_SECONDS }) {
  if (!to || !code) {
    throw new Error("to and code are required");
  }

  const info = await buildTransporter().sendMail({
    from: emailFrom(),
    to,
    // Leading with the code means it is readable from the inbox list, without
    // opening the message — the difference between a 5-second login and a
    // 5-minute one on a phone.
    subject: `${code} is your FleetOps verification code`,
    html: otpEmailHtml({ code, ttlSeconds }),
    text: otpEmailText({ code, ttlSeconds }),
  });
  return info;
}

/**
 * Sends the new-device sign-in notice.
 *
 * This is currently the ONLY notification event that delivers by email — see
 * Bugs.md BUG-NOTIF-001, where the email channel is offered in preferences and
 * defaults true for most events but nothing sends it. A sign-in from a device
 * the account has never used is the right event to spend a real email on: it
 * has to reach the owner when they are *not* in the app, which is exactly the
 * situation a stolen credential is used in.
 *
 * Deliberately no link. The only base-URL source in the repo is
 * `NEXT_PUBLIC_APP_URL` (`src/proxy.js`), which is optional, so a link built
 * from it could render as `localhost` in a real inbox. The message stands on
 * its own, the way the in-app copy does.
 */
export async function sendNewSignInAlertEmail({ to, deviceLabel }) {
  if (!to || !deviceLabel) {
    throw new Error("to and deviceLabel are required");
  }

  const info = await buildTransporter().sendMail({
    from: emailFrom(),
    to,
    subject: "New sign-in to your FleetOps account",
    html: newSignInAlertHtml({ deviceLabel }),
    text: newSignInAlertText({ deviceLabel }),
  });
  return info;
}

/**
 * The plain-text half of the verification email.
 *
 * Not a formality. A message that carries only `text/html` and no alternative
 * is a recognised spam signal, and this one is the worst case for it: a bare
 * six-digit code, in a table layout, from a personal Gmail address the
 * recipient has never written to. Gmail filed exactly that under Spam on
 * 2026-09-22, and the HTML-only body was part of the reason.
 *
 * A text part is also what a screen reader and an HTML-disabled client
 * actually read, so this is the version that has to stand on its own.
 */
export function otpEmailText({ code, ttlSeconds = OTP_TTL_SECONDS }) {
  const lifetime = describeOtpTtl(ttlSeconds);
  return [
    "FleetOps verification code",
    "",
    "Your verification code is:",
    "",
    `    ${code}`,
    "",
    `Enter it to finish signing in. The code expires in ${lifetime}.`,
    "",
    "If you did not try to sign in, someone may already know your password.",
    "Change it immediately and tell your administrator.",
    "",
    "This is an automated message from FleetOps.",
    "",
  ].join("\n");
}

/**
 * The plain-text half of the new-device notice.
 *
 * Carries the same two sentences as the in-app notification, so an owner who
 * sees both reads one story rather than two versions of it.
 */
export function newSignInAlertText({ deviceLabel }) {
  return [
    "New sign-in to your FleetOps account",
    "",
    "We noticed a sign-in from:",
    "",
    `    ${deviceLabel}`,
    "",
    "If this was you, no action is needed.",
    "",
    "If it wasn't, change your password and tell your administrator. A sign-in",
    "from a device your account has never used can mean someone else has your",
    "password.",
    "",
    "This is an automated message from FleetOps.",
    "",
  ].join("\n");
}

/**
 * The plain-text half of the password-reset email. Carries both the link and
 * the standalone code, because mobile drivers paste the code into the app
 * rather than clicking a URL.
 */
export function resetEmailText({ resetUrl, token }) {
  return [
    "Reset your FleetOps password",
    "",
    "Open this link to choose a new password:",
    "",
    `    ${resetUrl}`,
    "",
    "On the mobile app, enter this code instead:",
    "",
    `    ${token}`,
    "",
    `The link and the code expire in ${RESET_LINK_TTL_MINUTES} minutes, and can be used once.`,
    "",
    "If you did not ask to reset your password, you can ignore this message.",
    "",
    "This is an automated message from FleetOps.",
    "",
  ].join("\n");
}

/**
 * Verification-code email. Same hand-built table/inline-style constraints as
 * `resetEmailHtml` below, but the code is the only thing that matters, so it
 * gets the largest type on the page and everything else is a caption.
 */
export function otpEmailHtml({ code, ttlSeconds = OTP_TTL_SECONDS }) {
  const lifetime = describeOtpTtl(ttlSeconds);
  return (
    `<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:#f3f3f3;">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">` +
    `Your FleetOps verification code is ${code} — it expires in ${lifetime}.` +
    `</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f3f3;padding:32px 16px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;">` +
    `<tr><td style="background-color:#111827;padding:28px 32px;">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">FleetOps</div>` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#9ca3af;margin-top:4px;">Fleet &amp; Transportation Management</div>` +
    `</td></tr>` +
    `<tr><td style="padding:36px 36px 8px 36px;">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#111827;margin:0 0 12px 0;">Your verification code</div>` +
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#4b5563;margin:0 0 28px 0;">` +
    `Enter this code to finish signing in to FleetOps.` +
    `</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">` +
    `<tr><td align="center" style="padding:28px 24px;">` +
    `<div style="font-family:'Courier New',Courier,monospace;font-size:38px;font-weight:bold;color:#111827;letter-spacing:10px;text-indent:10px;">${code}</div>` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;margin-top:12px;">Expires in ${lifetime}</div>` +
    `</td></tr></table>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 36px 36px 36px;">` +
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#6b7280;margin:0;">` +
    `This code is single-use and expires in ${lifetime}. FleetOps never asks for it by phone, chat or email — do not share it with anyone.` +
    `</p>` +
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#b91c1c;margin:12px 0 0 0;">` +
    `If you were not trying to sign in, someone else has your password. Change it now and tell your administrator.` +
    `</p>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 36px;border-top:1px solid #f3f4f6;">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9ca3af;">` +
    `Sent by FleetOps · Please do not reply to this email.` +
    `</div>` +
    `</td></tr>` +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/**
 * New-device notice, same hand-built table/inline-style constraints as the
 * emails around it. The device label is the emphasized element because it is
 * the one fact that decides whether the recipient needs to act.
 */
export function newSignInAlertHtml({ deviceLabel }) {
  return (
    `<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:#f3f3f3;">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">` +
    `New sign-in to your FleetOps account from ${deviceLabel}.` +
    `</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f3f3;padding:32px 16px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;">` +
    `<tr><td style="background-color:#111827;padding:28px 32px;">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">FleetOps</div>` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#9ca3af;margin-top:4px;">Fleet &amp; Transportation Management</div>` +
    `</td></tr>` +
    `<tr><td style="padding:36px 36px 8px 36px;">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#111827;margin:0 0 12px 0;">New sign-in to your account</div>` +
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#4b5563;margin:0 0 28px 0;">` +
    `We noticed a sign-in to your FleetOps account from a device it has not been used from before.` +
    `</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">` +
    `<tr><td align="center" style="padding:24px 24px;">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Device</div>` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#111827;">${deviceLabel}</div>` +
    `</td></tr></table>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 36px 36px 36px;">` +
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#4b5563;margin:0;">` +
    `If this was you, no action is needed.` +
    `</p>` +
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#b91c1c;margin:12px 0 0 0;">` +
    `If it wasn't, change your password immediately and tell your administrator. A sign-in from a device your account has never used can mean someone else has your password.` +
    `</p>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 36px;border-top:1px solid #f3f4f6;">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9ca3af;">` +
    `Sent by FleetOps · Please do not reply to this email.` +
    `</div>` +
    `</td></tr>` +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/**
 * Premium-minimalist reset email, hand-built for inbox rendering.
 *
 * Email-client constraints (not web CSS): table layout, inline styles only,
 * no external assets (images are blocked by default, so the wordmark is
 * text), system font stack, 600px container. Palette follows DESIGN.md —
 * Midnight Ink header, Cool Paper backdrop, emerald reserved for the single
 * primary action accent.
 */
export function resetEmailHtml({ resetUrl, token }) {
  return (
    `<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:#f3f3f3;">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">` +
    `Reset your FleetOps password — this link expires in ${RESET_LINK_TTL_MINUTES} minutes.` +
    `</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f3f3;padding:32px 16px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;">` +
    `<tr><td style="background-color:#111827;padding:28px 32px;">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">FleetOps</div>` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#9ca3af;margin-top:4px;">Fleet &amp; Transportation Management</div>` +
    `</td></tr>` +
    `<tr><td style="padding:36px 36px 12px 36px;">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#111827;margin:0 0 12px 0;">Reset your password</div>` +
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#4b5563;margin:0 0 24px 0;">` +
    `We received a password reset request for your FleetOps account. Click the button below to choose a new password.` +
    `</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="border-radius:8px;background-color:#111827;">` +
    `<a href="${resetUrl}" style="display:inline-block;padding:14px 36px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Reset password</a>` +
    `</td></tr></table>` +
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#6b7280;margin:20px 0 0 0;">` +
    `Button not working? Paste this link into your browser:<br>` +
    `<span style="word-break:break-all;color:#374151;">${resetUrl}</span>` +
    `</p>` +
    `</td></tr>` +
    `<tr><td style="padding:8px 36px 12px 36px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">` +
    `<tr><td style="padding:20px 24px;">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Using the mobile app?</div>` +
    `<div style="font-family:'Courier New',Courier,monospace;font-size:15px;font-weight:bold;color:#111827;letter-spacing:1px;word-break:break-all;">${token}</div>` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;margin-top:8px;">Paste this code on the app's reset screen.</div>` +
    `</td></tr></table>` +
    `</td></tr>` +
    `<tr><td style="padding:12px 36px 36px 36px;">` +
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#6b7280;margin:0;">` +
    `This link and code are single-use and expire in ${RESET_LINK_TTL_MINUTES} minutes. ` +
    `If you did not request this, you can safely ignore this email — your password will not change.` +
    `</p>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 36px;border-top:1px solid #f3f4f6;">` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9ca3af;">` +
    `Sent by FleetOps · Please do not reply to this email.` +
    `</div>` +
    `</td></tr>` +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

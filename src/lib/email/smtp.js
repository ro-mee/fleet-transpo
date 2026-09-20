import nodemailer from "nodemailer";

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
  });
  return info;
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

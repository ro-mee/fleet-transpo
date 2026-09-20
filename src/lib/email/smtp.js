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
    html:
      `<p>You requested a password reset for your FleetOps account.</p>` +
      `<p><a href="${resetUrl}">Reset your password</a> — this link is single-use ` +
      `and expires in ${RESET_LINK_TTL_MINUTES} minutes.</p>` +
      `<p>On the FleetOps mobile app instead? Paste this code on the reset screen:</p>` +
      `<p><strong>${token}</strong></p>` +
      `<p>If you did not request this, you can safely ignore this email.</p>`,
  });
  return info;
}

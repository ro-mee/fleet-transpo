import { Resend } from "resend";

// Server-only email delivery over the Resend HTTP API.
//
// Nothing in here may be imported from a client component: the API key must
// never reach the browser bundle. Callers live behind authenticated (or
// intentionally public + rate-limited) API routes.
//
// When RESEND_API_KEY is absent the module reports "not configured" instead
// of throwing at import time, so routes can fall back to their pre-email
// behavior (e.g. administrator-issued reset links) with an honest message
// rather than crashing.

export const RESET_LINK_TTL_MINUTES = 30;

/** True when a reset email can actually be delivered. */
export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && String(process.env.RESEND_API_KEY).trim());
}

/** Verified sender. Resend delivers test mail from onboarding@resend.dev only
 * to the account owner's address — set EMAIL_FROM to a verified domain for
 * real recipients. */
export function emailFrom() {
  const configured = process.env.EMAIL_FROM && String(process.env.EMAIL_FROM).trim();
  return configured || "onboarding@resend.dev";
}

/**
 * Sends the password-reset email. The body carries BOTH the web link and the
 * standalone code: web users click through, mobile drivers paste the code
 * into the app's reset screen (a URL pasted into that field would not match).
 */
export async function sendPasswordResetEmail({ to, resetUrl, token }) {
  const apiKey = process.env.RESEND_API_KEY && String(process.env.RESEND_API_KEY).trim();
  if (!apiKey) {
    throw new Error("Email is not configured (RESEND_API_KEY is missing)");
  }
  if (!to || !resetUrl || !token) {
    throw new Error("to, resetUrl and token are required");
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
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

  if (error) {
    throw new Error(error.message || "Resend rejected the email");
  }
  return data;
}

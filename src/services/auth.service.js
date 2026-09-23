import { signIn as nextAuthSignIn } from "next-auth/react";
import { apiFetch } from "@/lib/api/client";

// Admin-only account creation. The endpoint (/api/auth/register) requires an
// authenticated super_admin/admin session, validates the payload server-side,
// and answers 409 when the email is already taken — surfaced below as err.status.
export async function createEmployeeAccount(payload) {
  return apiFetch("/api/auth/register", { method: "POST", body: payload });
}

/**
 * Exchanges credentials for a session.
 *
 * `otpCode` carries the six-digit code emailed to the account, or one of the ten
 * recovery codes. The second factor is mandatory for every account, so the first
 * call for a new browser always fails with `MFA_REQUIRED` after the code has been
 * sent; the caller then re-invokes this with the code in hand. That re-invocation
 * is also the resend.
 */
export async function signIn(email, password, { otpCode = "" } = {}) {
  let result;
  try {
    result = await nextAuthSignIn("credentials", {
      email,
      password,
      otpCode,
      redirect: false,
    });
  } catch (err) {
    if (
      err?.name === "SyntaxError" ||
      err?.message?.includes("Unexpected end of JSON input") ||
      err?.message?.includes("Failed to execute 'json'")
    ) {
      throw new Error(
        "Authentication service returned an unexpected response. Please check your network and server configuration."
      );
    }
    throw err;
  }
  if (result?.error) throw new Error(result.error);
  return result;
}

// Password reset flows go through server routes — never the browser-side
// Supabase anon client. The anon role has no privileges on `employees`.

export function rememberTrustedDevice() {
  return apiFetch("/api/auth/trusted-device", { method: "POST", body: {} });
}

export function revokeTrustedDevice() {
  return apiFetch("/api/auth/trusted-device", { method: "DELETE" });
}

export async function requestPasswordReset(email) {
  return apiFetch("/api/auth/forgot-password", { method: "POST", body: { email } });
}

export async function resetSessionPassword(newPassword, currentPassword, token) {
  return apiFetch("/api/auth/reset-password", { method: "POST", body: { newPassword, currentPassword, token } });
}

// Forced first sign-in change: no current-password field — the session claim
// (mustChangePassword) is what authorizes it, and the response rotates the cookie.
export function setInitialPassword(newPassword) {
  return apiFetch("/api/auth/change-password", { method: "POST", body: { newPassword } });
}

export async function signOut() {
  const { signOut: nextSignOut } = await import("next-auth/react");
  await nextSignOut({ callbackUrl: "/login" });
}

export function getNotificationIcon(type) {
  const icons = {
    Info: "info",
    Warning: "warning",
    Alert: "alert",
    Success: "success",
    Reservation: "calendar",
    Dispatch: "send",
    Maintenance: "wrench",
    Fuel: "fuel",
    Trip: "route",
  };
  return icons[type] || "info";
}

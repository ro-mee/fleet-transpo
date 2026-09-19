import { signIn as nextAuthSignIn } from "next-auth/react";
import { apiFetch } from "@/lib/api/client";

// Admin-only account creation. The endpoint (/api/auth/register) requires an
// authenticated system_admin/admin session, validates the payload server-side,
// and answers 409 when the email is already taken — surfaced below as err.status.
export async function createEmployeeAccount(payload) {
  return apiFetch("/api/auth/register", { method: "POST", body: payload });
}

export async function signIn(email, password, { mfaCode = "" } = {}) {
  let result;
  try {
    result = await nextAuthSignIn("credentials", {
      email,
      password,
      totpCode: mfaCode,
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

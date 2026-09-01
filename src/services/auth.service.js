import { signIn as nextAuthSignIn } from "next-auth/react";
import { apiFetch } from "@/lib/api/client";

// Admin-only account creation. The endpoint (/api/auth/register) requires an
// authenticated system_admin/admin session, validates the payload server-side,
// and answers 409 when the email is already taken — surfaced below as err.status.
export async function createEmployeeAccount(payload) {
  return apiFetch("/api/auth/register", { method: "POST", body: payload });
}

export async function signIn(email, password, { mfaCode = "" } = {}) {
  const result = await nextAuthSignIn("credentials", {
    email,
    password,
    totpCode: mfaCode,
    redirect: false,
  });
  if (result?.error) throw new Error(result.error);
  return result;
}

// Password reset flows go through server routes — never the browser-side
// Supabase anon client. The anon role has no privileges on `employees`.

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

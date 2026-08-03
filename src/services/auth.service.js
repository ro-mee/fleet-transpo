import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/client";
import { signIn as nextAuthSignIn } from "next-auth/react";
import { apiFetch } from "@/lib/api/client";

// Admin-only account creation. The endpoint (/api/auth/register) requires an
// authenticated system_admin/admin session, validates the payload server-side,
// and answers 409 when the email is already taken — surfaced below as err.status.
export async function createEmployeeAccount(payload) {
  return apiFetch("/api/auth/register", { method: "POST", body: payload });
}

export async function signIn(email, password) {
  const result = await nextAuthSignIn("credentials", {
    email,
    password,
    redirect: false,
  });
  if (result?.error) throw new Error(result.error);
  return result;
}

export async function signUp(email, password, userData) {
  const lowerEmail = email.toLowerCase();
  const hash = await bcrypt.hash(password, 10);
  const supabase = createClient();

  const { data: existingEmp } = await supabase
    .from("employees")
    .select("employee_id")
    .eq("email", lowerEmail)
    .single();

  if (existingEmp) {
    await supabase
      .from("employees")
      .update({ password_hash: hash, first_name: userData.first_name, last_name: userData.last_name })
      .eq("employee_id", existingEmp.employee_id);
  } else {
    const { error: profileError } = await supabase.from("employees").insert({
      email: lowerEmail,
      password_hash: hash,
      first_name: userData.first_name,
      last_name: userData.last_name,
      role_id: userData.role_id || 8,
    });
    if (profileError) throw profileError;
  }

  return { user: { email: lowerEmail } };
}

export async function signOut() {
  const { signOut: nextSignOut } = await import("next-auth/react");
  await nextSignOut({ callbackUrl: "/login" });
}

export async function resetPassword(email) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("employee_id")
    .eq("email", email.toLowerCase())
    .is("deleted_at", null)
    .single();
  if (error || !data) throw new Error("No account found with that email");
  return { message: "Password reset link sent" };
}

export async function updatePassword(newPassword, email) {
  if (!email) throw new Error("Email is required");

  const hash = await bcrypt.hash(newPassword, 10);
  const supabase = createClient();
  const { error } = await supabase
    .from("employees")
    .update({ password_hash: hash })
    .eq("email", email)
    .is("deleted_at", null);
  if (error) throw error;
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

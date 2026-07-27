import { createClient } from "@/lib/supabase/client";

export async function signIn(email, password) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password, userData) {
  const supabase = createClient();
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: userData },
  });
  if (authError) throw authError;

  if (authData.user) {
    const { error: profileError } = await supabase.from("employees").insert({
      user_id: authData.user.id,
      email,
      first_name: userData.first_name,
      last_name: userData.last_name,
      role_id: userData.role_id || 4,
    });
    if (profileError) throw profileError;
  }

  return authData;
}

export async function signOut() {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUser() {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function getCurrentEmployee() {
  const supabase = createClient();
  const user = await getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("employees")
    .select("*, roles(*), branches(*)")
    .eq("user_id", user.id)
    .single();

  if (error) return null;
  return data;
}

export async function resetPassword(email) {
  const supabase = createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
}

export async function updatePassword(password) {
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function signInWithGoogle() {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/api/auth/callback` },
  });
  if (error) throw error;
  return data;
}

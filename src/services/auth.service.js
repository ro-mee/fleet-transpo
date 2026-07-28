import { createClient } from "@/lib/supabase/client";

export async function signIn(email, password) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password, userData) {
  const supabase = createClient();
  const lowerEmail = email.toLowerCase();
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: lowerEmail,
    password,
    options: { data: userData },
  });
  if (authError) throw authError;

  if (authData.user) {
    const { data: existingEmp } = await supabase
      .from("employees")
      .select("employee_id")
      .eq("email", lowerEmail)
      .single();

    if (existingEmp) {
      await supabase
        .from("employees")
        .update({ user_id: authData.user.id })
        .eq("employee_id", existingEmp.employee_id);
    } else {
      const { error: profileError } = await supabase.from("employees").insert({
        user_id: authData.user.id,
        email: lowerEmail,
        first_name: userData.first_name,
        last_name: userData.last_name,
        role_id: userData.role_id || 1,
      });
      if (profileError) throw profileError;
    }
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

  let { data, error } = await supabase
    .from("employees")
    .select("*, roles(*), branches(*)")
    .eq("user_id", user.id)
    .single();

  if ((error || !data) && user.email) {
    const { data: emailEmp, error: emailErr } = await supabase
      .from("employees")
      .select("*, roles(*), branches(*)")
      .eq("email", user.email.toLowerCase())
      .single();

    if (!emailErr && emailEmp) {
      data = emailEmp;
      if (!data.user_id) {
        await supabase
          .from("employees")
          .update({ user_id: user.id })
          .eq("employee_id", data.employee_id);
        data.user_id = user.id;
      }
    }
  }

  if (error && !data) return null;
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

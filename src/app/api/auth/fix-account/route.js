import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request) {
  const { email } = await request.json();
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const lowerEmail = email.toLowerCase();
  const supabase = createAdminClient();

  // Find user via Supabase Auth Admin API
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  let authUser = users?.find((u) => u.email?.toLowerCase() === lowerEmail);

  // If Auth user does not exist yet, auto-create one with default password
  let isNewUser = false;
  if (!authUser) {
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: lowerEmail,
      password: "Password123!",
      email_confirm: true,
    });

    if (createError) {
      return NextResponse.json({
        error: `Could not create Auth user: ${createError.message}. You can also register manually via the Sign Up page.`,
      }, { status: 500 });
    }
    authUser = newUser.user;
    isNewUser = true;
  }

  const { data: employee, error: empError } = await supabase
    .from("employees")
    .select("employee_id, role_id, user_id")
    .eq("email", lowerEmail)
    .single();

  if (empError || !employee) {
    // If no employee profile exists, auto-create a system_admin employee profile
    const { data: newEmp, error: createEmpErr } = await supabase
      .from("employees")
      .insert({
        user_id: authUser.id,
        email: lowerEmail,
        first_name: "System",
        last_name: "Admin",
        position: "System Administrator",
        role_id: 1, // system_admin
        status: "Active",
      })
      .select()
      .single();

    if (createEmpErr) {
      return NextResponse.json({ error: createEmpErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Created system admin profile and linked account. ${isNewUser ? "Password is: Password123!" : "Please log in."}`,
    });
  }

  const changes = {};
  if (employee.user_id !== authUser.id) {
    changes.user_id = authUser.id;
  }
  if (!employee.role_id) {
    changes.role_id = 1; // system_admin
  }

  if (Object.keys(changes).length > 0) {
    const { error: updateError } = await supabase
      .from("employees")
      .update(changes)
      .eq("employee_id", employee.employee_id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    message: isNewUser
      ? "Created login account with default password 'Password123!' and linked to System Admin profile. You can now log in!"
      : "Successfully linked employee profile to System Admin. Please log in again.",
  });
}

import { createClient } from "@/lib/supabase/server";

export function withRole(allowedRoles) {
  return function (handler) {
    return async function (req, { params } = {}) {
      try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { data: employee, error: empError } = await supabase
          .from("employees")
          .select("*, roles(role_name)")
          .eq("user_id", user.id)
          .single();

        if (empError || !employee) {
          return Response.json({ error: "Employee not found" }, { status: 401 });
        }

        const userRole = employee.roles?.role_name;
        if (!userRole) {
          return Response.json({ error: "Role not assigned" }, { status: 403 });
        }

        if (!allowedRoles.includes("*") && !allowedRoles.includes(userRole)) {
          return Response.json({
            error: "Forbidden",
            message: `Role '${userRole}' is not permitted for this action`,
          }, { status: 403 });
        }

        req.employee = employee;
        req.userRole = userRole;

        return handler(req, { params });
      } catch (error) {
        console.error("API auth error:", error);
        return Response.json({ error: "Internal server error" }, { status: 500 });
      }
    };
  };
}

export function requireRole(allowedRoles) {
  return function (handler) {
    return withRole(allowedRoles)(handler);
  };
}

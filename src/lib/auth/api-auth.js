import { auth } from "@/lib/auth";

export function withRole(allowedRoles) {
  return function (handler) {
    return async function (req, { params } = {}) {
      try {
        const session = await auth();

        if (!session?.user) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userRole = session.user.role;
        if (!userRole) {
          return Response.json({ error: "Role not assigned" }, { status: 403 });
        }

        if (!allowedRoles.includes("*") && !allowedRoles.includes(userRole)) {
          return Response.json({
            error: "Forbidden",
            message: `Role '${userRole}' is not permitted for this action`,
          }, { status: 403 });
        }

        req.user = session.user;
        req.userRole = userRole;
        req.employee = {
          employee_id: session.user.employeeId,
          first_name: session.user.firstName,
          last_name: session.user.lastName,
          email: session.user.email,
          roles: { role_name: userRole },
        };

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

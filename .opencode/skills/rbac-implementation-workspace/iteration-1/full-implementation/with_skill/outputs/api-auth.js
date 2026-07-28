import { createClient } from '@/lib/supabase/server';

export function withRole(allowedRoles) {
  return function middleware(handler) {
    return async function handlerWithRole(request, context) {
      const supabase = await createClient();

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return Response.json(
          { error: 'Unauthorized — not authenticated' },
          { status: 401 }
        );
      }

      const { data: employee } = await supabase
        .from('employees')
        .select('*, roles(role_name)')
        .eq('user_id', user.id)
        .single();

      if (!employee || !employee.roles) {
        return Response.json(
          { error: 'Unauthorized — no employee profile' },
          { status: 401 }
        );
      }

      const role = employee.roles.role_name;
      if (!allowedRoles.includes(role)) {
        return Response.json(
          { error: `Forbidden — role '${role}' not permitted for this action` },
          { status: 403 }
        );
      }

      request.employee = employee;
      request.userRole = role;

      return handler(request, context);
    };
  };
}

export async function getServerRole() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { role: null, employee: null };

  const { data: employee } = await supabase
    .from('employees')
    .select('*, roles(role_name)')
    .eq('user_id', user.id)
    .single();

  return {
    role: employee?.roles?.role_name ?? null,
    employee: employee ?? null,
  };
}

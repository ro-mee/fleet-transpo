# Service Layer — API Middleware & Server-Side Checks

This reference file provides patterns for implementing API route middleware and service-layer role checks as described in `docs/rbac-model.md` Section 6.4.

## Prerequisites

- Read `docs/rbac-model.md` Section 6.4 (API Route Middleware)
- Read existing API routes in `src/app/api/` to understand the current pattern
- Read `src/services/auth.service.js` for the `getCurrentEmployee` function
- Read `src/lib/supabase/` to understand how server and admin clients are created

## File 1: API Auth Middleware

Create `src/lib/auth/api-auth.js`:

```javascript
import { createServerClient } from '@/lib/supabase/server';

/**
 * Higher-order function that wraps an API route handler with role-based access control.
 *
 * @param {string[]} allowedRoles - Array of role names permitted to access this endpoint
 * @returns {function} Middleware-wrapped handler
 *
 * Usage:
 *   export const POST = withRole(['admin', 'fleet_manager', 'system_admin'])(async (req) => {
 *     const body = await req.json();
 *     return Response.json({ success: true });
 *   });
 */
export function withRole(allowedRoles) {
  return function middleware(handler) {
    return async function handlerWithRole(request, context) {
      const supabase = await createServerClient();

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

      // Attach the employee and role to the request for downstream use
      request.employee = employee;
      request.userRole = role;

      return handler(request, context);
    };
  };
}

/**
 * Get the current authenticated user's role from a server context.
 * Useful in server components or server actions.
 *
 * @returns {Promise<{role: string|null, employee: object|null}>}
 */
export async function getServerRole() {
  const supabase = await createServerClient();

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
```

## Applying Middleware to API Routes

### Pattern 1: Full Route Protection

The entire handler is protected:

```javascript
import { withRole } from '@/lib/auth/api-auth';

export const POST = withRole(['admin', 'fleet_manager', 'system_admin'])(async (req) => {
  const body = await req.json();
  // req.employee and req.userRole are available here
  return Response.json({ message: 'Created' }, { status: 201 });
});
```

### Pattern 2: Mixed Public/Protected Methods

Different HTTP methods need different access levels:

```javascript
import { withRole } from '@/lib/auth/api-auth';

const protectedHandler = withRole(['admin', 'fleet_manager', 'system_admin']);

export async function GET(request) {
  // Public read — no role check needed
  // RLS at the database level handles row-level filtering
  return Response.json({ data: [] });
}

export const POST = protectedHandler(async (req) => {
  return Response.json({ message: 'Created' }, { status: 201 });
});

export const DELETE = withRole(['admin', 'system_admin'])(async (req) => {
  return Response.json({ message: 'Deleted' });
});
```

### Pattern 3: Check Within Service Layer

For service functions that are called from multiple places (API routes, edge functions, webhooks):

```javascript
import { createAdminClient } from '@/lib/supabase/admin';

export async function createVehicle(data, requestingUser) {
  if (!requestingUser?.role || !['admin', 'fleet_manager', 'system_admin'].includes(requestingUser.role)) {
    throw new Error('Forbidden');
  }

  const supabase = createAdminClient();
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .insert(data)
    .select()
    .single();

  if (error) throw error;
  return vehicle;
}
```

## Integration with Existing Services

The service files in `src/services/` use Supabase client directly. The simplest approach is to pass the authenticated user's role as a parameter:

```javascript
export async function getVehicles(userRole) {
  const supabase = createClient();

  // RLS handles row-level filtering, but for service-level logic:
  if (userRole === 'driver') {
    // Drivers see assigned vehicles only
    return getAssignedVehicles();
  }

  const { data } = await supabase.from('vehicles').select('*');
  return data;
}
```

## API Routes to Protect

Based on `docs/rbac-model.md` Section 4, these mutation endpoints need protection:

| Endpoint | Allowed Roles |
|---|---|
| POST/PUT/DELETE `/api/vehicles` | admin, fleet_manager, system_admin |
| POST/PUT/DELETE `/api/drivers` | admin, fleet_manager, system_admin |
| POST/PUT/DELETE `/api/reservations` | admin, system_admin, fleet_manager, dispatcher |
| POST/PUT/DELETE `/api/dispatch` | admin, system_admin, fleet_manager, dispatcher |
| POST/PUT/DELETE `/api/trips` | admin, system_admin, fleet_manager, dispatcher |
| POST/PUT/DELETE `/api/fuel` | admin, system_admin, fleet_manager |
| POST/PUT/DELETE `/api/maintenance` | admin, fleet_manager, system_admin |
| POST/PUT/DELETE `/api/routes` | admin, fleet_manager, dispatcher, system_admin |
| GET `/api/analytics`, `/api/reports` | admin, fleet_manager, management, system_admin |
| Any `/api/settings`, `/api/system` | admin, system_admin |
| GET `/api/audit-logs` | admin, system_admin |

## Testing the Middleware

After applying middleware, test each endpoint:

```bash
# As driver — should be 403
curl -X POST http://localhost:3000/api/vehicles \
  -H "Cookie: <driver-session>" \
  -H "Content-Type: application/json" \
  -d '{}'

# Expected: {"error":"Forbidden — role 'driver' not permitted for this action"}
```

## Verification Checklist

- [ ] Every POST/PUT/DELETE API route has `withRole()` or inline role check
- [ ] Every GET route that returns sensitive data has a role check or relies on RLS
- [ ] Response format is consistent: `{ error: string }` with 401 or 403
- [ ] Service-layer functions that bypass RLS (admin client) have explicit role checks

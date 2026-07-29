# Auth Migration Plan: Supabase → Auth.js + Direct PostgreSQL

## Architecture

```
Before:  Browser ──► supabase-js ──► Supabase Auth API + RLS ──► PostgreSQL
After:   Browser ──► Auth.js + pg ──► Direct PostgreSQL (same Supabase PG until prod server ready)
```

## Password Strategy
- **Existing users**: Password reset required (one-time). Update `employees.password_hash` with bcrypt hash during reset.
- **New users**: `bcrypt.hash()` on registration, stored in `employees.password_hash`.
- **Login**: Auth.js Credentials provider → `bcrypt.compare()` against `employees.password_hash`.
- **DATABASE_URL**: Added later when we have the password. Not needed to start — service files will use a Supabase-compatible approach initially (see Phase 4).

---

## Phase 1: Database Prep

### 1.1 — Add password_hash column
```sql
ALTER TABLE employees ADD COLUMN password_hash TEXT;
```

### 1.2 — Seed a test user with a known password
For immediate testing, insert one admin user with a known bcrypt hash so we can log in right away.

---

## Phase 2: Foundation (New Files)

### 2.1 — Install
```bash
npm install next-auth bcryptjs
npm install -D @types/bcryptjs
```

### 2.2 — Environment Variables (add to .env.local)
```
AUTH_SECRET=<run `npx auth secret` to generate>
AUTH_URL=http://localhost:3000
```

(DATABASE_URL added later when we have the password)

### 2.3 — Create `src/lib/db.js`
```javascript
import { Pool } from "pg";

let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}
```
Lazy init so the app works without DATABASE_URL until Phase 4.

### 2.4 — Create `src/lib/auth.js`
```javascript
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      async authorize(credentials) {
        const pool = getPool();
        const { rows } = await pool.query(
          `SELECT e.*, r.role_name, b.branch_id as branch_id
           FROM employees e
           JOIN roles r ON e.role_id = r.role_id
           JOIN branches b ON e.branch_id = b.branch_id
           WHERE e.email = $1 AND e.deleted_at IS NULL`,
          [credentials.email]
        );
        const employee = rows[0];
        if (!employee) return null;
        const valid = await bcrypt.compare(credentials.password, employee.password_hash);
        if (!valid) return null;
        return {
          id: String(employee.employee_id),
          email: employee.email,
          name: `${employee.first_name} ${employee.last_name}`,
          role: employee.role_name,
          employeeId: employee.employee_id,
          branchId: employee.branch_id,
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.employeeId = user.employeeId;
        token.branchId = user.branchId;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.role = token.role;
      session.user.employeeId = token.employeeId;
      session.user.branchId = token.branchId;
      session.user.name = token.name;
      return session;
    }
  },
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
});
```

### 2.5 — Create `src/app/api/auth/[...nextauth]/route.js`
```javascript
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

---

## Phase 3: Replace Auth Context

### 3.1 — `src/hooks/use-auth.js`
Rewrite to use `useSession()` from `next-auth/react`. Keep the same return shape so all consumers work unchanged:
```javascript
{
  user,          // session.user
  employee: {    // reconstructed to match old shape
    employee_id: session.user.employeeId,
    roles: { role_name: session.user.role },
    branches: { branch_id: session.user.branchId },
    first_name, last_name, email: session.user.email
  },
  loading,       // status === "loading"
  signOut        // () => signOut({ callbackUrl: "/login" })
}
```

### 3.2 — `src/components/providers.jsx`
Replace `<AuthProvider>` with `<SessionProvider>` from `next-auth/react`.

### 3.3 — Login page
Replace `supabase.auth.signInWithPassword()` with:
```javascript
import { signIn } from "next-auth/react";
const result = await signIn("credentials", {
  email, password, redirect: false
});
if (result.ok) router.push("/dashboard");
```

### 3.4 — Register page
Replace Supabase signup with:
```javascript
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
const hash = await bcrypt.hash(password, 10);
await pool.query(
  `INSERT INTO employees (email, first_name, last_name, password_hash, role_id, branch_id)
   VALUES ($1, $2, $3, $4, $5, $6)`,
  [email, firstName, lastName, hash, roleId, branchId]
);
```

### 3.5 — Password reset page
Replace Supabase `updateUser()` with:
```javascript
const hash = await bcrypt.hash(newPassword, 10);
await pool.query(`UPDATE employees SET password_hash = $1 WHERE email = $2`, [hash, email]);
```

---

## Phase 4: Migrate Service Files (All at Once)

### Pattern — Replace `supabase.from()` with `pool.query()`:

| Supabase | pg |
|---|---|
| `.select("*")` | `SELECT *` |
| `.eq("id", val)` | `WHERE id = $1` (parameterized) |
| `.single()` | `LIMIT 1`, `rows[0]` |
| `.order()` | `ORDER BY` |
| `.insert({}).select().single()` | `INSERT INTO ... RETURNING *` |
| `.update({}).eq("id", val).select().single()` | `UPDATE ... SET ... WHERE id = $1 RETURNING *` |
| `.delete().eq("id", val)` | `UPDATE ... SET deleted_at = NOW() WHERE id = $1` |
| `select("*, roles(*)")` | `JOIN roles` |

### Files to migrate (all 13):
1. `src/services/vehicle.service.js`
2. `src/services/driver.service.js`
3. `src/services/reservation.service.js`
4. `src/services/dispatch.service.js`
5. `src/services/trip.service.js`
6. `src/services/fuel.service.js`
7. `src/services/route.service.js`
8. `src/services/ai.service.js`
9. `src/services/notification.service.js`
10. `src/services/report.service.js`
11. `src/services/integration.service.js`
12. `src/services/auth.service.js`
13. `src/services/status.service.js`

### Transition trick
To avoid needing DATABASE_URL immediately: create a `src/lib/db.js` that wraps `@supabase/supabase-js` as a fallback when `DATABASE_URL` is not set. This way the app runs during development while we incrementally convert queries.

Actually, simpler: **keep the Supabase client alive during migration**. The converted queries use `pool.getPool()`, unconverted ones still use `createClient()`. Once all files are converted, remove Supabase clients.

---

## Phase 5: API Middleware & Guards

### 5.1 — `src/lib/auth/api-auth.js`
```javascript
import { auth } from "@/lib/auth";

export function withRole(allowedRoles) {
  return function (handler) {
    return async function (req, context) {
      const session = await auth();
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (!allowedRoles.includes(session.user.role)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      req.user = session.user;
      return handler(req, context);
    };
  };
}
```

### 5.2 — Frontend guards (role-guard.js, use-role-access.js)
No changes needed — they read `employee.roles.role_name` from `useAuth()`, which we keep compatible.

---

## Phase 6: Cleanup

### 6.1 — Delete Supabase client files:
- `src/lib/supabase/client.js`
- `src/lib/supabase/server.js`

### 6.2 — Remove RLS migration file:
- `supabase/migrations/008_rbac_policies.sql`

### 6.3 — Final verification:
- system_admin sees all 18 modules
- All CRUD operations work
- Role restrictions gate correctly
- Build passes (`npm run build`)

---

## Rollback

| Problem | Fix |
|---|---|
| Auth breaks | Revert `use-auth.js`, `providers.jsx` |
| Queries break | Revert individual service files |
| Total failure | `git checkout -- src/` + restore originals |

---

## Files Changed Summary

| Action | Count | Files |
|---|---|---|
| **New** | 3 | `lib/db.js`, `lib/auth.js`, `api/auth/[...nextauth]/route.js` |
| **Modified** | ~18 | `use-auth.js`, `providers.jsx`, login/register/reset pages, `api-auth.js`, 13 service files |
| **Deleted** | 2 | `lib/supabase/client.js`, `lib/supabase/server.js` |

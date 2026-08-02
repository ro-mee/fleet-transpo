// Test double for src/lib/auth.js, injected by scripts/route-harness-loader.mjs.
//
// The real module builds a NextAuth handler around bcrypt credentials and a
// cookie-backed JWT. A harness cannot mint that cookie without a plaintext
// password, and inventing one would test the harness rather than the routes.
//
// So instead of forging a session, this stub replaces the ONE function the API
// boundary actually consumes — auth() — and lets the harness declare who the
// caller is. Everything downstream stays real: requireAuth() does its own role
// check, the route logic runs untouched, and a 401/403 comes from production
// code rather than from a mock.
//
// Set globalThis.__HARNESS_SESSION__ to a session-shaped object (or null for an
// unauthenticated caller) before invoking a route handler.

export async function auth() {
  return globalThis.__HARNESS_SESSION__ ?? null;
}

// Present so the module's shape matches src/lib/auth.js; unused by the harness.
export const authOptions = {};

// Canonical Super Admin role helpers.
//
// Role id 1 is `super_admin` in code and in the live database (migration
// 118). normalizeRoleName() is intentionally an identity function: it exists
// so every role comparison flows through one chokepoint, and so an unknown
// or legacy name fails closed instead of aliasing to a privilege.
export const SUPER_ADMIN_ROLE = "super_admin";

export function normalizeRoleName(role) {
  return role;
}

export function isSuperAdmin(role) {
  return normalizeRoleName(role) === SUPER_ADMIN_ROLE;
}

// Every role resolves to exactly its own DB literal.
export function roleNamesForDb(role) {
  return [normalizeRoleName(role)];
}

// Normalize an allow-list (kept for call-site uniformity).
export function normalizeRoleList(roles) {
  if (!Array.isArray(roles)) return roles;
  return roles.map((r) => (r === "*" ? r : normalizeRoleName(r)));
}

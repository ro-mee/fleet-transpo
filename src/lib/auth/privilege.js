// Privileged-account hierarchy for the Super Admin / Admin split.
//
// Two different paths mutate accounts, and each is guarded explicitly:
//   - assignment (POST /api/auth/register) → canAssignRole()
//   - target mutation (enable/disable, credential reset) → canMutateAccount()
//
// Hierarchy:
//   super_admin → super_admin, admin, fleet_manager, dispatcher, management
//   admin       → fleet_manager, dispatcher, management
// Driver accounts are managed through the Drivers Directory, never here.
import { ROLE_IDS } from "@/lib/constants";
import {
  normalizeRoleName,
  SUPER_ADMIN_ROLE,
} from "@/lib/auth/role-names";

const ROLE_NAME_BY_ID = {
  [ROLE_IDS.super_admin]: "super_admin",
  [ROLE_IDS.fleet_manager]: "fleet_manager",
  [ROLE_IDS.dispatcher]: "dispatcher",
  [ROLE_IDS.driver]: "driver",
  [ROLE_IDS.management]: "management",
  [ROLE_IDS.admin]: "admin",
};

const SUPER_ADMIN_ASSIGNABLE = new Set([
  "super_admin",
  "admin",
  "fleet_manager",
  "dispatcher",
  "management",
]);

const ADMIN_ASSIGNABLE = new Set([
  "fleet_manager",
  "dispatcher",
  "management",
]);

// Roles whose accounts only a Super Admin may mutate.
const PRIVILEGED_TARGETS = new Set(["super_admin", "admin"]);

// Live role names. Unknown names fail closed — they must never alias to a
// privilege and must never fall through to staff scope.
const KNOWN_ROLES = new Set([
  "super_admin",
  "admin",
  "fleet_manager",
  "dispatcher",
  "management",
  "driver",
]);

export function roleNameForId(roleId) {
  return ROLE_NAME_BY_ID[Number(roleId)] ?? null;
}

export function canAssignRole(actorRole, roleId) {
  const actor = normalizeRoleName(actorRole);
  const target = roleNameForId(roleId);
  if (!target) return false;
  if (actor === SUPER_ADMIN_ROLE) return SUPER_ADMIN_ASSIGNABLE.has(target);
  if (actor === "admin") return ADMIN_ASSIGNABLE.has(target);
  return false;
}

export function assignRejectionHint(roleId) {
  const target = roleNameForId(roleId);
  if (target === "driver") {
    return "Driver accounts are created through the Drivers Directory.";
  }
  if (target === "super_admin" || target === "admin") {
    return "Only a Super Admin can grant privileged roles.";
  }
  return "You are not permitted to assign this role.";
}

export function canMutateAccount(actorRole, targetRoleName) {
  const actor = normalizeRoleName(actorRole);
  const target = normalizeRoleName(targetRoleName);
  if (!target || !KNOWN_ROLES.has(target)) return false;
  if (!KNOWN_ROLES.has(actor)) return false;
  if (PRIVILEGED_TARGETS.has(target)) return actor === SUPER_ADMIN_ROLE;
  return actor === SUPER_ADMIN_ROLE || actor === "admin";
}

export function isPrivilegedTarget(roleName) {
  return PRIVILEGED_TARGETS.has(normalizeRoleName(roleName));
}

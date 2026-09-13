/**
 * Shared password-policy validation for the driver credential screens.
 *
 * Pure, unit-tested, RN-import-free (same rule as offline-ux.js: logic that
 * lives inline in screens never gets unit-tested). Both the authenticated
 * change-password screen and the public reset-password screen consume these
 * helpers so the two surfaces enforce one policy.
 *
 * The policy mirrors the server (`type: "password"` in
 * src/lib/validation/helpers.js) and the web Settings > Security form
 * (src/app/(dashboard)/settings/security/page.js):
 * - at least 8 characters
 * - at least one lowercase letter, one uppercase letter, one number,
 *   one special character
 * - no more than 72 UTF-8 bytes (bcrypt limit)
 * - the new password must differ from the current one (change flow only)
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

function utf8Length(value) {
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return String(value).length;
  }
}

/**
 * Per-requirement checklist state for the new-password field, in the order
 * the web security page renders them.
 * @param {string} value
 * @returns {Array<{key: string, label: string, valid: boolean}>}
 */
export function passwordRequirementChecks(value = "") {
  const v = String(value || "");
  return [
    { key: "length", label: "At least 8 characters", valid: v.length >= PASSWORD_MIN_LENGTH },
    { key: "lowercase", label: "A lowercase letter", valid: /[a-z]/.test(v) },
    { key: "uppercase", label: "An uppercase letter", valid: /[A-Z]/.test(v) },
    // /\d/ deliberately (not [0-9]): byte-identical to the server's
    // hasPasswordNumber in src/lib/validation/index.js.
    { key: "number", label: "A number", valid: /\d/.test(v) },
    { key: "special", label: "A special character", valid: /[^A-Za-z0-9]/.test(v) },
  ];
}

/**
 * Validate a candidate new password. Returns the first failure message, or
 * null when the value satisfies the policy.
 * @param {string} value
 * @param {{currentPassword?: string}} [options]
 * @returns {string|null}
 */
export function validateNewPassword(value, { currentPassword } = {}) {
  const v = String(value || "");
  if (!v) return "New password is required.";
  if (utf8Length(v) > PASSWORD_MAX_BYTES) {
    return `Password must be no more than ${PASSWORD_MAX_BYTES} UTF-8 bytes.`;
  }
  if (v.length < PASSWORD_MIN_LENGTH) return "Password must be at least 8 characters.";
  if (!/[a-z]/.test(v)) return "Password must contain at least one lowercase letter.";
  if (!/[A-Z]/.test(v)) return "Password must contain at least one uppercase letter.";
  if (!/\d/.test(v)) return "Password must contain at least one number.";
  if (!/[^A-Za-z0-9]/.test(v)) return "Password must contain at least one special character.";
  if (currentPassword != null && v === String(currentPassword)) {
    return "New password must be different from the current password.";
  }
  return null;
}

/**
 * Validate the confirm-password field against the new password.
 * @param {string} newPassword
 * @param {string} confirm
 * @returns {string|null}
 */
export function validateConfirmPassword(newPassword, confirm) {
  if (!String(confirm || "")) return "Confirm password is required.";
  if (String(confirm) !== String(newPassword)) return "Passwords do not match.";
  return null;
}

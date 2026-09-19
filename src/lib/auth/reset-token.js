import { createHash, randomBytes } from "node:crypto";
import { withTransaction } from "@/lib/db";

export function createResetToken() {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// Server-only: writes password_reset_tokens, so routes (never client
// components) may import this. Shared by the administrator-issued
// POST /api/auth/reset-token and the self-service POST /api/auth/forgot-password
// so both mint the same 30-minute single-use token shape the reset endpoint
// consumes. Only the token hash is stored; the plaintext returns once.

export const RESET_TOKEN_TTL = "30 minutes";

export async function issueResetToken(employeeId) {
  let origin;
  try {
    origin = new URL(process.env.NEXT_PUBLIC_APP_URL).origin;
  } catch {
    throw new Error("Application URL is not configured");
  }

  const token = createResetToken();
  const tokenHash = hashResetToken(token);
  await withTransaction(async (tx) => {
    await tx.query(
      `DELETE FROM password_reset_tokens
         WHERE employee_id = $1 AND used_at IS NULL`,
      [employeeId]
    );
    await tx.query(
      `INSERT INTO password_reset_tokens (employee_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [employeeId, tokenHash]
    );
  });

  return {
    token,
    resetUrl: `${origin}/reset-password?token=${encodeURIComponent(token)}`,
  };
}

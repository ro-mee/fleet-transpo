import { createHash, randomBytes } from "node:crypto";

export function createResetToken() {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { Secret, TOTP } from "otpauth";
import { query } from "@/lib/db";

const ISSUER = "FleetOps";
const TOTP_PERIOD_SECONDS = 30;
const MFA_CODE_WINDOW = 1;

function encryptionKey() {
  let configured = process.env.MFA_ENCRYPTION_KEY;
  if (!configured && process.env.NODE_ENV !== "production") {
    configured = process.env.NEXTAUTH_SECRET;
    if (configured) {
      console.warn("MFA_ENCRYPTION_KEY is not set; deriving a development-only key from NEXTAUTH_SECRET.");
    }
  }
  if (!configured) throw new Error("MFA_ENCRYPTION_KEY is not set.");
  if (/^[a-f0-9]{64}$/i.test(configured)) return Buffer.from(configured, "hex");
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length === 32) return decoded;
  if (process.env.NODE_ENV === "production") {
    throw new Error("MFA_ENCRYPTION_KEY must be a 32-byte hex or base64 key in production.");
  }
  // ponytail: accept a development passphrase while production requires a raw 32-byte key.
  return createHash("sha256").update(configured).digest();
}

export function encryptSecret(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    secretCiphertext: ciphertext.toString("base64"),
    secretIv: iv.toString("base64"),
    secretTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(row) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(row.secret_iv || row.secretIv, "base64")
  );
  decipher.setAuthTag(Buffer.from(row.secret_tag || row.secretTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.secret_ciphertext || row.secretCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateSecret() {
  return Secret.generate().base32;
}

export function createTotp(secret, label) {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secret),
  });
}

export function verifyTotp(secret, code, timestamp = Date.now()) {
  const token = String(code || "").replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(token)) return null;
  const totp = createTotp(secret, ISSUER);
  const delta = totp.validate({ token, timestamp, window: MFA_CODE_WINDOW });
  if (delta === null) return null;
  return {
    delta,
    step: TOTP.counter({ period: TOTP_PERIOD_SECONDS, timestamp }) + delta,
  };
}

export async function qrDataUrl(uri) {
  return QRCode.toDataURL(uri, {
    width: 220,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}

export function recoveryCodeHash(code) {
  return createHash("sha256")
    .update(String(code || "").replace(/[\s-]/g, "").toUpperCase())
    .digest("hex");
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => randomBytes(10).toString("hex").toUpperCase());
}

export async function verifyCurrentPassword(employeeId, password) {
  const { rows } = await query(
    `SELECT password_hash FROM employees
      WHERE employee_id = $1 AND deleted_at IS NULL AND status = 'Active'`,
    [employeeId]
  );
  return bcrypt.compare(
    String(password || ""),
    rows[0]?.password_hash || "$2b$10$c9wQOSTVJPfSVsx6lrokNeg.W0aGtDnZreMk1p4JMIEXKaFPu.bkW"
  );
}

/**
 * Verifies and atomically consumes an enrolled TOTP or recovery code.
 * The caller must provide a transaction client; TOTP step replay is guarded by
 * the row lock and recovery codes are single-use at the database boundary.
 */
export async function consumeFactor(tx, employeeId, code) {
  const { rows } = await tx.query(
    `SELECT secret_ciphertext, secret_iv, secret_tag, enabled_at, last_used_step
       FROM employee_mfa
      WHERE employee_id = $1
      FOR UPDATE`,
    [employeeId]
  );
  const factor = rows[0];
  if (!factor?.enabled_at) return { ok: false, reason: "not_enabled" };

  const secret = decryptSecret(factor);
  const totp = verifyTotp(secret, code);
  if (totp) {
    if (factor.last_used_step != null && Number(factor.last_used_step) >= totp.step) {
      return { ok: false, reason: "replay" };
    }
    await tx.query(
      `UPDATE employee_mfa SET last_used_step = $2, updated_at = NOW() WHERE employee_id = $1`,
      [employeeId, totp.step]
    );
    return { ok: true, method: "totp", step: totp.step };
  }

  const { rows: used } = await tx.query(
    `UPDATE mfa_recovery_codes
        SET used_at = NOW()
      WHERE recovery_code_id = (
        SELECT recovery_code_id
          FROM mfa_recovery_codes
         WHERE employee_id = $1 AND code_hash = $2 AND used_at IS NULL
         ORDER BY recovery_code_id
         LIMIT 1
         FOR UPDATE
      )
      RETURNING recovery_code_id`,
    [employeeId, recoveryCodeHash(code)]
  );
  return used.length ? { ok: true, method: "recovery" } : { ok: false, reason: "invalid" };
}

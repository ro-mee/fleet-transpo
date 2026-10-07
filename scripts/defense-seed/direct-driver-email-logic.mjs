import { createHash } from "node:crypto";
import { slugName } from "./name-accounts-logic.mjs";

export const DIRECT_EMAIL_KEY = "seed:defense-direct-emails-2026-10";
export const DIRECT_DRIVER_KEYS = Object.freeze(["D04", "D05", "D06", "D07", "D08", "D09", "D10"]);

export function directDriverEmail(driver) {
  if (!DIRECT_DRIVER_KEYS.includes(driver.driver_key)) throw new Error(`Unexpected direct-email target ${driver.driver_key}`);
  return `${slugName(driver.first_name, driver.last_name)}@gmail.com`;
}

export function gmailMailboxKey(email) {
  const [local, domain] = String(email ?? "").trim().toLowerCase().split("@");
  if (!["gmail.com", "googlemail.com"].includes(domain)) return null;
  return local.split("+")[0].replaceAll(".", "");
}

export function directEmailDigest(targets) {
  const stable = targets.map(({ driver_key, driver_id, employee_id, first_name, last_name, old_email, new_email, auth_version }) =>
    ({ driver_key, driver_id, employee_id, first_name, last_name, old_email, new_email, auth_version }));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

export function directEmailEventKey(employeeId, direction) {
  const hex = createHash("sha256").update(`${DIRECT_EMAIL_KEY}:${employeeId}:${direction}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

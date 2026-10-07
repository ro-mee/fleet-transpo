import { createHash } from "node:crypto";

export const DEFENSE_KEY = "seed:defense-2026-10";
export const ROTATION_KEY = "seed:defense-accounts-2026-10";
export const BASE_INBOXES = Object.freeze([
  "romarroms123@gmail.com", "arvild10.4@gmail.com", "yy.yujin.han.nn@gmail.com",
]);
export const DIRECT = Object.freeze({
  D01: "romarroms123@gmail.com", D02: "arvild10.4@gmail.com", D03: "yy.yujin.han.nn@gmail.com",
});
export const BASE_FOR = Object.freeze({
  D04: BASE_INBOXES[0], D05: BASE_INBOXES[1], D06: BASE_INBOXES[2],
  D07: BASE_INBOXES[0], D08: BASE_INBOXES[1], D09: BASE_INBOXES[2], D10: BASE_INBOXES[0],
});

export function slugName(first, last) {
  const value = `${first ?? ""} ${last ?? ""}`.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const tokens = value.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (tokens.length < 2) throw new Error(`Driver name must have first and last name: ${first} ${last}`);
  return tokens.join(".");
}

export function desiredEmail(driver) {
  if (DIRECT[driver.driver_key]) return DIRECT[driver.driver_key];
  const base = BASE_FOR[driver.driver_key];
  if (!base) throw new Error(`No controlled base inbox configured for ${driver.driver_key}`);
  return base.replace("@", `+${slugName(driver.first_name, driver.last_name)}@`);
}

export function digest(targets) {
  const stable = targets.map(({ driver_key, driver_id, employee_id, first_name, last_name, new_email }) =>
    ({ driver_key, driver_id, employee_id, first_name, last_name, new_email }));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

export function eventKey(employeeId, direction) {
  const hex = createHash("sha256").update(`seed:defense-accounts-2026-10:${employeeId}:${direction}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Generic reader/writer for `system_settings`, with a short per-instance cache.
 *
 * Server-only — imports `@/lib/db`, which throws if bundled for the browser.
 *
 * WHY A CACHE EXISTS AT ALL
 * -------------------------
 * The table previously had no shared reader: each key grew its own hand-rolled
 * `SELECT ... WHERE setting_key = $1`, and every call was a round trip. That
 * was tolerable for `dispatch_policy`, read a handful of times per page. It is
 * not tolerable for `security_policy`, which the login path and every session
 * INSERT read — an uncached read would add a database round trip to the hottest
 * code in the application.
 *
 * STALENESS IS BOUNDED AND DELIBERATE
 * -----------------------------------
 * This is a per-instance cache. On a single Node process a save invalidates the
 * key immediately (see `setSetting`), but on serverless each instance has its
 * own Map, so another instance can serve the previous value until its TTL
 * lapses. 30 seconds is the ceiling on that. This is the same stance as the
 * weather cache in src/lib/weather.js: durable state lives in Postgres, the
 * cache only exists to stop a read amplifying, and no caller may treat it as
 * the source of truth.
 *
 * A MISSING ROW IS CACHED TOO. Before an administrator has ever saved
 * `security_policy` the row does not exist, and without a negative cache every
 * login would query for it and miss — the default path is the common path.
 */

import { query } from "@/lib/db";

/** Upper bound on how long a value may be served after another instance saves it. */
const CACHE_TTL_MS = 30 * 1000;

/** key → { expiresAt, value } where `value` is null for a row that does not exist. */
const cache = new Map();

/**
 * Read one setting's raw JSON value, or `fallback` when the row is absent.
 *
 * Throws if the database is unreachable, exactly as `getDispatchPolicy` does —
 * login already performs a write against the same database, so a settings read
 * introduces no failure mode that did not already exist. A failed read is NOT
 * cached; the next call retries.
 *
 * @param {string} key      `system_settings.setting_key`
 * @param {*}      [fallback] returned when no row exists
 * @returns {Promise<*>}
 */
export async function getSetting(key, fallback = null) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value ?? fallback;

  const { rows } = await query(
    `SELECT setting_value FROM system_settings WHERE setting_key = $1`,
    [key]
  );
  const value = rows[0]?.setting_value ?? null;
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
  return value ?? fallback;
}

/**
 * Upsert one setting and drop its cached entry so the next read is current.
 *
 * @param {string} key
 * @param {*}      value  JSON-serialisable
 * @param {?number} actorId `employees.employee_id`, or null for a system writer
 */
export async function setSetting(key, value, actorId = null) {
  await query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value,
                   updated_at   = NOW(),
                   updated_by   = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), actorId || null]
  );
  cache.delete(key);
}

/**
 * Synchronous view of a cached value — NO database access, NO awaiting.
 *
 * Returns `undefined` when the key has never been read on this instance, and
 * `null` when it was read and no row exists. Callers must treat `undefined`
 * ("don't know yet") differently from `null` ("there is no row"), because only
 * the latter is an answer.
 *
 * Exists for the one consumer that cannot await: NextAuth spreads
 * `authOptions.session` while building its per-request options, before any of
 * our code runs, so the configured absolute session lifetime can only reach it
 * as a property getter over a value already in hand. Every other caller should
 * use `getSetting`.
 *
 * @param {string} key
 * @returns {*|null|undefined}
 */
export function peekSetting(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  return hit.value;
}

/**
 * Warm the cache for a key in the background, so a later `peekSetting` has an
 * answer. Never rejects — a failed warm-up simply leaves the entry uncached and
 * the next real read tries again.
 *
 * @param {string} key
 * @param {*} [fallback] value to cache if no row exists
 */
export function warmSetting(key, fallback = null) {
  getSetting(key, fallback).catch(() => {});
}

/** Drop everything — used by tests and by HMR-adjacent resets. */
export function clearSettingCache() {
  cache.clear();
}

import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";

let client;
let pool;

function assertServerOnly(name) {
  if (typeof window !== "undefined") {
    throw new Error(`${name}() is server-only. Use API routes from the client.`);
  }
}

export function getAdminClient() {
  assertServerOnly("getAdminClient");
  if (!client) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
    }
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: {
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      }
    );
  }
  return client;
}

export function getPool() {
  assertServerOnly("getPool");
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set.");
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function query(text, params = []) {
  assertServerOnly("query");
  const result = await getPool().query(text, params);
  return {
    rows: result.rows,
    rowCount: result.rowCount ?? result.rows.length,
  };
}

/**
 * Run `fn` inside a single transaction on a dedicated pooled client.
 *
 * `query()` above checks a connection out per call, so two statements from it can
 * land on different clients and cannot share a transaction. Anything that must be
 * all-or-nothing needs this instead — notably reassigning a driver's vehicle,
 * where the old pairing has to close and the new one open atomically or the
 * `uq_dva_active_*` partial unique indexes reject the pair mid-flight.
 *
 * `fn` receives an object exposing the same `{ rows, rowCount }` shape as
 * `query()`, so callers written against `query` port over unchanged. Throwing
 * from `fn` rolls back and re-throws; the client is always released.
 *
 * @template T
 * @param {(tx: { query: (text: string, params?: any[]) => Promise<{rows: any[], rowCount: number}> }) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  assertServerOnly("withTransaction");
  const client = await getPool().connect();
  const tx = {
    query: async (text, params = []) => {
      const result = await client.query(text, params);
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? result.rows.length,
      };
    },
  };
  try {
    await client.query("BEGIN");
    const out = await fn(tx);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    // Best-effort rollback: if the connection itself died the ROLLBACK will also
    // fail, and the original error is the one worth surfacing.
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

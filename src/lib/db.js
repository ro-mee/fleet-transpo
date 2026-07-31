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

import { createClient } from "@supabase/supabase-js";

let client;

export function getAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("getAdminClient() is server-only. Use API routes from the client.");
  }
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

export async function query(text, params = []) {
  if (typeof window !== "undefined") {
    throw new Error("query() is server-only. Use API routes from the client.");
  }
  const supabase = getAdminClient();
  const { data, error } = await supabase.rpc("exec_query", {
    sql: text,
    params,
  });
  if (error) throw error;

  if (Array.isArray(data)) return { rows: data };
  if (data && typeof data === "object") {
    if ("rowCount" in data && Object.keys(data).length === 1) {
      return { rowCount: data.rowCount };
    }
    return { rows: [data] };
  }
  return { rows: [] };
}

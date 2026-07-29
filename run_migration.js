const fs = require("fs");
const sql = fs.readFileSync("supabase/migrations/009_auth_migration.sql", "utf8");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Try via rpc
  const { data, error } = await supabase.rpc("exec_sql", { query: sql });
  if (error) {
    console.log("rpc failed:", error.message);
    // Try direct fetch
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`,
      {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      }
    );
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
    process.exit(res.ok ? 0 : 1);
  }
  console.log("Migration result:", data);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});

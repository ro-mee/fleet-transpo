import { readFile } from "node:fs/promises";
import { planTypedDemo, seedTypedDemo, removeTypedDemo } from "./lib/typed-demo.mjs";

// plan never loads environment files or opens a connection. up/down are
// deliberately limited to an explicitly selected local, disposable database.
const [command = "plan", manifestPath] = process.argv.slice(2);
try {
  if (!["plan", "up", "down"].includes(command)) throw new Error("Use plan <manifest.json>, up <manifest.json>, or down.");
  const manifest = command === "down" ? null : JSON.parse(await readFile(manifestPath, "utf8"));
  if (command === "plan") {
    console.log(JSON.stringify(planTypedDemo(manifest), null, 2));
  } else {
    if (process.env.FLEETOPS_TYPED_DEMO_ISOLATED !== "true") throw new Error("Set FLEETOPS_TYPED_DEMO_ISOLATED=true only for a disposable local DB.");
    const connectionString = process.env.TYPED_DEMO_DATABASE_URL;
    const address = new URL(connectionString);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname) || !address.pathname.endsWith("_demo")) throw new Error("Typed demo requires a local database whose name ends in _demo.");
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString });
    const client = await pool.connect();
    try {
      if (command === "up") console.log(JSON.stringify(await seedTypedDemo(client, manifest)));
      else await removeTypedDemo(client);
    } finally { client.release(); await pool.end(); }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

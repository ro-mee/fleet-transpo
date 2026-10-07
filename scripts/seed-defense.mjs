import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { loadEnvLocal } from "./load-env.mjs";
import { buildDefensePlan } from "./defense-seed/plan.mjs";
import { validateDefensePlan } from "./defense-seed/validation.mjs";
import { inspectLiveContract } from "./defense-seed/live-contract.mjs";
import { checkExternalReferences, checkSnapshots, readLedger, removeOwnedRows } from "./defense-seed/ledger.mjs";
import { writeDefenseSeed } from "./defense-seed/writer.mjs";
import { checkMediaRows, loadMediaManifest, removeMedia, uploadMedia } from "./defense-seed/media.mjs";
import { GUEST, SEED_KEY, VIP } from "./defense-seed/config.mjs";
import { readDefenseBaseline } from "./defense-seed/baseline.mjs";

const command = process.argv[2] ?? "status";
const PROJECT_REF = process.env.DEFENSE_TARGET_PROJECT_REF || "dnxuphhxlzidvwtdqqkq";
const plan = buildDefensePlan();
const errors = validateDefensePlan(plan);
if (errors.length) throw new Error(`Defense scenario invalid:\n${errors.join("\n")}`);
const APPLY_SOURCES = [
  "./seed-defense.mjs", "./defense-seed/config.mjs", "./defense-seed/plan.mjs",
  "./defense-seed/validation.mjs", "./defense-seed/writer.mjs",
  "./defense-seed/ledger.mjs", "./defense-seed/media.mjs",
  "./defense-seed/baseline.mjs",
];
const hashPlan = (assets) => {
  const hash = createHash("sha256").update(PROJECT_REF).update(JSON.stringify(plan));
  hash.update(JSON.stringify(assets));
  for (const source of APPLY_SOURCES) hash.update(readFileSync(new URL(source, import.meta.url)));
  return hash.digest("hex").slice(0, 16);
};

function counts() {
  return Object.fromEntries(Object.entries(plan).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length]));
}

function migrationGate() {
  const output = execFileSync(process.execPath, ["scripts/migrate.mjs", "status"], { encoding: "utf8" });
  const pending = output.match(/^\s+pending\s+(\d+)/m);
  const changed = output.match(/^\s+changed\s+(\d+)/m);
  if (!pending || !changed || Number(pending[1]) !== 0 || Number(changed[1]) !== 0) throw new Error("Migration gate requires 0 pending and 0 changed; run npm run db:status");
}

function assertTargetProject() {
  const database = new URL(process.env.DATABASE_URL);
  const storage = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (database.pathname !== "/postgres" || database.username.split(".").at(-1) !== PROJECT_REF ||
      storage.hostname !== `${PROJECT_REF}.supabase.co`) {
    throw new Error(`Database and Storage must both target the configured FleetOps project ${PROJECT_REF}; no write attempted`);
  }
}

async function inReadOnly(db, work) {
  const client = await db.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await work(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function showPlan(db, assets) {
  assertTargetProject();
  const { contract, ledger, baseline } = await inReadOnly(db, async (client) => {
    const contract = await inspectLiveContract(client);
    const ledger = await readLedger(client);
    const baseline = await readDefenseBaseline(client);
    await checkExternalReferences(client, { ids: {} }); // Validate the live FK catalog query before any apply.
    return { contract, ledger, baseline };
  });
  const categories = [VIP, GUEST].map((name) => ({ name, existing: contract.categories.find((c) => c.category_name === name && c.status === "Active" && !c.deleted_at)?.category_id ?? null }));
  console.log(JSON.stringify({
    command: "plan", readOnly: true, planHash: hashPlan(assets), database: contract.identity,
    configuredProjectRef: PROJECT_REF,
    defense: plan.window.defense, historicalWindow: [plan.window.start, plan.window.end],
    counts: counts(), completedByMonth: {
      September: plan.trips.filter((t) => t.status === "Completed" && t.day.startsWith("2026-09")).length,
      October: plan.trips.filter((t) => t.status === "Completed" && t.day.startsWith("2026-10")).length,
    },
    categories, existingDriverRole: contract.roles.find((r) => r.role_name.toLowerCase() === "driver") ?? null,
    mediaAssets: assets.length, existingLedger: Boolean(ledger), existingSeedKeys: contract.seedSettings,
    baseline,
    existingCounts: contract.counts, storageBuckets: contract.buckets,
    triggerEffects: {
      existingManagerRecipientsPerLeaveRequest: contract.notificationRecipients,
      demoDriverOpenDispatchNotificationsAndPushQueueRows: plan.trips.filter((t) => t.status === "Assigned").length,
      note: "Historical trigger notices are removed by exact newly inserted IDs inside the seed transaction. D04's pending leave may notify existing managers; 7 open dispatches may notify the new demo drivers. Surviving trigger rows are ledger-owned and rollback checks changes before deletion.",
    },
    readinessGates: [
      "10 controlled driver email inboxes and unique passwords required for apply",
      "Synthetic SAMPLE / NOT VALID licenses cannot be recorded as physically verified",
      "Each demo driver must accept privacy policy through the app",
      `${assets.length} checked local media assets will upload to Supabase Storage during apply`,
      "No production Supabase write during this preview",
    ],
  }, null, 2));
}

async function showStatus(db) {
  assertTargetProject();
  const result = await inReadOnly(db, async (client) => {
    const ledger = await readLedger(client);
    if (!ledger) return { state: "absent", seedKey: SEED_KEY };
    if (ledger.state === "media_cleanup") return { state: "partial", seedKey: SEED_KEY,
      reason: "Database rows removed; exact media keys remain for cleanup", mediaKeys: ledger.media?.length ?? 0 };
    const snapshots = await checkSnapshots(client, ledger, { ignoreRuntimeTimestamps: true });
    const refs = await checkExternalReferences(client, ledger);
    const media = await checkMediaRows(client, ledger.media);
    const issues = [...snapshots, ...refs, ...media];
    return { state: issues.length ? "inconsistent" : "complete", seedKey: SEED_KEY,
      planHash: ledger.planHash, plantedAt: ledger.plantedAt,
      counts: Object.fromEntries(Object.entries(ledger.ids).map(([table, ids]) => [table, ids.length])),
      issues, readiness: ledger.readiness };
  });
  console.log(JSON.stringify(result, null, 2));
  if (["inconsistent", "partial"].includes(result.state)) process.exitCode = 1;
}

async function up(db, assets) {
  const digest = hashPlan(assets);
  if (!process.argv.includes(`--apply=${digest}`)) {
    throw new Error(`Refusing live write. Review seed:defense:plan, then supply --apply=${digest} only after approval.`);
  }
  if (!process.argv.includes("--acknowledge-unverified-fixtures")) {
    throw new Error("Refusing live write: sample licenses remain unverified, so D01 will not pass live driver eligibility. Add --acknowledge-unverified-fixtures only after reviewing this limitation.");
  }
  assertTargetProject();
  migrationGate();
  const client = await db.connect();
  let uploaded = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [SEED_KEY]);
    if (await readLedger(client)) throw new Error(`${SEED_KEY} already exists`);
    const baseline = await readDefenseBaseline(client);
    if (!baseline.clean) throw new Error(`Defense baseline is contaminated; cleanup and review required before up:\n${baseline.blockers.join("\n")}`);
    const ledger = await writeDefenseSeed(client, plan, assets);
    uploaded = await uploadMedia(assets);
    ledger.media = uploaded;
    ledger.planHash = digest;
    await client.query("UPDATE system_settings SET setting_value=$2::jsonb WHERE setting_key=$1", [SEED_KEY, JSON.stringify(ledger)]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ state: "seeded", planHash: digest,
      counts: Object.fromEntries(Object.entries(ledger.ids).map(([table, ids]) => [table, ids.length])),
      readiness: ledger.readiness }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (uploaded.length) {
      const cleanup = await removeMedia(uploaded);
      if (cleanup.length) throw new AggregateError([error, ...cleanup.map((message) => new Error(message))], "Seed rolled back but storage cleanup failed");
    }
    throw error;
  } finally { client.release(); }
}

async function down(db) {
  if (!process.argv.includes("--apply")) throw new Error("Rollback requires explicit --apply after reviewing seed:defense:status");
  assertTargetProject();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [SEED_KEY]);
    const ledger = await readLedger(client);
    if (!ledger) { await client.query("ROLLBACK"); console.log("Defense seed absent"); return; }
    if (ledger.state !== "media_cleanup") {
      const issues = [...await checkSnapshots(client, ledger), ...await checkExternalReferences(client, ledger)];
      if (issues.length) throw new Error(`Rollback refused; owned rows changed or acquired external references:\n${issues.join("\n")}`);
      await removeOwnedRows(client, ledger);
    }
    await client.query("COMMIT");
    const mediaProblems = await removeMedia(ledger.media ?? []);
    if (mediaProblems.length) throw new Error(`Database removed; media cleanup pending:\n${mediaProblems.join("\n")}`);
    await db.query("DELETE FROM system_settings WHERE setting_key=$1 AND setting_value->>'state'='media_cleanup'", [SEED_KEY]);
    console.log("Defense seed database rows and exact owned media keys removed");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

if (!["status", "plan", "up", "down", "offline-plan"].includes(command)) throw new Error("Use status | plan | up | down | offline-plan");
if (command === "offline-plan") {
  const assets = await loadMediaManifest();
  console.log(JSON.stringify({ planHash: hashPlan(assets), window: plan.window, counts: counts(), mediaAssets: assets.length, errors }, null, 2));
}
else {
  loadEnvLocal();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for live read/write commands");
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (command === "plan") await showPlan(db, await loadMediaManifest());
    if (command === "status") await showStatus(db);
    if (command === "up") await up(db, await loadMediaManifest());
    if (command === "down") await down(db);
  } finally { await db.end(); }
}

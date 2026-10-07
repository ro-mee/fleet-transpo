import { createHash } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import { AuthError } from "@/lib/api/utils";
import { priceAt, rowInstant, validateSnapshotInput } from "./price-policy";
import { validateProviderUpdate } from "./providers/official-reference";

export function fuelSchemaError(error) {
  if (["42P01", "42703"].includes(error?.code)) {
    return new AuthError("Fuel estimates are unavailable until the reviewed fuel migrations are applied and verified.", 503, "FUEL_SCHEMA_PENDING");
  }
  return error;
}

/** Only this server repository writes reference prices. Receipts never use it. */
export function createPriceRepository(db = { query, withTransaction }) {
  const run = async (fn) => { try { return await fn(); } catch (error) { throw fuelSchemaError(error); } };
  const activate = async (tx, at) => {
    // One atomic interval transition; retries never rewrite prices/provenance.
    await tx.query(`WITH due AS (
      SELECT snapshot_id, ROW_NUMBER() OVER (PARTITION BY fuel_product, region ORDER BY effective_at DESC, snapshot_id DESC) AS position
      FROM fuel_price_snapshots WHERE effective_at <= $1
        AND ((verification_method = 'Manual' AND verified_by > 0) OR
             (verification_method = 'Automatic' AND btrim(source_hash) <> '')))
      UPDATE fuel_price_snapshots AS s SET lifecycle = CASE WHEN due.position = 1 THEN 'Active' ELSE 'Historical' END
      FROM due WHERE s.snapshot_id = due.snapshot_id
        AND s.lifecycle IS DISTINCT FROM CASE WHEN due.position = 1 THEN 'Active' ELSE 'Historical' END`, [at]);
  };
  const list = () => run(async () => (await db.query("SELECT * FROM fuel_price_snapshots ORDER BY effective_at DESC, snapshot_id DESC LIMIT 200")).rows);
  const applicable = ({ fuelType, region, at }, connection = db) => run(async () => {
    if (!fuelType || !region || !rowInstant(at)) return null;
    if (connection === db) return db.withTransaction((tx) => applicable({ fuelType, region, at }, tx));
    await connection.query("SELECT pg_advisory_xact_lock(hashtext('fuel:activation'))");
    await activate(connection, new Date());
    const { rows } = await connection.query(
      `SELECT * FROM fuel_price_snapshots WHERE fuel_product = $1 AND region = $2
         AND effective_at <= $3 AND lifecycle IN ('Active', 'Historical')
         ORDER BY effective_at DESC, snapshot_id DESC`, [fuelType, region, at]);
    return priceAt(rows, { fuelType, region, at });
  });
  const record = (input, { verifierId = null, automatic = false, at = new Date() } = {}) => run(() => db.withTransaction(async (tx) => {
    const ingestionHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const checked = validateSnapshotInput({ ...input, source_hash: automatic ? ingestionHash : null, verification_method: automatic ? "Automatic" : "Manual", verified_by: automatic ? null : verifierId, lifecycle: "Pending" });
    if (!checked.ok) throw new AuthError(Object.values(checked.errors).join(" "), 400);
    const v = checked.value;
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('fuel:activation'))");
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`fuel:${v.fuel_product}:${v.region}`]);
    const { rows: same } = await tx.query("SELECT * FROM fuel_price_snapshots WHERE fuel_product = $1 AND region = $2 AND effective_at = $3", [v.fuel_product, v.region, v.effective_at]);
    if (same.length) {
      if (Number(same[0].reference_price) !== v.reference_price || same[0].source_url !== v.source_url) throw new AuthError("That effectivity already has a different verified price. Record a correction with a later effective time and its source.", 409);
      return { snapshot: same[0], duplicate: true };
    }
    // Automatic ingestion must not regress a newer verified announcement,
    // including one still Pending. Manual review can explicitly backfill history.
    const { rows: previous } = automatic
      ? await tx.query(`SELECT * FROM fuel_price_snapshots WHERE fuel_product = $1 AND region = $2
          AND ((verification_method = 'Manual' AND verified_by > 0) OR
               (verification_method = 'Automatic' AND btrim(source_hash) <> ''))
          ORDER BY effective_at DESC, snapshot_id DESC LIMIT 1`, [v.fuel_product, v.region])
      : await tx.query("SELECT * FROM fuel_price_snapshots WHERE fuel_product = $1 AND region = $2 AND effective_at < $3 ORDER BY effective_at DESC LIMIT 1", [v.fuel_product, v.region, v.effective_at]);
    const decision = validateProviderUpdate({ current: previous[0] ?? null, candidate: v });
    if (!decision.accept) throw new AuthError(decision.reason, 409);
    const lifecycle = rowInstant(v.effective_at).getTime() <= at.getTime() ? "Active" : "Pending";
    const hash = createHash("sha256").update(JSON.stringify([v.fuel_product, v.region, v.reference_price, v.effective_at, v.source_url])).digest("hex");
    const { rows } = await tx.query(
      `INSERT INTO fuel_price_snapshots (fuel_product, region, reference_price, prior_price, announced_at,
         effective_at, fetched_at, source_url, verification_method, lifecycle, source_hash, verified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [v.fuel_product, v.region, v.reference_price, v.prior_price, v.announced_at, v.effective_at, automatic ? at : v.fetched_at, v.source_url, v.verification_method, lifecycle, hash, v.verified_by]);
    await activate(tx, at);
    return { snapshot: rows[0], duplicate: false };
  }));
  const activateDue = (at = new Date()) => run(() => db.withTransaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('fuel:activation'))");
    await activate(tx, at);
  }));
  return { list, applicable, record, activateDue };
}

export const fuelPrices = createPriceRepository();

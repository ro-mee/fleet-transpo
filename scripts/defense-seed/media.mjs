import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "assets");
const bucketFor = (asset) => {
  if (asset.asset_type === "driver-portrait") return "face-captures";
  if (asset.asset_type.startsWith("driver-license")) return "driver-licenses";
  if (asset.asset_type.startsWith("vehicle-")) return "vehicle-images";
  if (asset.asset_type.startsWith("fuel-")) return "fuel-receipts";
  if (asset.asset_type.startsWith("expense-")) return "expense-receipts";
  if (asset.asset_type.startsWith("incident-")) return "incident-evidence";
  throw new Error(`Unknown media type ${asset.asset_type}`);
};

export async function loadMediaManifest() {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length < 70) throw new Error("Media manifest incomplete");
  const seenIds = new Set(), seenKeys = new Set();
  for (const asset of manifest.assets) {
    if (seenIds.has(asset.asset_id) || seenKeys.has(asset.storage_key)) throw new Error(`Duplicate media ${asset.asset_id}`);
    seenIds.add(asset.asset_id); seenKeys.add(asset.storage_key);
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:png|svg)$/.test(asset.file) ||
        asset.storage_key !== `defense-2026-10/${asset.file}`) throw new Error(`Unsafe media path ${asset.asset_id}`);
    const bytes = await readFile(join(root, asset.file));
    if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error(`Media checksum mismatch ${asset.asset_id}`);
    asset.bucket = bucketFor(asset);
  }
  return manifest.assets;
}

export function mediaById(assets) { return new Map(assets.map((a) => [a.asset_id, a])); }
export function storedMediaRef(asset) { return `${asset.bucket}/${asset.storage_key}`; }
export function publicMediaUrl(asset) {
  if (asset.bucket !== "vehicle-images") throw new Error("Public URL requested for private asset");
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL required");
  return `${base}/storage/v1/object/public/vehicle-images/${asset.storage_key}`;
}

function client() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase service role and URL required for media upload");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function uploadMedia(assets) {
  const storage = client().storage;
  const uploaded = [];
  try {
    for (const asset of assets) {
      const bytes = await readFile(join(root, asset.file));
      const { error } = await storage.from(asset.bucket).upload(asset.storage_key, bytes,
        { contentType: asset.mime_type, upsert: false, cacheControl: "3600" });
      if (error) throw new Error(`Upload ${asset.asset_id}: ${error.message}`);
      uploaded.push({ bucket: asset.bucket, key: asset.storage_key, sha256: asset.sha256 });
    }
    return uploaded;
  } catch (error) {
    const cleanup = await removeMedia(uploaded);
    if (cleanup.length) throw new AggregateError([error, ...cleanup.map((s) => new Error(s))], "Media upload failed and cleanup was incomplete");
    throw error;
  }
}

export async function removeMedia(entries) {
  if (!entries?.length) return [];
  const storage = client().storage;
  const errors = [];
  for (const asset of entries) {
    const { error } = await storage.from(asset.bucket).remove([asset.key]);
    if (error) errors.push(`${asset.bucket}/${asset.key}: ${error.message}`);
  }
  return errors;
}

export async function checkMediaRows(db, entries) {
  if (!entries?.length) return [];
  const { rows } = await db.query("SELECT bucket_id,name FROM storage.objects WHERE name=ANY($1::text[])", [entries.map((a) => a.key)]);
  const present = new Set(rows.map((r) => `${r.bucket_id}/${r.name}`));
  return entries.filter((a) => !present.has(`${a.bucket}/${a.key}`)).map((a) => `Missing media ${a.bucket}/${a.key}`);
}

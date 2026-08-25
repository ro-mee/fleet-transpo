// Accuracy harness for the fuel-gauge scanner.
//
// Usage:
//   1. Open scripts/gauge-fixtures.html in a browser and download all PNGs
//      into one folder (files are named like `needle_25.png`).
//   2. node scripts/verify-gauge-scan.mjs <folder>
//
// The folder's images are uploaded through the same storage + scan pipeline a
// driver phone uses, then each Gemini estimate is compared against the true
// level encoded in the filename. Requires a driver Bearer token and either an
// enabled Gemini provider row or GEMINI_API_KEY in .env.local.
//
//   node scripts/verify-gauge-scan.mjs ./gauge-fixtures <accessToken>

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

const API_BASE = process.env.API_BASE || "http://localhost:3000";

const [folder, token] = process.argv.slice(2);
if (!folder || !token) {
  console.error("Usage: node scripts/verify-gauge-scan.mjs <fixturesFolder> <driverAccessToken>");
  process.exit(1);
}

loadEnvLocal();

const files = readdirSync(folder)
  .filter((name) => name.endsWith(".png"))
  .map((name) => {
    const match = name.match(/_(\d+)\.png$/);
    return match ? { name, trueLevel: Number(match[1]) } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.trueLevel - b.trueLevel);

if (!files.length) {
  console.error(`No PNG fixtures named *_LEVEL.png found in ${folder}`);
  process.exit(1);
}

async function uploadGauge(filePath) {
  const form = new FormData();
  form.append("kind", "gauge");
  form.append("image", new Blob([readFileSync(filePath)], { type: "image/png" }), "gauge.png");
  const response = await fetch(`${API_BASE}/api/mobile/fuel/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `upload failed (${response.status})`);
  return body.gauge_url;
}

async function scanGauge(gaugeUrl) {
  const response = await fetch(`${API_BASE}/api/mobile/fuel/gauge-scan`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ gauge_url: gaugeUrl }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `scan failed (${response.status})`);
  return body.extracted_data;
}

let readable = 0;
let within5 = 0;
let within10 = 0;
const rows = [];

for (const file of files) {
  const filePath = join(folder, file.name);
  let estimate = null;
  try {
    const gaugeUrl = await uploadGauge(filePath);
    const scan = await scanGauge(gaugeUrl);
    estimate = scan?.estimated_level_percent ?? null;
  } catch (error) {
    rows.push({ name: file.name, trueLevel: file.trueLevel, estimate, error: error.message });
    continue;
  }
  if (estimate != null) {
    readable += 1;
    const delta = Math.abs(estimate - file.trueLevel);
    if (delta <= 5) within5 += 1;
    if (delta <= 10) within10 += 1;
    rows.push({ name: file.name, trueLevel: file.trueLevel, estimate });
  } else {
    rows.push({ name: file.name, trueLevel: file.trueLevel, estimate: null });
  }
}

console.table(rows.map(({ name, trueLevel, estimate, error }) => ({
  fixture: name,
  trueLevel,
  scanned: estimate ?? "unreadable",
  delta: estimate == null ? "—" : Math.abs(estimate - trueLevel),
  ...(error ? { error } : {}),
})));

console.log(`\nReadable: ${readable}/${files.length}`);
console.log(`Within ±5 pts: ${within5}/${files.length}`);
console.log(`Within ±10 pts: ${within10}/${files.length}`);

const totalBytes = files.reduce((sum, f) => sum + statSync(join(folder, f.name)).size, 0);
console.log(`(${files.length} fixtures, ${Math.round(totalBytes / 1024)} KB total)`);

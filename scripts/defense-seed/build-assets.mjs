import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDefensePlan } from "./plan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "assets");
const plan = buildDefensePlan();
const manifest = [];
const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const modelReference = (v) => v.model === "Camry" ? "https://toyota.com.ph/camry" :
  v.model === "Corolla Altis" ? "https://www.toyota.com.ph/corolla-altis" :
  v.model === "CX-8 AWD Exclusive 6-Seater" ? "https://www.mazda.ph/vehicles/mazda-cx-8" :
  v.model === "Innova" ? "https://toyota.com.ph/showroom/innova" :
  v.model === "Zenix" ? "https://toyota.com.ph/zenix" :
  v.model === "Alphard" ? "https://www.toyota.com.ph/alphard" : null;

function card({ title, subtitle, lines, accent = "#114a66", note = "Training fixture only" }) {
  const items = lines.map((line, i) => `<text x="52" y="${225 + i * 52}" fill="#16344b" font-size="26" font-family="Arial, sans-serif">${esc(line)}</text>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650" viewBox="0 0 1000 650" role="img" aria-label="DEMO SAMPLE NOT VALID">
<rect width="1000" height="650" fill="#f4f7f7"/><rect x="24" y="24" width="952" height="602" rx="22" fill="white" stroke="${accent}" stroke-width="4"/>
<rect x="24" y="24" width="952" height="134" rx="20" fill="${accent}"/><text x="52" y="90" fill="white" font-size="35" font-weight="700" font-family="Arial, sans-serif">${esc(title)}</text>
<text x="52" y="132" fill="#e4eef2" font-size="21" font-family="Arial, sans-serif">${esc(subtitle)}</text>${items}
<g transform="translate(150 415) rotate(-16)"><text x="0" y="0" fill="#b52626" fill-opacity="0.22" font-size="79" font-weight="800" font-family="Arial, sans-serif">DEMO · SAMPLE · NOT VALID</text></g>
<rect x="45" y="556" width="910" height="48" fill="#fce9e7"/><text x="62" y="588" fill="#8e1f1b" font-size="23" font-weight="700" font-family="Arial, sans-serif">${esc(note)} · No government or insurer affiliation</text>
</svg>`;
}

async function add(id, type, related, relativePath, sourceType, sourceUrl = null, useNote = "Synthetic demo asset; not valid evidence") {
  const path = join(root, relativePath);
  const bytes = await readFile(path);
  manifest.push({ asset_id: id, asset_type: type, related_entity: related, file: relativePath.replaceAll("\\", "/"),
    storage_key: `defense-2026-10/${relativePath.replaceAll("\\", "/")}`, source_type: sourceType,
    original_source_url: sourceUrl, license_use_note: useNote, synthetic_demo: true,
    philippines_context: "Prompted or designed for Metro Manila hotel fleet context; review image before upload",
    sha256: sha(bytes), bytes: bytes.length, mime_type: relativePath.endsWith(".png") ? "image/png" : "image/svg+xml" });
}

async function writeSvg(id, type, related, relativePath, spec) {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, card(spec), "utf8");
  await add(id, type, related, relativePath, "code-generated");
}

for (const d of plan.drivers) {
  await add(`${d.key}_PORTRAIT`, "driver-portrait", d.key, `drivers/${d.key}.png`, "generated-imagegen", null,
    "AI-generated fictional Filipino driver portrait; no real person's identity licensed or implied");
  await writeSvg(`${d.key}_LICENSE_FRONT`, "driver-license-front", d.key, `licenses/${d.key}-front.svg`, {
    title: "PHILIPPINE-CONTEXT DRIVER SAMPLE", subtitle: "Fictional training card · Front",
    lines: [`Name: ${d.firstName} ${d.lastName}`, `Sample no.: ${d.licenseNumber}`,
      `Type: ${d.licenseType} · Classes: ${d.licenseClass}`, `Expiry: ${d.licenseExpiry}`],
    note: "DEMO / SAMPLE / NOT VALID · Not a driver's license",
  });
  await writeSvg(`${d.key}_LICENSE_BACK`, "driver-license-back", d.key, `licenses/${d.key}-back.svg`, {
    title: "DRIVER SAMPLE — REVERSE", subtitle: "Fictional training card · Back",
    lines: [`Name: ${d.firstName} ${d.lastName}`, `Sample no.: ${d.licenseNumber}`,
      `Class: ${d.licenseClass}`, "Address: Metro Manila — DEMO ADDRESS"],
    note: "DEMO / SAMPLE / NOT VALID · No official barcode",
  });
}
for (const v of plan.vehicles) {
  await add(`${v.key}_PHOTO`, "vehicle-photo", v.key, `vehicles/${v.key}.png`, "generated-imagegen", null,
    "AI-generated synthetic Philippine hotel exterior; model appearance is representative, not official product photography");
  manifest.at(-1).model_reference_url = modelReference(v);
  await writeSvg(`${v.key}_ORCR`, "vehicle-registration-sample", v.key, `registration/${v.key}-orcr.svg`, {
    title: "VEHICLE REGISTRATION SAMPLE", subtitle: "Fictional Philippine-context fleet record",
    lines: [`Plate: ${v.plate}`, `Vehicle: ${v.year} ${v.make} ${v.model}`,
      `Passenger seats: ${v.seats}`, `Registration expiry: ${v.registrationExpiry}`],
    note: "DEMO / SAMPLE / NOT VALID · Not an LTO document",
  });
  await writeSvg(`${v.key}_INSURANCE`, "vehicle-insurance-sample", v.key, `insurance/${v.key}-insurance.svg`, {
    title: "MOTOR INSURANCE SAMPLE", subtitle: "Fictional insurer: Harbor Training Assurance",
    lines: [`Sample policy: HTA-${v.key}-2026`, `Plate: ${v.plate}`,
      `Vehicle: ${v.year} ${v.make} ${v.model}`, `Expiry: ${v.insuranceExpiry}`],
    note: "DEMO / SAMPLE / NOT VALID · No insurance coverage",
  });
}
for (const incident of plan.incidents) await add(`${incident.key}_PHOTO`, "incident-photo", incident.key,
  `incidents/${incident.key}.png`, "generated-imagegen", null,
  "AI-generated fictional Metro Manila incident evidence; never presented as an actual event photograph");
for (let i = 0; i < plan.fuelRecords.length; i++) {
  const id = String(i + 1).padStart(2, "0");
  const record = plan.fuelRecords[i];
  await writeSvg(`FUEL_${id}`, "fuel-receipt-sample", `FUEL-${id}`, `receipts/fuel-${id}.svg`, {
    title: "DEMO FUEL STATION", subtitle: "Fictional Metro Manila branch · Training receipt",
    lines: [`Reference: FUEL-DEMO-${id}`, `Date: ${record.day}`,
      `Fuel: ${record.liters}.00 L`, `Amount: PHP ${record.liters * record.pricePerLiter}.00`],
    note: "DEMO / SAMPLE / NOT VALID · Not a tax receipt",
  });
}
for (let i = 0; i < plan.fuelRequests.length; i++) {
  const id = String(i + 1).padStart(2, "0");
  await writeSvg(`GAUGE_${id}`, "fuel-gauge-sample", `FUEL-REQUEST-${id}`, `gauges/gauge-${id}.svg`, {
    title: "DEMO VEHICLE FUEL GAUGE", subtitle: "Illustrative training evidence only",
    lines: [`Gauge reading: ${25 + i * 10}%`, "Metro Manila hotel fleet context", "No live sensor reading"],
    note: "DEMO / SAMPLE / NOT VALID · Not measured evidence",
  });
}
for (let i = 0; i < plan.expenses.length; i++) {
  const id = String(i + 1).padStart(2, "0");
  const expense = plan.expenses[i];
  await writeSvg(`EXPENSE_${id}`, "expense-receipt-sample", `EXP-${id}`, `receipts/expense-${id}.svg`, {
    title: "DEMO PARKING / TOLL RECEIPT", subtitle: "Fictional Metro Manila vendor · Training receipt",
    lines: [`Reference: EXP-DEMO-${id}`, `Date: ${expense.day}`,
      `Amount: PHP ${expense.amount}.00`, "Payment: Cash"],
    note: "DEMO / SAMPLE / NOT VALID · Not a tax receipt",
  });
}
manifest.sort((a, b) => a.asset_id.localeCompare(b.asset_id));
await writeFile(join(root, "manifest.json"), JSON.stringify({ version: 1, generated_at: "2026-10-02", assets: manifest }, null, 2) + "\n");
console.log(`${manifest.length} local assets written and hashed; no Supabase upload`);

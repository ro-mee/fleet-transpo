// Owner-authorized synthetic verified-state fixtures, never genuine credentials.
// node --import ./scripts/route-harness-loader.mjs scripts/seed-cargo-tester-ready.mjs plan|apply|verify
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './load-env.mjs';
import { evaluateDriverLicenseEligibility } from '../src/lib/drivers/license-eligibility.js';
import { loadRoadReadiness } from '../src/lib/vehicles/readiness-server.js';
import { deriveUsablePayload, evaluateCargoPhysicalLoad } from '../src/lib/cargo/physical-load.js';

const mode = process.argv[2] ?? 'plan';
assert(['plan', 'apply', 'verify'].includes(mode), 'Use plan, apply or verify.');
loadEnvLocal();
const marker = 'DEMO-CARGO-TESTER-READY-V1';
const expiry = '2027-10-27';
const verifierEmail = 'cargo-fixture-verifier@fleetops.invalid';
const license = { license_number: 'DEMO-CARGO-00098', license_type: 'Professional', license_class: 'B', license_expiry: expiry };
const profileValues = {
  supports_supply_delivery: true, rated_payload_kg: 700, gross_vehicle_weight_limit_kg: 3500,
  operating_mass_kg: 2500, operational_reserve_kg: 200, usable_volume_m3: 4.5,
  compartment_length_m: 2, compartment_width_m: 1.5, compartment_height_m: 1.5,
  opening_length_m: 2, opening_width_m: 1.3, opening_height_m: 1.3,
  temperature_min_c: null, temperature_max_c: null,
  handling_capabilities: ['FRAGILE', 'NO_STACK', 'FOOD_SEPARATION', 'SECURE_LOAD', 'SPILL_CONTAINMENT'],
  verification_reference: `${marker}: SYNTHETIC - NOT MEASURED`, verification_valid_until: expiry,
};
const manifest = {
  physical_contract_version: 1, source_ref: { system: 'INTERNAL' },
  lines: [{ line_id: 'demo-boxes', name: 'DEMO boxes', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '10', handling: [],
    physical: { transport_package_count: 10, package_description: 'DEMO box', gross_weight_kg_per_package: '2',
      dimensions_m: { length: '0.4', width: '0.3', height: '0.2' }, package_can_rotate: true, temperature_c: null } }],
};
const proof = { verified_by: 1, verified_at: new Date(), vehicle_status: 'Available' };
assert.equal(deriveUsablePayload(profileValues), 500);
assert.equal(evaluateCargoPhysicalLoad({ manifest, profile: { ...profileValues, ...proof }, declaredWeightKg: 20 }).eligible, true);
assert.equal(evaluateDriverLicenseEligibility({ ...license, license_verified_at: proof.verified_at, license_verified_by: 1,
  license_verification_method: 'physical_card' }, { required_license_class: 'B' }).eligible, true);
assert.equal(evaluateDriverLicenseEligibility(license, { required_license_class: 'B' }).eligible, false);
const overloaded = structuredClone(manifest);
overloaded.lines[0].expected_quantity = '1000';
overloaded.lines[0].physical.transport_package_count = 1000;
assert.equal(evaluateCargoPhysicalLoad({ manifest: overloaded, profile: { ...profileValues, ...proof }, declaredWeightKg: 2000 }).eligible, false);

const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }).storage;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const uploaded = [];
let committed = false;
let commitAttempted = false;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = [
  { bucket: 'driver-licenses', key: '98/demo-cargo-ready-v1/license-front.png', title: 'DRIVER LICENSE - FRONT', lines: ['Cargo Tester / driver 98', 'Number: DEMO-CARGO-00098', 'Synthetic Professional / B', `Sample expiry: ${expiry}`, 'No actual license is represented.'] },
  { bucket: 'driver-licenses', key: '98/demo-cargo-ready-v1/license-back.png', title: 'DRIVER LICENSE - BACK', lines: ['Cargo Tester / driver 98', 'Fictional QA fixture only.', 'No LTO card or Digital ID was checked.', 'No signature or official endorsement.'] },
  { bucket: 'vehicle-documents', key: '142/demo-cargo-ready-v1/or-cr.png', title: 'VEHICLE REGISTRATION', lines: ['DEMO Cargo Vehicle / vehicle 142', 'Sample plate: DMO-0142 / class B', 'DEMO-ORCR-TEST-CARGO-001', `Sample expiry: ${expiry}`, 'No actual OR/CR is represented.'] },
  { bucket: 'vehicle-documents', key: '142/demo-cargo-ready-v1/insurance.png', title: 'VEHICLE INSURANCE', lines: ['DEMO Cargo Vehicle / vehicle 142', 'DEMO-INS-TEST-CARGO-001', `Sample expiry: ${expiry}`, 'Fictional policy. No insurance coverage.'] },
];
function ref(asset) { return `${asset.bucket}/${asset.key}`; }
async function fixtureImage(asset) {
  const escape = text => text.replace(/[&<>]/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[value]);
  const rows = asset.lines.map((line, index) => `<text x="70" y="${300 + index * 58}" font-size="30">${escape(line)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/><rect x="25" y="25" width="1150" height="750" fill="none" stroke="#b91c1c" stroke-width="10"/><g font-family="Arial" fill="#111827"><text x="70" y="120" font-size="62" fill="#b91c1c" font-weight="bold">DEMO / SAMPLE / NOT VALID</text><text x="70" y="205" font-size="39">${escape(asset.title)}</text>${rows}<text x="70" y="700" font-size="27" fill="#b91c1c">Verified app state is a synthetic test fixture only.</text><text x="70" y="744" font-size="23">${marker}</text></g></svg>`;
  return sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
}
async function storeAsset(asset) {
  const bytes = await fixtureImage(asset);
  const folder = asset.key.slice(0, asset.key.lastIndexOf('/'));
  const filename = asset.key.slice(asset.key.lastIndexOf('/') + 1);
  const listing = await storage.from(asset.bucket).list(folder, { search: filename, limit: 100 });
  if (listing.error) throw new Error(`Cannot inspect private fixture storage: ${listing.error.message}`);
  if (!listing.data.some(item => item.name === filename)) {
    const result = await storage.from(asset.bucket).upload(asset.key, bytes, { contentType: 'image/png', upsert: false });
    if (result.error) throw new Error(`Fixture upload failed: ${result.error.message}`);
    uploaded.push(asset);
  }
  const saved = await storage.from(asset.bucket).download(asset.key);
  if (saved.error) throw new Error(`Fixture download failed: ${saved.error.message}`);
  assert.equal(hash(Buffer.from(await saved.data.arrayBuffer())), hash(bytes), 'Existing fixture bytes differ; refuse overwrite.');
  await mkdir('scratch/cargo-ready-fixtures', { recursive: true });
  await writeFile(`scratch/cargo-ready-fixtures/${filename}`, bytes);
}
async function readRecords() {
  const driver = (await db.query('SELECT * FROM drivers WHERE driver_id=98 AND deleted_at IS NULL')).rows[0];
  const vehicle = (await db.query('SELECT * FROM vehicles WHERE vehicle_id=142 AND deleted_at IS NULL')).rows[0];
  const documents = (await db.query('SELECT * FROM vehicledocuments WHERE vehicle_id=142 AND deleted_at IS NULL')).rows;
  const profile = (await db.query('SELECT * FROM vehicle_cargo_profiles WHERE vehicle_id=142')).rows[0] ?? null;
  const pairings = (await db.query('SELECT * FROM driver_vehicle_assignments WHERE assigned_until IS NULL AND (driver_id=98 OR vehicle_id=142)')).rows;
  return { driver, vehicle, documents, profile, pairings };
}
async function verifySaved() {
  const saved = await readRecords();
  assert.equal(saved.driver.license_number, license.license_number);
  assert.equal(saved.vehicle.vehicle_name, 'DEMO Cargo Vehicle - TEST ONLY');
  assert.equal(saved.vehicle.plate_number, 'DMO-0142');
  const eligibility = evaluateDriverLicenseEligibility(saved.driver, saved.vehicle);
  assert(eligibility.eligible, eligibility.reasons.join('; '));
  const now = new Date();
  const readiness = await loadRoadReadiness({ vehicleRow: saved.vehicle, pickupAt: now, returnAt: now, now, query: db.query.bind(db) });
  assert(readiness.ready, readiness.blockers.join('; '));
  assert.equal(saved.profile.verification_reference, profileValues.verification_reference);
  const physical = evaluateCargoPhysicalLoad({ manifest, profile: { ...saved.vehicle, ...saved.profile }, declaredWeightKg: 20 });
  assert(physical.eligible, physical.blocker);
  assert.equal(saved.pairings.length, 1);
  assert.equal(saved.pairings[0].driver_id, 98);
  assert.equal(saved.pairings[0].vehicle_id, 142);
  const verifier = (await db.query('SELECT role_id,status,password_hash FROM employees WHERE employee_id=$1 AND email=$2', [saved.driver.license_verified_by, verifierEmail])).rows[0];
  assert(verifier && verifier.role_id === null && verifier.status === 'Inactive' && verifier.password_hash === null);
  for (const asset of assets) {
    const bucket = await storage.getBucket(asset.bucket);
    assert(!bucket.error && bucket.data.public === false, 'Fixture documents must remain private.');
    const result = await storage.from(asset.bucket).download(asset.key);
    assert(!result.error, 'A saved fixture document is missing.');
    assert.equal(hash(Buffer.from(await result.data.arrayBuffer())), hash(await fixtureImage(asset)));
  }
  return { fixture: marker, driver_id: 98, vehicle_id: 142, synthetic_only: true, license_eligible: eligibility.eligible,
    road_ready: readiness.ready, physical_20kg_load: physical.status, usable_payload_kg: physical.usable_payload_kg,
    private_document_count: saved.documents.length, assignment_id: saved.pairings[0].assignment_id,
    verifier_login_disabled: true };
}
await db.connect();
try {
  if (mode === 'verify') {
    await db.query('BEGIN READ ONLY');
    console.log(JSON.stringify(await verifySaved()));
    await db.query('ROLLBACK');
  } else {
    await db.query(mode === 'plan' ? 'BEGIN READ ONLY' : 'BEGIN');
    if (mode === 'apply') {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [marker]);
      await db.query('LOCK TABLE drivers,vehicles,vehicledocuments,vehicle_cargo_profiles,driver_vehicle_assignments,trips IN SHARE ROW EXCLUSIVE MODE');
    }
    const already = (await db.query("SELECT log_id FROM audit_logs WHERE resource='cargo_demo_setup' AND new_values->>'fixture_id'=$1", [marker])).rows;
    if (already.length) {
      console.log(JSON.stringify({ unchanged: true, ...await verifySaved() }));
      await db.query('ROLLBACK');
    } else {
      const old = await readRecords();
      assert(old.driver?.employee_id === 137 && old.driver.driver_type === 'Cargo');
      const employee = (await db.query('SELECT first_name,last_name FROM employees WHERE employee_id=137 AND deleted_at IS NULL')).rows[0];
      assert.equal(`${employee?.first_name} ${employee?.last_name}`.toLowerCase(), 'cargo tester');
      assert(old.vehicle?.fleet_asset_code === 'TEST-CARGO-001' && old.vehicle.operational_use === 'Cargo' && /demo/i.test(old.vehicle.vehicle_name));
      for (const key of ['license_number', 'license_type', 'license_class', 'license_expiry', 'license_verified_at', 'license_image_url', 'license_back_image_url']) assert(old.driver[key] == null, `Driver field ${key} changed; refuse overwrite.`);
      for (const key of ['plate_number', 'required_license_class', 'cargo_capacity_kg', 'registration_expiry', 'insurance_expiry']) assert(old.vehicle[key] == null, `Vehicle field ${key} changed; refuse overwrite.`);
      assert.equal(old.vehicle.commissioning_status, 'Pending');
      assert.equal(old.documents.length, 0);
      assert.equal(old.profile, null);
      assert.equal(old.pairings.length, 0, 'Do not displace another pairing.');
      assert.equal(Number((await db.query('SELECT count(*) AS n FROM trips WHERE deleted_at IS NULL AND (driver_id=98 OR vehicle_id=142)')).rows[0].n), 0);
      const category = (await db.query("SELECT category_id FROM vehiclecategories WHERE category_id=3 AND category_name='Hotel Operations' AND status='Active' AND deleted_at IS NULL")).rows[0];
      assert(category, 'Expected existing Hotel Operations category is unavailable.');
      assert(new Date(expiry) > new Date(), 'Fixture expiry is past; review the fixture before reuse.');
      if (mode === 'plan') {
        console.log(JSON.stringify({ fixture: marker, mode, driver_id: 98, vehicle_id: 142, synthetic_only: true,
          license, plate: 'DMO-0142', usable_payload_kg: 500, expiry, private_fixture_images: 4,
          verifier: 'New disabled roleless fixture identity', pairing: '98 -> 142', source_code_changes: false }));
        await db.query('ROLLBACK');
      } else {
        for (const asset of assets) {
          const bucket = await storage.getBucket(asset.bucket);
          assert(!bucket.error && bucket.data.public === false, 'Expected an existing private bucket.');
          await storeAsset(asset);
        }
        const actor = (await db.query(`INSERT INTO employees(first_name,last_name,email,position,status,role_id,password_hash)
          VALUES('DEMO','Fixture Verifier',$1,'Synthetic QA state only - no genuine document review','Inactive',NULL,NULL)
          ON CONFLICT(email) DO NOTHING RETURNING employee_id`, [verifierEmail])).rows[0]
          ?? (await db.query('SELECT employee_id FROM employees WHERE email=$1 AND role_id IS NULL AND password_hash IS NULL AND status=$2', [verifierEmail, 'Inactive'])).rows[0];
        assert(actor, 'Fixture identity conflicts with another account.');
        const actorId = actor.employee_id;
        await db.query(`UPDATE drivers SET license_number=$1,license_type=$2,license_class=$3,license_expiry=$4,
          license_image_url=$5,license_back_image_url=$6,license_verified_at=NOW(),license_verified_by=$7,
          license_verification_method='physical_card',updated_at=NOW() WHERE driver_id=98`,
        [license.license_number, license.license_type, license.license_class, expiry, ref(assets[0]), ref(assets[1]), actorId]);
        await db.query(`UPDATE vehicles SET vehicle_name='DEMO Cargo Vehicle - TEST ONLY',plate_number='DMO-0142',category_id=$1,
          required_license_class='B',cargo_capacity_kg=500,registration_expiry=$2,insurance_expiry=$2,license_plate_expiry=$2,
          manufacturer='DEMO',model='Synthetic Cargo Van',year=2026,color='White',fuel_type='Diesel',seating_capacity=3,
          tank_capacity_l=60,fuel_efficiency_kmpl=8,updated_at=NOW() WHERE vehicle_id=142`, [category.category_id, expiry]);
        for (const [index, type, number] of [[2, 'OR_CR', 'DEMO-ORCR-TEST-CARGO-001'], [3, 'Insurance', 'DEMO-INS-TEST-CARGO-001']]) {
          await db.query(`INSERT INTO vehicledocuments(vehicle_id,document_type,document_number,file_url,expiry_date,verification_status,verified_by,verified_at)
            VALUES(142,$1,$2,$3,$4,'Verified',$5,NOW())`, [type, number, ref(assets[index]), expiry, actorId]);
        }
        const keys = Object.keys(profileValues);
        await db.query(`INSERT INTO vehicle_cargo_profiles(vehicle_id,${keys.join(',')},verified_at,verified_by)
          VALUES(142,${keys.map((_, index) => `$${index + 1}`).join(',')},NOW(),$${keys.length + 1})`, [...Object.values(profileValues), actorId]);
        const proposed = (await db.query('SELECT * FROM vehicles WHERE vehicle_id=142')).rows[0];
        const now = new Date();
        const readiness = await loadRoadReadiness({ vehicleRow: { ...proposed, commissioning_status: 'Ready' }, pickupAt: now, returnAt: now, now, query: db.query.bind(db) });
        assert(readiness.ready, readiness.blockers.join('; '));
        await db.query("UPDATE vehicles SET commissioning_status='Ready',updated_at=NOW() WHERE vehicle_id=142");
        const savedDriver = (await db.query('SELECT * FROM drivers WHERE driver_id=98')).rows[0];
        assert(evaluateDriverLicenseEligibility(savedDriver, proposed).eligible);
        await db.query(`INSERT INTO driver_vehicle_assignments(driver_id,vehicle_id,notes,created_by,updated_by,assigned_from)
          VALUES(98,142,$1,$2,$2,(NOW() AT TIME ZONE 'Asia/Manila')::date)`, [`${marker}: OWNER-REQUESTED DEMO ONLY; no genuine credentials, insurance or measurement attestation.`, actorId]);
        for (const [resource, id, before, after] of [
          ['drivers', 98, old.driver, { ...license, synthetic_only: true, fixture_verifier_id: actorId }],
          ['vehicles', 142, old.vehicle, { plate_number: 'DMO-0142', commissioning_status: 'Ready', cargo_capacity_kg: 500, synthetic_only: true }],
          ['cargo_demo_setup', 142, old, { fixture_id: marker, synthetic_only: true, owner_instruction: 'use demo details and make it verified',
            fixture_verifier_id: actorId, review_method_note: 'physical_card is a legacy serialized fixture value; no actual card was inspected',
            source_code_or_policy_changed: false, consent_or_schedule_changed: false }],
        ]) await db.query(`INSERT INTO audit_logs(employee_id,action,resource,resource_id,old_values,new_values,user_agent)
          VALUES(NULL,'seed',$1,$2,$3::jsonb,$4::jsonb,$5)`, [resource, id, JSON.stringify(before), JSON.stringify(after), marker]);
        const result = await verifySaved();
        commitAttempted = true;
        await db.query('COMMIT');
        committed = true;
        console.log(JSON.stringify({ applied: true, ...result }));
      }
    }
  }
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  // An unacknowledged COMMIT may have landed; keep its private files for verify.
  if (commitAttempted && !committed) console.error('Commit outcome is uncertain. Fixture files retained; run verify before retrying.');
  if (!committed && !commitAttempted) for (const asset of uploaded) {
    const result = await storage.from(asset.bucket).remove([asset.key]);
    if (result.error) console.error(`Fixture cleanup failed for ${ref(asset)}: ${result.error.message}`);
  }
  throw error;
} finally { await db.end(); }

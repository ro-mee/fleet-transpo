import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withTransaction } from '@/lib/db';
import { AuthError } from '@/lib/api/utils';
import { rolesFor } from '@/lib/auth/permissions';
import { writeAuditRequired } from '@/lib/audit';
import { RESERVATION_EVENT } from '@/lib/constants';
import { parseV2TransportationRequest } from '@/lib/integration/contracts';
import { cargoServiceSchema, manifestContentSchema } from '@/lib/cargo/contracts';
import { validateCargoDraft } from '@/lib/cargo/cargo-draft';
import { calculateCargoPhysicalTotals, reconcileCargoDeclaredWeight } from '@/lib/cargo/physical-load';
import { cargoPayloadHash } from './cargo-execution.repository';
import { adaptRequestManifest } from './cargo-manifest.service';
import { recordReservationEvent } from './reservation-events.service';
import { resolveRequestEstimate } from './route-resolver.service';

const measurement = z.string().max(32);
const draftLineSchema = z.object({
  line_id: z.string().trim().min(1).max(128), name: z.string().trim().min(1).max(500),
  source_sku_ref: z.string().trim().max(128).default(''), package_description: z.string().trim().max(128).default(''),
  expected_quantity: measurement, quantity_basis: z.enum(['UNIT', 'TRANSPORT_PACKAGE']), unit: z.string().trim().min(1).max(32),
  transport_package_count: measurement, gross_weight_kg_per_package: measurement,
  length_m: measurement, width_m: measurement, height_m: measurement, package_can_rotate: z.boolean(),
  handling: z.array(z.enum(['FRAGILE', 'NO_STACK', 'FOOD_SEPARATION', 'SECURE_LOAD', 'SPILL_CONTAINMENT'])).max(5),
  temperature_mode: z.enum(['NONE', 'REQUIRED']), temperature_min_c: measurement.default(''), temperature_max_c: measurement.default(''),
}).strict();
const inputSchema = z.object({
  submission_id: z.string().uuid().transform(value => value.toLowerCase()), load_type: z.literal('Cargo'), service_code: cargoServiceSchema,
  pickup_location_id: z.number().int().positive().max(2147483647), dropoff_location_id: z.number().int().positive().max(2147483647),
  pickup_datetime: z.string().datetime({ offset: true }),
  cargo_description: z.string().trim().min(1).max(2000), cargo_weight_kg: measurement,
  source_department: z.string().trim().max(100).default(''), special_requests: z.string().trim().max(2000).default(''),
  requested_category_id: z.number().int().positive().max(2147483647).nullable().default(null),
  priority: z.enum(['Low', 'Normal', 'High', 'Urgent']).default('Normal'),
  lines: z.array(draftLineSchema).min(1).max(500),
}).strict();
const fail = (message, status = 400, code = 'INTERNAL_RESERVATION_INVALID') => { throw new AuthError(message, status, code); };

/** Staff-owned Cargo intake; request, immutable contents and audit commit together. */
export async function createInternalCargoReservation(raw, session, { db = { withTransaction }, req = null } = {}) {
  if (!rolesFor('reservations', 'create').includes(session?.user?.role) || !Number.isSafeInteger(session?.user?.employeeId) || session.user.employeeId <= 0) {
    fail('You cannot create an internal Cargo reservation.', 403, 'FORBIDDEN');
  }
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) fail('Review the Cargo reservation fields.');
  const input = parsed.data;
  const validation = validateCargoDraft({ description: input.cargo_description, declaredWeight: input.cargo_weight_kg, lines: input.lines });
  if (!validation.valid) fail(Object.values(validation.errors)[0]);
  const externalId = `internal:${input.submission_id}`;
  const manifestResult = manifestContentSchema.safeParse({
    source_ref: { system: 'INTERNAL', organization_id: 'fleetops', external_request_id: externalId },
    service_code: input.service_code, physical_contract_version: 1,
    lines: input.lines.map(line => ({
      line_id: line.line_id, name: line.name, quantity_basis: line.quantity_basis, expected_quantity: line.expected_quantity,
      unit: line.unit, reference_image_ref: null, handling: line.handling,
      ...(line.source_sku_ref ? { source_sku_ref: line.source_sku_ref } : {}),
      physical: { transport_package_count: Number(line.transport_package_count), package_description: line.package_description || null,
        gross_weight_kg_per_package: line.gross_weight_kg_per_package,
        dimensions_m: { length: line.length_m, width: line.width_m, height: line.height_m }, package_can_rotate: line.package_can_rotate,
        temperature_c: line.temperature_mode === 'NONE' ? null : { min_c: Number(line.temperature_min_c), max_c: Number(line.temperature_max_c) } },
    })),
  });
  if (!manifestResult.success) fail('Review the cargo item quantities and transport requirements.');
  const manifest = manifestResult.data;
  const totals = calculateCargoPhysicalTotals(manifest);
  const reconciliation = reconcileCargoDeclaredWeight(manifest, input.cargo_weight_kg);
  if (totals.status !== 'PASS' || reconciliation.status !== 'PASS') fail(reconciliation.reason);
  const manifestHash = cargoPayloadHash(manifest);
  const typed = parseV2TransportationRequest({
    external_booking_id: externalId, source_system: 'INTERNAL', pickup_location: 'pending registry lookup',
    pickup_datetime: input.pickup_datetime, service_code: input.service_code, load_type: 'Cargo',
    cargo_weight_kg: Number(totals.weight_decimal), cargo_description: input.cargo_description, priority: input.priority,
  });
  const fingerprint = cargoPayloadHash({ ...input, lines: manifest.lines, cargo_weight_kg: totals.weight_decimal,
    pickup_datetime: typed.pickup_datetime, employee_id: session.user.employeeId });
  return db.withTransaction(async tx => {
    // Same table-before-request lock order as manifest intake and dispatch commit.
    await tx.query('LOCK TABLE transportation_requests, request_cargo_manifest_revisions IN SHARE ROW EXCLUSIVE MODE');
    const existing = (await tx.query('SELECT * FROM transportation_requests WHERE source_system=$1 AND external_request_id=$2 FOR UPDATE', ['INTERNAL', externalId])).rows[0];
    if (existing) {
      if (existing.deleted_at || existing.external_create_fingerprint !== fingerprint) fail('This submission already has different saved details. Retry the original details or start a new reservation.', 409, 'INTERNAL_RESERVATION_REPLAY_CONFLICT');
      const saved = (await tx.query('SELECT * FROM request_cargo_manifest_revisions WHERE request_id=$1 ORDER BY revision DESC LIMIT 1', [existing.request_id])).rows[0];
      if (!saved || saved.revision !== 1 || saved.manifest_hash !== manifestHash) fail('The saved Cargo reservation needs review before retrying.', 409, 'INTERNAL_RESERVATION_REPLAY_CONFLICT');
      const view = adaptRequestManifest(saved, { ...existing, service_code: input.service_code });
      return { ...existing, service_code: input.service_code, manifest_ref: view.manifest_ref, idempotent: true };
    }
    const locations = (await tx.query('SELECT location_id,name FROM locations WHERE location_id=ANY($1::int[]) AND is_active=true AND retired_at IS NULL ORDER BY location_id FOR SHARE', [[input.pickup_location_id, input.dropoff_location_id]])).rows;
    const pickup = locations.find(location => location.location_id === input.pickup_location_id);
    const dropoff = locations.find(location => location.location_id === input.dropoff_location_id);
    if (!pickup || !dropoff) fail('Choose active pickup and dropoff locations.', 422, 'INTERNAL_LOCATION_UNAVAILABLE');
    const service = (await tx.query("SELECT service_type_id,default_load_type FROM service_types WHERE service_code=$1 AND status='Active' AND deleted_at IS NULL FOR SHARE", [input.service_code])).rows[0];
    if (!service || service.default_load_type !== 'Cargo') fail('This Cargo service is unavailable.', 422, 'SERVICE_UNAVAILABLE');
    let category = null;
    if (input.requested_category_id != null) {
      category = (await tx.query("SELECT category_id,category_name FROM vehiclecategories WHERE category_id=$1 AND status='Active' AND deleted_at IS NULL FOR SHARE", [input.requested_category_id])).rows[0];
      if (!category) fail('Choose an active vehicle category.', 422, 'INTERNAL_CATEGORY_UNAVAILABLE');
    }
    const estimate = await resolveRequestEstimate({ ...typed, pickup_location: pickup.name, dropoff_location: dropoff.name,
      pickup_location_id: pickup.location_id, dropoff_location_id: dropoff.location_id }, tx, { strictRegistry: true, persistRoute: false });
    const columns = ['external_booking_id', 'external_request_id', 'source_system', 'external_create_fingerprint', 'reservation_number',
      'pickup_location', 'dropoff_location', 'pickup_location_id', 'dropoff_location_id', 'pickup_datetime', 'passenger_count',
      'load_type', 'service_type_id', 'cargo_weight_kg', 'cargo_description', 'source_department', 'special_requests',
      'requested_category_id', 'requested_vehicle_type', 'priority', 'booking_status', 'fleet_status', 'estimated_distance', 'estimated_duration'];
    const values = [externalId, externalId, 'INTERNAL', fingerprint, `RS-${randomUUID().slice(0, 8).toUpperCase()}`,
      pickup.name, dropoff.name, pickup.location_id, dropoff.location_id, typed.pickup_datetime, null,
      'Cargo', service.service_type_id, typed.cargo_weight_kg, typed.cargo_description, input.source_department || null, input.special_requests || null,
      category?.category_id ?? null, category?.category_name ?? null, typed.priority, 'Pending', 'Pending', estimate.distanceKm, estimate.durationMin];
    const request = (await tx.query(`INSERT INTO transportation_requests (${columns.join(',')}) VALUES (${values.map((_, index) => `$${index + 1}`).join(',')}) RETURNING *`, values)).rows[0];
    const saved = (await tx.query(`INSERT INTO request_cargo_manifest_revisions
      (request_id,revision,manifest_hash,source_system,source_organization_id,source_external_request_id,source_event_id,manifest_snapshot)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`, [request.request_id, 1, manifestHash, 'INTERNAL', 'fleetops', externalId, input.submission_id, JSON.stringify(manifest)])).rows[0];
    await recordReservationEvent({ requestId: request.request_id, eventType: RESERVATION_EVENT.CREATED, toStatus: 'Pending',
      session, db: tx, strict: true, description: 'Internal Cargo reservation created with its item list.',
      metadata: { source_system: 'INTERNAL', manifest_revision: 1, item_count: manifest.lines.length } });
    await writeAuditRequired(tx, req, session, { action: 'create', resource: 'transportation_requests', resourceId: request.request_id,
      eventKey: input.submission_id, newValues: { source: 'INTERNAL', fleet_status: 'Pending', count: manifest.lines.length } });
    const view = adaptRequestManifest(saved, { ...request, service_code: input.service_code });
    return { ...request, service_code: input.service_code, manifest_ref: view.manifest_ref, idempotent: false };
  });
}

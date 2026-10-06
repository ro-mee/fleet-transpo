import { z } from "zod";
import { RESERVATION_PRIORITY } from "@/lib/constants";

// ============================================================================
// Booking <-> Fleet integration contracts.
//
// These schemas ARE the API contract between the parent Booking subsystem and
// this Fleet sub-system. They are the single source of truth for the shape of
// data crossing the boundary, in both directions. The mock gateway produces
// data validated against these; the real HTTP gateway will validate against the
// same schemas — so mock and production are guaranteed structurally identical.
//
// Deliberately NO branch field (single-org Fleet; see migration 013).
// ============================================================================

// ---- Inbound: a transportation request FROM Booking -> Fleet ----------------
//
// Booking owns everything here. Fleet caches it read-only and never mutates the
// guest/booking fields. `external_booking_id` is the correlation + idempotency
// key across the boundary.
export const TransportationRequestSchema = z.object({
  external_booking_id: z.string().min(1, "external_booking_id is required."),
  source_system: z.string().min(1).default("PMS"),
  booking_reference: z.string().optional().nullable(),

  guest_name: z.string().optional().nullable(),
  pickup_location: z.string().min(1, "pickup_location is required."),
  dropoff_location: z.string().optional().nullable(),

  // ISO-8601 datetime with offset, e.g. "2026-08-10T14:30:00+08:00".
  pickup_datetime: z.string().min(1, "pickup_datetime is required.").transform(val => {
    const dt = new Date(val);
    if (isNaN(dt.getTime())) throw new Error("Invalid pickup_datetime");
    return dt.toISOString();
  }),

  passenger_count: z.coerce.number().int().min(1).default(1),
  special_requests: z.string().optional().nullable(),

  // What kind of vehicle Booking is asking for, in Booking's own words
  // ("Executive SUV", "airport shuttle", "cargo van"). Free text by design:
  // Booking does not know Fleet's category ids and must never send one, so the
  // string is what crosses the boundary and Fleet resolves it to one of its own
  // `vehiclecategories` at ingest (see integration/category-resolver.js). The
  // raw string is then kept verbatim as the record of what was actually asked
  // for, even when it resolves to nothing.
  requested_vehicle_type: z.string().optional().nullable(),

  // Fleet service categorization (optional; Fleet may infer/assign later).
  service_type_id: z.coerce.number().int().optional().nullable(),

  // Booking's priority vocabulary uses "Normal"; Fleet's uses "Medium".
  // The value is accepted as-sent here and translated by normalizePriority()
  // in parseTransportationRequest — never store the raw external string.
  priority: z.enum(["Low", "Normal", "High", "Urgent"]).default("Normal"),

  // What Booking believes the state is. Fleet keeps its own fleet_status.
  booking_status: z.string().optional().default("Pending"),

  // Optional priority-engine signals. Booking may flag a guest as VIP or a
  // ride as an emergency; both feed the derived queue priority. Absent by
  // default (false) so legacy senders are unaffected.
  is_vip: z.boolean().optional().default(false),
  is_emergency: z.boolean().optional().default(false),
});

/** @typedef {z.infer<typeof TransportationRequestSchema>} TransportationRequest */

// ---- Outbound: a status event FROM Fleet -> Booking -------------------------
//
// Emitted whenever a request's Fleet lifecycle advances. `status` uses the
// SHARED external vocabulary (see src/lib/integration/status-map.js), never a
// Fleet-internal string.
export const TransportStatusEventSchema = z.object({
  event_id: z.string().optional(),
  source_system: z.string().min(1).optional(),
  external_request_id: z.string().min(1).optional(),
  external_booking_id: z.string().min(1),
  status: z.string().min(1), // EXTERNAL_STATUS value
  fleet_reference: z.union([z.string(), z.number()]).optional().nullable(),
  driver: z
    .object({ name: z.string().optional().nullable(), phone: z.string().optional().nullable() })
    .optional()
    .nullable(),
  vehicle: z
    .object({ plate_number: z.string().optional().nullable(), description: z.string().optional().nullable() })
    .optional()
    .nullable(),
  eta: z.string().optional().nullable(),
  occurred_at: z.string().min(1),
});

/** @typedef {z.infer<typeof TransportStatusEventSchema>} TransportStatusEvent */

/**
 * Translate Booking's priority vocabulary into Fleet's.
 *
 * Booking sends "Normal"; Fleet's chk_transport_priority CHECK (migration 016)
 * only permits Urgent/High/Medium/Low. This is the anti-corruption translation
 * for that one term — anything unrecognized degrades to Medium rather than
 * throwing, so a vocabulary drift on Booking's side can never block ingest.
 *
 * @param {string|null|undefined} raw priority as sent by Booking
 * @returns {"Urgent"|"High"|"Medium"|"Low"}
 */
export function normalizePriority(raw) {
  switch (String(raw || "").trim().toLowerCase()) {
    case "urgent":
      return RESERVATION_PRIORITY.URGENT;
    case "high":
      return RESERVATION_PRIORITY.HIGH;
    case "low":
      return RESERVATION_PRIORITY.LOW;
    case "normal":
    case "medium":
      return RESERVATION_PRIORITY.MEDIUM;
    default:
      return RESERVATION_PRIORITY.MEDIUM;
  }
}

/**
 * Validate + normalize an inbound request. Throws a ZodError on invalid shape.
 * Priority is translated to Fleet's vocabulary so callers can persist the
 * result directly without tripping chk_transport_priority.
 * @param {unknown} raw
 * @returns {TransportationRequest}
 */
export function parseTransportationRequest(raw) {
  const parsed = TransportationRequestSchema.parse(raw);
  return { ...parsed, load_type: "Passenger", priority: normalizePriority(parsed.priority) };
}

const SERVICE_LOAD = {
  GUEST_TRANSPORT: "Passenger",
  VIP_GUEST_TRANSPORT: "Passenger",
  RESTAURANT_SUPPLY_PICKUP: "Cargo",
  RESTAURANT_FOOD_DELIVERY: "Cargo",
  HOTEL_SUPPLY_TRANSFER: "Cargo",
};

const V2RequestSchema = TransportationRequestSchema.omit({ passenger_count: true, service_type_id: true }).extend({
  load_type: z.enum(["Passenger", "Cargo"]),
  service_code: z.enum(Object.keys(SERVICE_LOAD)),
  passenger_count: z.number().int().nonnegative().max(2147483647).nullable().optional(),
  cargo_weight_kg: z.number().finite().min(0.001).max(999999999.999)
    .refine((value) => Number(value.toFixed(3)) === value, "Cargo weight supports at most three decimal places")
    .nullable().optional(),
  cargo_description: z.string().trim().min(1).max(2000).nullable().optional(),
  source_department: z.string().trim().min(1).max(100).nullable().optional(),
}).superRefine((value, ctx) => {
  if (SERVICE_LOAD[value.service_code] !== value.load_type) {
    ctx.addIssue({ code: "custom", path: ["service_code"], message: "Service code does not match load type" });
  }
  if (value.load_type === "Passenger" && (!value.passenger_count || value.cargo_weight_kg != null || value.cargo_description != null)) {
    ctx.addIssue({ code: "custom", path: ["passenger_count"], message: "Passenger loads require a positive passenger count and no cargo details" });
  }
  if (value.load_type === "Cargo" && (value.passenger_count != null && value.passenger_count !== 0 || !value.cargo_weight_kg || !value.cargo_description)) {
    ctx.addIssue({ code: "custom", path: ["cargo_weight_kg"], message: "Cargo requires weight and description, not passengers" });
  }
});

export function parseV2TransportationRequest(raw) {
  const parsed = V2RequestSchema.parse(raw);
  return {
    ...parsed,
    passenger_count: parsed.load_type === "Cargo" ? null : parsed.passenger_count,
    cargo_weight_kg: parsed.load_type === "Passenger" ? null : parsed.cargo_weight_kg,
    cargo_description: parsed.load_type === "Passenger" ? null : parsed.cargo_description,
    priority: normalizePriority(parsed.priority),
  };
}

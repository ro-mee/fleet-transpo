import { z } from "zod";

const text = (max = 255) => z.string().trim().min(1).max(max);
const positive = z.number().finite().positive().max(1000000000);
const packageDimension = z.number().finite().positive().max(100);
const isoDateTime = text(40).refine(
  (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)),
  "Must be an ISO date and time with an explicit timezone."
);

const temperatureRange = z.object({
  min_c: z.number().finite().min(-80).max(80),
  max_c: z.number().finite().min(-80).max(80),
}).strict().refine((range) => range.min_c <= range.max_c, "Minimum temperature must not exceed maximum temperature.");

const handlingCodes = ["FRAGILE", "NO_STACK", "FOOD_SEPARATION", "SECURE_LOAD", "SPILL_CONTAINMENT"];

const manifestLine = z.object({
  external_line_id: text(128),
  sku_ref: text(128),
  description: z.string().trim().max(500).optional(),
  ordered_quantity: positive,
  ordered_uom: text(32),
  transport_package_count: z.number().finite().int().positive().max(100000),
  units_per_package: positive,
  gross_weight_kg_per_package: z.number().finite().positive().max(50000),
  dimensions_m: z.object({ length: packageDimension, width: packageDimension, height: packageDimension }).strict(),
  temperature_c: temperatureRange.nullable().default(null),
  handling: z.array(z.enum(handlingCodes)).default([]),
  package_can_rotate: z.boolean().default(true),
}).strict();

const stop = z.object({
  site_id: text(128),
  address: text(1000),
}).strict();

const request = z.object({
  external_request_id: text(128),
  approver_ref: text(128),
  manifest_revision: z.number().finite().int().positive().max(2147483647),
  pickup: stop.extend({
    ready: z.boolean(),
    ready_at: isoDateTime,
  }),
  delivery: stop.extend({
    window_start: isoDateTime,
    window_end: isoDateTime,
  }).refine((value) => Date.parse(value.window_start) < Date.parse(value.window_end), "Delivery window end must follow its start."),
  timezone: text(64),
  lines: z.array(manifestLine).min(1).max(500),
}).strict();

export const supplyTransportEventSchema = z.object({
  schema_version: z.literal("1.0"),
  event_id: text(255),
  event_type: z.enum(["TransportRequestApproved", "ManifestUpdated"]),
  sequence: z.number().finite().int().positive().max(Number.MAX_SAFE_INTEGER),
  correlation_id: text(255),
  source: z.object({
    organization_id: text(128),
    module: z.literal("SCM_SANDBOX"),
  }).strict(),
  occurred_at: isoDateTime,
  request,
}).strict();

export function validateSupplyTransportEvent(value) {
  return supplyTransportEventSchema.safeParse(value);
}

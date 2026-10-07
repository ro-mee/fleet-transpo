import { z } from "zod";
import { query, withTransaction } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { err, errValidation, handleError, ok, parseBody, requirePermission } from "@/lib/api/utils";

const capabilityCodes = ["FRAGILE", "NO_STACK", "FOOD_SEPARATION", "SECURE_LOAD", "SPILL_CONTAINMENT"];
const positive = (max) => z.number().finite().positive().max(max);
const validDate = (value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const profileInput = z.object({
  vehicle_id: z.number().int().positive(),
  supports_supply_delivery: z.boolean(),
  rated_payload_kg: positive(1000000).optional(),
  gross_vehicle_weight_limit_kg: positive(1000000).optional(),
  operating_mass_kg: positive(1000000).optional(),
  operational_reserve_kg: z.number().finite().min(0).max(1000000).optional(),
  usable_volume_m3: positive(10000).optional(),
  compartment_length_m: positive(100).optional(),
  compartment_width_m: positive(100).optional(),
  compartment_height_m: positive(100).optional(),
  opening_length_m: positive(100).optional(),
  opening_width_m: positive(100).optional(),
  opening_height_m: positive(100).optional(),
  temperature_min_c: z.number().finite().min(-80).max(80).nullable().optional(),
  temperature_max_c: z.number().finite().min(-80).max(80).nullable().optional(),
  handling_capabilities: z.array(z.enum(capabilityCodes)).max(capabilityCodes.length).default([]),
  verification_reference: z.string().trim().min(3).max(255).optional(),
  verification_valid_until: z.string().refine(validDate, "Enter a real calendar date in YYYY-MM-DD format.").optional(),
}).strict().superRefine((value, context) => {
  if (!value.supports_supply_delivery) return;
  for (const field of [
    "rated_payload_kg", "gross_vehicle_weight_limit_kg", "operating_mass_kg", "operational_reserve_kg",
    "usable_volume_m3", "compartment_length_m", "compartment_width_m",
    "compartment_height_m", "opening_length_m", "opening_width_m", "opening_height_m",
    "verification_reference", "verification_valid_until",
  ]) {
    if (value[field] === undefined) context.addIssue({ code: "custom", path: [field], message: "Required when enabling supply delivery." });
  }
  if (value.verification_valid_until && value.verification_valid_until <= new Date().toISOString().slice(0, 10)) {
    context.addIssue({ code: "custom", path: ["verification_valid_until"], message: "Verification must remain valid beyond today." });
  }
  if (value.gross_vehicle_weight_limit_kg !== undefined && value.operating_mass_kg !== undefined && value.gross_vehicle_weight_limit_kg <= value.operating_mass_kg) {
    context.addIssue({ code: "custom", path: ["gross_vehicle_weight_limit_kg"], message: "Gross vehicle weight must exceed operating mass." });
  }
  if (value.temperature_min_c != null && value.temperature_max_c != null && value.temperature_min_c > value.temperature_max_c) {
    context.addIssue({ code: "custom", path: ["temperature_max_c"], message: "Maximum temperature must not be below minimum temperature." });
  }
});

export async function GET(req) {
  try {
    await requirePermission(req, "vehicles", "read_all");
    const vehicleIdText = new URL(req.url).searchParams.get("vehicle_id");
    const vehicleId = vehicleIdText == null ? null : Number(vehicleIdText);
    if (vehicleIdText != null && (!Number.isInteger(vehicleId) || vehicleId <= 0)) return err("vehicle_id must be a positive integer.", 400);
    const { rows } = await query(
      `SELECT v.vehicle_id, v.plate_number, v.vehicle_name, v.vehicle_status,
              p.supports_supply_delivery, p.rated_payload_kg, p.gross_vehicle_weight_limit_kg,
              p.operating_mass_kg, p.operational_reserve_kg, p.usable_volume_m3,
              p.compartment_length_m, p.compartment_width_m, p.compartment_height_m,
              p.opening_length_m, p.opening_width_m, p.opening_height_m,
              p.temperature_min_c, p.temperature_max_c, p.handling_capabilities,
              p.verification_reference, p.verification_valid_until, p.verified_at, p.verified_by
         FROM vehicles v
         LEFT JOIN vehicle_cargo_profiles p ON p.vehicle_id = v.vehicle_id
        WHERE v.deleted_at IS NULL AND ($1::integer IS NULL OR v.vehicle_id = $1)
        ORDER BY v.plate_number`,
      [vehicleId]
    );
    return ok({ profiles: rows });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(req) {
  try {
    const session = await requirePermission(req, "vehicles", "update");
    const parsed = profileInput.safeParse(await parseBody(req));
    if (!parsed.success) {
      return errValidation(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join(".") || "profile", issue.message])));
    }
    const profile = parsed.data;
    const saved = await withTransaction(async (tx) => {
      const { rows: vehicles } = await tx.query(
        `SELECT vehicle_id FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [profile.vehicle_id]
      );
      if (!vehicles[0]) return null;

      const { rows: previousRows } = await tx.query(
        `SELECT * FROM vehicle_cargo_profiles WHERE vehicle_id = $1 FOR UPDATE`,
        [profile.vehicle_id]
      );
      const previous = previousRows[0] ?? null;
      if (!profile.supports_supply_delivery) {
        const { rows } = previous
          ? await tx.query(
              `UPDATE vehicle_cargo_profiles
                  SET supports_supply_delivery = false, updated_at = now()
                WHERE vehicle_id = $1
                RETURNING *`,
              [profile.vehicle_id]
            )
          : await tx.query(
              `INSERT INTO vehicle_cargo_profiles (vehicle_id, supports_supply_delivery)
               VALUES ($1, false) RETURNING *`,
              [profile.vehicle_id]
            );
        return { profile: rows[0], previous };
      }

      const { rows } = await tx.query(
        `INSERT INTO vehicle_cargo_profiles
           (vehicle_id, supports_supply_delivery, rated_payload_kg,
            gross_vehicle_weight_limit_kg, operating_mass_kg, operational_reserve_kg, usable_volume_m3,
            compartment_length_m, compartment_width_m, compartment_height_m,
            opening_length_m, opening_width_m, opening_height_m,
            temperature_min_c, temperature_max_c, handling_capabilities,
            verification_reference, verification_valid_until, verified_at, verified_by, updated_at)
         VALUES ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::date, now(), $18, now())
         ON CONFLICT (vehicle_id) DO UPDATE SET
           supports_supply_delivery = true,
           rated_payload_kg = EXCLUDED.rated_payload_kg,
           gross_vehicle_weight_limit_kg = EXCLUDED.gross_vehicle_weight_limit_kg,
           operating_mass_kg = EXCLUDED.operating_mass_kg,
           operational_reserve_kg = EXCLUDED.operational_reserve_kg,
           usable_volume_m3 = EXCLUDED.usable_volume_m3,
           compartment_length_m = EXCLUDED.compartment_length_m,
           compartment_width_m = EXCLUDED.compartment_width_m,
           compartment_height_m = EXCLUDED.compartment_height_m,
           opening_length_m = EXCLUDED.opening_length_m,
           opening_width_m = EXCLUDED.opening_width_m,
           opening_height_m = EXCLUDED.opening_height_m,
           temperature_min_c = EXCLUDED.temperature_min_c,
           temperature_max_c = EXCLUDED.temperature_max_c,
           handling_capabilities = EXCLUDED.handling_capabilities,
           verification_reference = EXCLUDED.verification_reference,
           verification_valid_until = EXCLUDED.verification_valid_until,
           verified_at = now(), verified_by = EXCLUDED.verified_by, updated_at = now()
         RETURNING *`,
        [
          profile.vehicle_id, profile.rated_payload_kg, profile.gross_vehicle_weight_limit_kg,
          profile.operating_mass_kg, profile.operational_reserve_kg, profile.usable_volume_m3,
          profile.compartment_length_m, profile.compartment_width_m, profile.compartment_height_m,
          profile.opening_length_m, profile.opening_width_m, profile.opening_height_m,
          profile.temperature_min_c ?? null, profile.temperature_max_c ?? null,
          profile.handling_capabilities, profile.verification_reference,
          profile.verification_valid_until, session.user.employeeId,
        ]
      );
      return { profile: rows[0], previous };
    });

    if (!saved) return err("Vehicle not found.", 404);
    await writeAudit(req, session, {
      action: "update",
      resource: "vehicle_cargo_profiles",
      resourceId: profile.vehicle_id,
      oldValues: saved.previous ? {
        supports_supply_delivery: saved.previous.supports_supply_delivery,
        rated_payload_kg: saved.previous.rated_payload_kg,
        gross_vehicle_weight_limit_kg: saved.previous.gross_vehicle_weight_limit_kg,
        operating_mass_kg: saved.previous.operating_mass_kg,
        operational_reserve_kg: saved.previous.operational_reserve_kg,
        usable_volume_m3: saved.previous.usable_volume_m3,
      } : null,
      newValues: {
        supports_supply_delivery: saved.profile.supports_supply_delivery,
        rated_payload_kg: saved.profile.rated_payload_kg,
        gross_vehicle_weight_limit_kg: saved.profile.gross_vehicle_weight_limit_kg,
        operating_mass_kg: saved.profile.operating_mass_kg,
        operational_reserve_kg: saved.profile.operational_reserve_kg,
        usable_volume_m3: saved.profile.usable_volume_m3,
        verification_reference: saved.profile.verification_reference,
        verification_valid_until: saved.profile.verification_valid_until,
      },
    });
    return ok({ profile: saved.profile });
  } catch (error) {
    return handleError(error);
  }
}

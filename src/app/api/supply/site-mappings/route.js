import { z } from "zod";
import { query, withTransaction } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { err, errValidation, handleError, ok, parseBody, requireAuth } from "@/lib/api/utils";

const mappingInput = z.object({
  source_organization_id: z.string().trim().min(9).max(128).startsWith("sandbox:"),
  external_site_id: z.string().trim().min(1).max(128),
  location_id: z.number().int().positive(),
}).strict();

export async function GET(req) {
  try {
    await requireAuth(req, ["admin", "super_admin"]);
    const [{ rows: mappings }, { rows: locations }] = await Promise.all([
      query(
        `SELECT m.supply_site_mapping_id, m.source_organization_id, m.external_site_id,
                m.location_id, m.is_active, m.verified_by, m.verified_at,
                l.name AS location_name, l.address AS location_address,
                l.latitude, l.longitude, l.is_active AS location_is_active
           FROM supply_site_mappings m
           JOIN locations l ON l.location_id = m.location_id
          ORDER BY m.source_organization_id, m.external_site_id`
      ),
      query(
        `SELECT location_id, name, address, latitude, longitude
           FROM locations
          WHERE is_active = true AND retired_at IS NULL
            AND address IS NOT NULL AND trim(address) <> ''
            AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
          ORDER BY name, location_id`
      ),
    ]);
    return ok({ mappings, locations });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(req) {
  try {
    const session = await requireAuth(req, ["admin", "super_admin"]);
    const parsed = mappingInput.safeParse(await parseBody(req));
    if (!parsed.success) {
      return errValidation(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join(".") || "mapping", issue.message])));
    }
    const mapping = parsed.data;
    const result = await withTransaction(async (tx) => {
      const { rows: locationRows } = await tx.query(
        `SELECT location_id, name, address, latitude, longitude, is_active, retired_at
           FROM locations
          WHERE location_id = $1
          FOR UPDATE`,
        [mapping.location_id]
      );
      const location = locationRows[0];
      if (!location) return { error: "Fleet location not found.", status: 404 };
      if (!location.is_active || location.retired_at || !location.address?.trim() || location.latitude == null || location.longitude == null) {
        return { error: "Choose an active Fleet location with a stored address and coordinates.", status: 409 };
      }
      const latitude = Number(location.latitude);
      const longitude = Number(location.longitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        return { error: "Fleet location coordinates are invalid.", status: 409 };
      }

      const { rows: previousRows } = await tx.query(
        `SELECT supply_site_mapping_id, location_id, is_active
           FROM supply_site_mappings
          WHERE source_organization_id = $1 AND external_site_id = $2
          FOR UPDATE`,
        [mapping.source_organization_id, mapping.external_site_id]
      );
      const { rows } = await tx.query(
        `INSERT INTO supply_site_mappings
           (source_organization_id, external_site_id, location_id, is_active, verified_by, verified_at, updated_at)
         VALUES ($1, $2, $3, true, $4, now(), now())
         ON CONFLICT (source_organization_id, external_site_id) DO UPDATE SET
           location_id = EXCLUDED.location_id,
           is_active = true,
           verified_by = EXCLUDED.verified_by,
           verified_at = now(),
           updated_at = now()
         RETURNING supply_site_mapping_id, source_organization_id, external_site_id,
                   location_id, is_active, verified_by, verified_at`,
        [mapping.source_organization_id, mapping.external_site_id, mapping.location_id, session.user.employeeId]
      );
      return { mapping: rows[0], previous: previousRows[0] ?? null, location };
    });

    if (result.error) return err(result.error, result.status);
    await writeAudit(req, session, {
      action: result.previous ? "update" : "create",
      resource: "supply_site_mappings",
      resourceId: result.mapping.supply_site_mapping_id,
      oldValues: result.previous ? { location_id: result.previous.location_id, is_active: result.previous.is_active } : null,
      newValues: {
        source_organization_id: result.mapping.source_organization_id,
        external_site_id: result.mapping.external_site_id,
        location_id: result.mapping.location_id,
        location_name: result.location.name,
        verified_by: result.mapping.verified_by,
      },
    });
    return ok({ mapping: { ...result.mapping, location_name: result.location.name, latitude: result.location.latitude, longitude: result.location.longitude } });
  } catch (error) {
    return handleError(error);
  }
}

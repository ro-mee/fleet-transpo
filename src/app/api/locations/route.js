import { query, withTransaction } from "@/lib/db";
import { saveAddress } from "@/services/address.service";
import { resolveStructuredAddress } from "@/lib/address/validate-structured";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { isValidObject, validateBody } from "@/lib/validation/helpers";
import { writeAudit } from "@/lib/audit";
import { isGoogleMapsUrl, resolveGoogleMapsCoordinates } from "@/lib/google-maps";
import { rolesFor } from "@/lib/auth/permissions";

/** Validated radius or null (→ DB default 100 m). Schema validation ran first. */
function radiusOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return Math.round(Number(value));
}

function coordinateRule(label, min, max) {
  return (value) => {
    if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
      return `${label} must be a number between ${min} and ${max}.`;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
      return `${label} must be a number between ${min} and ${max}.`;
    }
    return null;
  };
}

const locationSchema = {
  name: { required: true, maxLength: 255, label: "Location name", validate: (value) => typeof value === "string" ? null : "Location name must be text." },
  // Optional since the cascade: a picked address arrives as `structured_address`
  // and the server composes the text below from its OWN resolution of it. The
  // plain string is still accepted until the last surface moves off it, so both
  // shapes are legitimately in use at once.
  address: { maxLength: 2000, label: "Address", validate: (value) => value === undefined || value === null || typeof value === "string" ? null : "Address must be text." },
  maps_url: { maxLength: 2000, label: "Google Maps link", validate: (value) => !String(value || "").trim() || isGoogleMapsUrl(String(value).trim()) ? null : "Google Maps link must be a valid Google Maps URL." },
  // PR #3 arrival geofences: optional per-location radii (metres, 1–1000).
  // Absent → DB default 100 m. Operational tuning, not identity.
  pickup_radius_m: { label: "Pickup radius", validate: radiusRule("Pickup radius") },
  dropoff_radius_m: { label: "Drop-off radius", validate: radiusRule("Drop-off radius") },
};

function radiusRule(label) {
  return (value) => {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > 1000) {
      return `${label} must be between 1 and 1000 metres.`;
    }
    return null;
  };
}

export async function GET(req) {
  try {
    const session = await requirePermission(req, "routes", "read");
    const includeInactive = new URL(req.url).searchParams.get("include_inactive") === "true";
    const canSeeInactive = rolesFor("locations", "read_inactive").includes(session.user.role);

    const { rows } = await query(
      `SELECT location_id, name, address, latitude, longitude, pickup_radius_m, dropoff_radius_m, address_id, created_at
         FROM locations
        ${includeInactive && canSeeInactive ? "" : "WHERE is_active = true"}
        ORDER BY name ASC`
    );

    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req) {
  try {
    const session = await requirePermission(req, "routes", "create");
    const body = await parseBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errValidation({ location: "Location payload must be an object." });
    }
    const errors = validateBody(body, locationSchema);
    if (!isValidObject(errors)) return errValidation(errors);

    const name = String(body.name).trim();
    const mapsUrl = String(body.maps_url || "").trim();
    const linkedCoordinates = await resolveGoogleMapsCoordinates(mapsUrl);
    const latitudeInput = linkedCoordinates?.latitude ?? body.latitude;
    const longitudeInput = linkedCoordinates?.longitude ?? body.longitude;
    const latitudeError = coordinateRule("Latitude", -90, 90)(latitudeInput);
    const longitudeError = coordinateRule("Longitude", -180, 180)(longitudeInput);
    if (latitudeError || longitudeError) {
      return errValidation({
        maps_url: mapsUrl
          ? "This Google Maps link could not be resolved to coordinates. Use a dropped-pin link or enter the coordinates manually."
          : "Add a Google Maps link or enter both coordinates.",
      });
    }
    const latitude = Number(Number(latitudeInput).toFixed(7));
    const longitude = Number(Number(longitudeInput).toFixed(7));

    // ── The address, in whichever of its two shapes arrived ──────────────────
    // A `structured_address` is the picked one. The server resolves it against
    // the PSGC hierarchy and takes the text from ITS OWN resolution — the client
    // sends a barangay code and street detail, and never the geography or the
    // composed string that get stored.
    //
    // Resolution happens HERE, outside the transaction, because it is validation:
    // a refused barangay is a 400 carrying field errors, and unwinding a write to
    // report one would be theatre. The matching `saveAddress` call is INSIDE the
    // transaction, so the address row and the location pointing at it commit
    // together or not at all — which is the contract that function documents.
    const structured = body.structured_address ?? null;
    const resolved = structured ? await resolveStructuredAddress(structured) : null;
    if (resolved && !resolved.ok) {
      return errValidation(resolved.errors ?? { structured_address: resolved.error });
    }
    const address = resolved?.value?.formattedAddress ?? String(body.address || "").trim();
    if (!address) {
      return errValidation({ address: "Provide an address, or pick one from the cascade." });
    }

    const location = await withTransaction(async (tx) => {
      const normalizedName = name.replace(/\s+/g, " ").toLowerCase();
      const duplicate = await tx.query(
        `SELECT location_id
           FROM locations
          WHERE is_active = true
            AND LOWER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')) = $1
          LIMIT 1`,
        [normalizedName]
      );
      if (duplicate.rows[0]) {
        throw Object.assign(new Error("An active location with this name already exists."), { status: 409 });
      }

      // Null for a legacy string address, which is what leaves `address_id` NULL
      // on those rows and lets the two shapes coexist during the migration.
      const addressId = resolved ? await saveAddress(resolved.value, { tx }) : null;

      const { rows } = await tx.query(
        `INSERT INTO locations (name, address, latitude, longitude, is_active, pickup_radius_m, dropoff_radius_m, address_id)
         VALUES ($1, $2, $3, $4, true, COALESCE($5, 100), COALESCE($6, 100), $7)
         RETURNING location_id, name, address, latitude, longitude, pickup_radius_m, dropoff_radius_m, address_id, created_at, is_active, retired_at`,
        [name, address, latitude, longitude, radiusOrNull(body.pickup_radius_m), radiusOrNull(body.dropoff_radius_m), addressId]
      );
      return rows[0];
    });

    await writeAudit(req, session, {
      action: "create",
      resource: "locations",
      resourceId: location?.location_id,
      newValues: location,
    });

    return ok(location, 201);
  } catch (e) {
    // The duplicate-name refusal is raised from inside the transaction now, so
    // its status has to survive the rollback — without this it would surface as
    // a 500 for what is an ordinary conflict.
    if (e?.status) return err(e.message, e.status);
    return handleError(e);
  }
}

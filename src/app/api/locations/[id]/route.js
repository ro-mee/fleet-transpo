import { withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { isId, isValidObject, validateBody } from "@/lib/validation/helpers";
import { writeAudit } from "@/lib/audit";
import { isGoogleMapsUrl, resolveGoogleMapsCoordinates } from "@/lib/google-maps";
import { saveAddress } from "@/services/address.service";
import { resolveStructuredAddress } from "@/lib/address/validate-structured";

function coordinateRule(label, min, max) {
  return (value) => {
    if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
      return `${label} must be a number between ${min} and ${max}.`;
    }
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max
      ? null
      : `${label} must be a number between ${min} and ${max}.`;
  };
}

const locationSchema = {
  name: { required: true, maxLength: 255, label: "Location name", validate: (value) => typeof value === "string" ? null : "Location name must be text." },
  // Optional since the cascade — a picked address arrives as `structured_address`
  // and the server composes the text from its own resolution of it. See POST.
  address: { maxLength: 2000, label: "Address", validate: (value) => value === undefined || value === null || typeof value === "string" ? null : "Address must be text." },
  maps_url: { maxLength: 2000, label: "Google Maps link", validate: (value) => !String(value || "").trim() || isGoogleMapsUrl(String(value).trim()) ? null : "Google Maps link must be a valid Google Maps URL." },
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

function radiusOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return Math.round(Number(value));
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function loadLocation(tx, id) {
  const { rows } = await tx.query(
    `SELECT location_id, name, address, latitude, longitude, pickup_radius_m, dropoff_radius_m,
            address_id, created_at, is_active, retired_at
       FROM locations
      WHERE location_id = $1
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function resolveCoordinates(body) {
  const mapsUrl = String(body.maps_url || "").trim();
  const linkedCoordinates = await resolveGoogleMapsCoordinates(mapsUrl);
  const latitudeInput = linkedCoordinates?.latitude ?? body.latitude;
  const longitudeInput = linkedCoordinates?.longitude ?? body.longitude;
  const latitudeError = coordinateRule("Latitude", -90, 90)(latitudeInput);
  const longitudeError = coordinateRule("Longitude", -180, 180)(longitudeInput);
  if (latitudeError || longitudeError) {
    return {
      error: {
        maps_url: mapsUrl
          ? "This Google Maps link could not be resolved to coordinates. Use a dropped-pin link or enter the coordinates manually."
          : "Add a Google Maps link or enter both coordinates.",
      },
    };
  }
  return {
    mapsUrl,
    latitude: Number(Number(latitudeInput).toFixed(7)),
    longitude: Number(Number(longitudeInput).toFixed(7)),
  };
}

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "routes", "update");
    const id = (await params).id;
    if (!isId(id)) return err("Location id is invalid", 400);

    const body = await parseBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errValidation({ location: "Location payload must be an object." });
    }
    const errors = validateBody(body, locationSchema);
    if (!isValidObject(errors)) return errValidation(errors);

    const name = String(body.name).trim();
    const coordinates = await resolveCoordinates(body);
    if (coordinates.error) return errValidation(coordinates.error);

    // ── The address, in whichever of its two shapes arrived ──────────────────
    // Same split as POST, for the same reasons: resolution happens HERE, outside
    // the transaction, because a refused barangay is a 422 carrying field errors
    // rather than a reason to unwind a write; the matching `saveAddress` runs
    // inside it, so the address row and this location commit together.
    const structured = body.structured_address ?? null;
    const resolved = structured ? await resolveStructuredAddress(structured) : null;
    if (resolved && !resolved.ok) {
      return errValidation(resolved.errors ?? { structured_address: resolved.error });
    }

    // `null` means NOT SUPPLIED, which is what lets an edit that only renames a
    // location omit the address entirely and leave the stored one — and its
    // registry row — untouched. An empty string is a different thing: it was
    // supplied, and refusing it beats silently reading it as an omission.
    let addressText = null;
    if (!resolved && body.address !== undefined && body.address !== null) {
      addressText = String(body.address).trim();
      if (!addressText) return errValidation({ address: "Address cannot be empty." });
    }

    const result = await withTransaction(async (tx) => {
      const current = await loadLocation(tx, Number(id));
      if (!current) throw Object.assign(new Error("Location not found"), { status: 404 });
      if (!current.is_active) throw Object.assign(new Error("Retired locations cannot be edited"), { status: 409 });

      const duplicate = await tx.query(
        `SELECT location_id
           FROM locations
          WHERE is_active = true
            AND location_id <> $2
            AND LOWER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')) = $1
          LIMIT 1`,
        [normalizeName(name), Number(id)]
      );
      if (duplicate.rows[0]) throw Object.assign(new Error("An active location with this name already exists."), { status: 409 });

      const coordinateChanged = current.latitude == null || current.longitude == null
        || Number(current.latitude) !== coordinates.latitude
        || Number(current.longitude) !== coordinates.longitude;
      const usageResult = await tx.query(
        `SELECT COUNT(*)::int AS usage_count
           FROM routes r
          WHERE (r.origin_location_id = $1 OR r.destination_location_id = $1)
            AND (
              EXISTS (SELECT 1 FROM dispatchschedules d WHERE d.route_id = r.route_id)
              OR EXISTS (SELECT 1 FROM trips t WHERE t.route_id = r.route_id)
            )`,
        [Number(id)]
      );
      const usageCount = Number(usageResult.rows[0]?.usage_count || 0);
      const versioned = coordinateChanged && usageCount > 0;

      // Radii are operational tuning, never identity: they ride along on
      // whichever row survives but can never trigger versioning by themselves.
      const nextPickupRadius = radiusOrNull(body.pickup_radius_m) ?? Number(current.pickup_radius_m) ?? 100;
      const nextDropoffRadius = radiusOrNull(body.dropoff_radius_m) ?? Number(current.dropoff_radius_m) ?? 100;

      // Which address this location ends up carrying, and which registry row it
      // points at. The third case is the one worth stating: a legacy string that
      // CHANGED clears the link rather than carrying it. The registry row holds
      // the geography and coordinates resolved from the text it was saved with,
      // so keeping the pointer would have `getAddress` describe an address that
      // no longer says that — the same stale-value failure the pin rule exists to
      // prevent. The orphaned row is inert; a string that did NOT change keeps its
      // link, which is what stops a rename from silently dropping the structured
      // address.
      const nextAddress = resolved ? resolved.value.formattedAddress : (addressText ?? current.address);
      const addressId = resolved
        ? await saveAddress(resolved.value, { tx })
        : nextAddress === current.address ? current.address_id : null;

      if (versioned) {
        const inserted = await tx.query(
          `INSERT INTO locations (name, address, latitude, longitude, is_active, pickup_radius_m, dropoff_radius_m, address_id)
           VALUES ($1, $2, $3, $4, true, $5, $6, $7)
           RETURNING location_id, name, address, latitude, longitude, pickup_radius_m, dropoff_radius_m,
                     address_id, created_at, is_active, retired_at`,
          [name, nextAddress, coordinates.latitude, coordinates.longitude, nextPickupRadius, nextDropoffRadius, addressId]
        );
        await tx.query(
          `UPDATE locations
              SET is_active = false, retired_at = NOW()
            WHERE location_id = $1`,
          [Number(id)]
        );
        return { location: inserted.rows[0], versioned: true, previousLocationId: Number(id), usageCount, oldLocation: current };
      }

      const updated = await tx.query(
        `UPDATE locations
            SET name = $1, address = $2, latitude = $3, longitude = $4,
                pickup_radius_m = $5, dropoff_radius_m = $6, address_id = $7
          WHERE location_id = $8 AND is_active = true
          RETURNING location_id, name, address, latitude, longitude, pickup_radius_m, dropoff_radius_m,
                    address_id, created_at, is_active, retired_at`,
        [name, nextAddress, coordinates.latitude, coordinates.longitude, nextPickupRadius, nextDropoffRadius, addressId, Number(id)]
      );
      if (name !== current.name) {
        await tx.query(
          `UPDATE routes
              SET origin = CASE WHEN origin_location_id = $1 THEN $2 ELSE origin END,
                  destination = CASE WHEN destination_location_id = $1 THEN $2 ELSE destination END,
                  updated_at = NOW()
            WHERE origin_location_id = $1 OR destination_location_id = $1`,
          [Number(id), name]
        );
      }
      if (coordinateChanged) {
        await tx.query(
          `UPDATE routes
              SET estimated_distance = NULL,
                  estimated_duration = NULL,
                  estimate_source = NULL,
                  estimate_updated_at = NULL,
                  updated_at = NOW()
            WHERE origin_location_id = $1 OR destination_location_id = $1`,
          [Number(id)]
        );
      }
      return { location: updated.rows[0], versioned: false, previousLocationId: null, usageCount, oldLocation: current };
    });

    await writeAudit(req, session, {
      action: "update",
      resource: "locations",
      resourceId: result.location?.location_id,
      oldValues: result.oldLocation,
      newValues: result.location,
    });
    return ok({
      ...result.location,
      versioned: result.versioned,
      previous_location_id: result.previousLocationId,
      usage_count: result.usageCount,
    });
  } catch (e) {
    if (e?.status) return err(e.message, e.status);
    return handleError(e);
  }
}

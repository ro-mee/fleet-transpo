import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError, errValidation } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";
import { saveAddress } from "@/services/address.service";
import { resolveStructuredAddress } from "@/lib/address/validate-structured";

function coordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function clean(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

export async function GET(req) {
  try {
    await requirePermission(req, "settings", "read");
    const { rows } = await query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_location' LIMIT 1`
    );
    return ok(rows[0]?.setting_value || null);
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req) {
  try {
    const session = await requirePermission(req, "settings", "update");
    const body = await parseBody(req);
    const hotelName = clean(body.hotel_name);
    const latitude = coordinate(body.latitude, -90, 90);
    const longitude = coordinate(body.longitude, -180, 180);
    const googleMapsUrl = clean(body.google_maps_url);

    // ── The address, in whichever of its two shapes arrived ──────────────────
    // Same split as the canonical-location dialog. A picked address is resolved
    // HERE, outside the transaction, because a refused barangay is a 400 carrying
    // field errors rather than a reason to unwind a write; the matching
    // `saveAddress` runs inside it, so the address row and the hotel's location
    // commit together or not at all.
    //
    // The text comes from the server's OWN resolution of the barangay code, never
    // from the string the client sent alongside it.
    const structured = body.structured_address ?? null;
    const resolved = structured ? await resolveStructuredAddress(structured) : null;
    if (resolved && !resolved.ok) {
      return errValidation(resolved.errors ?? { structured_address: resolved.error });
    }
    const address = resolved ? resolved.value.formattedAddress : clean(body.address);

    const errors = {};
    if (!hotelName) errors.hotel_name = "Hotel name is required.";
    // Still required when nothing was picked. Unlike the canonical-location PUT,
    // this is a whole-form save that always sends every field, so a missing
    // address is a missing field rather than an instruction to leave the stored
    // one alone — there is no "omitted" case to honour here. A picked address
    // satisfies the requirement by construction.
    if (!address) errors.address = "Address is required.";
    if (latitude === null) errors.latitude = "Latitude must be between -90 and 90.";
    if (longitude === null) errors.longitude = "Longitude must be between -180 and 180.";
    if (googleMapsUrl) {
      try { new URL(googleMapsUrl); } catch { errors.google_maps_url = "Google Maps URL is invalid."; }
    }
    if (typeof body.physical_move !== "undefined" && typeof body.physical_move !== "boolean") {
      errors.physical_move = "Physical move must be true or false.";
    }
    if (Object.keys(errors).length) return errValidation(errors);

    const previousResult = await query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_location' LIMIT 1`
    );
    const previous = previousResult.rows[0]?.setting_value || null;
    const physicalMove = body.physical_move === true;

    const settings = await withTransaction(async (tx) => {
      let oldLocation = null;
      if (previous?.location_id) {
        oldLocation = (await tx.query(
          `SELECT * FROM locations WHERE location_id = $1 LIMIT 1`,
          [Number(previous.location_id)]
        )).rows[0] || null;
      }
      if (!oldLocation && previous?.hotel_name) {
        oldLocation = (await tx.query(
          `SELECT * FROM locations
            WHERE lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
            ORDER BY location_id LIMIT 1`,
          [previous.hotel_name]
        )).rows[0] || null;
      }

      // Which registry row this base points at — the same three cases the
      // canonical-location PUT uses. A pick replaces the link; an unchanged
      // legacy string keeps it, so a pure rename does not drop a structured
      // address; a CHANGED legacy string clears it, because the registry row
      // holds the geography and coordinates resolved from the text it was saved
      // with, and keeping the pointer would have `getAddress` describe an address
      // that no longer says that.
      //
      // `oldLocation` may be null on a first save, hence the guard.
      const addressId = resolved
        ? await saveAddress(resolved.value, { tx })
        : oldLocation && address === oldLocation.address ? oldLocation.address_id : null;

      let location;
      if (oldLocation && !physicalMove) {
        location = (await tx.query(
          `UPDATE locations
              SET name = $1, address = $2, latitude = $3, longitude = $4, is_active = true, retired_at = NULL,
                  address_id = $5
            WHERE location_id = $6
          RETURNING *`,
          [hotelName, address, latitude, longitude, addressId, oldLocation.location_id]
        )).rows[0];

        // Keep the route text readable while preserving the same FK identity.
        await tx.query(
          `UPDATE routes
              SET origin = CASE WHEN origin_location_id = $1 THEN $2 ELSE origin END,
                  destination = CASE WHEN destination_location_id = $1 THEN $2 ELSE destination END,
                  route_name = replace(route_name, $3, $2),
                  updated_at = NOW()
            WHERE origin_location_id = $1 OR destination_location_id = $1`,
          [oldLocation.location_id, hotelName, oldLocation.name]
        );
      } else {
        location = (await tx.query(
          `INSERT INTO locations (name, address, latitude, longitude, is_active, address_id)
           VALUES ($1,$2,$3,$4,true,$5) RETURNING *`,
          [hotelName, address, latitude, longitude, addressId]
        )).rows[0];
        if (oldLocation && physicalMove) {
          await tx.query(
            `UPDATE locations SET is_active = false, retired_at = COALESCE(retired_at, NOW()) WHERE location_id = $1`,
            [oldLocation.location_id]
          );
          await tx.query(
            `UPDATE routes
                SET status = 'Inactive', updated_at = NOW()
              WHERE status = 'Active'
                AND (origin_location_id = $1 OR destination_location_id = $1)`,
            [oldLocation.location_id]
          );
        }
      }

      const settingValue = {
        hotel_name: hotelName,
        address,
        latitude,
        longitude,
        google_maps_url: googleMapsUrl || "",
        location_id: Number(location.location_id),
        // Recorded alongside `location_id` so the link to the address registry
        // survives a read. It is what the picker loads the saved address FROM:
        // `useStructuredAddress` fetches `/api/locations/[id]` with this id when
        // the cascade opens, so the form reopens on the hotel's current address
        // rather than blank. The detail is not on THIS response and never should
        // be — the location route is where it already lives, with its own
        // permission gate.
        address_id: addressId,
      };
      await tx.query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
         VALUES ('hotel_location', $1, NOW(), $2)
         ON CONFLICT (setting_key)
         DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        [JSON.stringify(settingValue), session.user?.employeeId ?? null]
      );
      return settingValue;
    });

    await writeAudit(req, session, { action: "update", resource: "hotel_location", newValues: settings });
    return ok({ message: physicalMove ? "New hotel location created; previous location retired." : "Hotel base location updated successfully.", settings });
  } catch (e) {
    return handleError(e);
  }
}

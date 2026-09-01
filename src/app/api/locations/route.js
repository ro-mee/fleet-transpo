import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { isValidObject, validateBody } from "@/lib/validation/helpers";
import { writeAudit } from "@/lib/audit";
import { isGoogleMapsUrl, resolveGoogleMapsCoordinates } from "@/lib/google-maps";
import { rolesFor } from "@/lib/auth/permissions";

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
  address: { required: true, maxLength: 2000, label: "Address", validate: (value) => typeof value === "string" ? null : "Address must be text." },
  maps_url: { maxLength: 2000, label: "Google Maps link", validate: (value) => !String(value || "").trim() || isGoogleMapsUrl(String(value).trim()) ? null : "Google Maps link must be a valid Google Maps URL." },
};

export async function GET(req) {
  try {
    const session = await requirePermission(req, "routes", "read");
    const includeInactive = new URL(req.url).searchParams.get("include_inactive") === "true";
    const canSeeInactive = rolesFor("locations", "read_inactive").includes(session.user.role);

    const { rows } = await query(
      `SELECT location_id, name, address, latitude, longitude, created_at
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
    const address = String(body.address).trim();
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

    const normalizedName = name.replace(/\s+/g, " ").toLowerCase();
    const duplicate = await query(
      `SELECT location_id
         FROM locations
        WHERE is_active = true
          AND LOWER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')) = $1
        LIMIT 1`,
      [normalizedName]
    );
    if (duplicate.rows[0]) return err("An active location with this name already exists.", 409);

    const { rows } = await query(
      `INSERT INTO locations (name, address, latitude, longitude, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING location_id, name, address, latitude, longitude, created_at, is_active, retired_at`,
      [name, address, latitude, longitude]
    );
    const location = rows[0];

    await writeAudit(req, session, {
      action: "create",
      resource: "locations",
      resourceId: location?.location_id,
      newValues: location,
    });

    return ok(location, 201);
  } catch (e) {
    return handleError(e);
  }
}

-- Standard Proper Case for vehicle names / manufacturers (057).
--
-- Mirrors src/lib/validation toVehicleTitleCase():
--   - lowercase then capitalise each word;
--   - a hyphen becomes a space ("TEST-VEHICLE" -> "Test Vehicle");
--   - a known vehicle-type acronym stays uppercase (SUV, MPV, AUV, ...);
--   - a token containing a digit is treated as an identifier, left verbatim.
--
-- The `model` column is deliberately NOT title-cased: model codes are
-- identifiers ("SVJ", "CiviC18S") and the standard Title Case would mangle
-- them. Plate numbers are NOT touched either (already ALL CAPS identifiers).
--
-- Idempotent: applying to an already-proper-cased value is a no-op.
CREATE OR REPLACE FUNCTION fleet_to_vehicle_title_case(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT string_agg(
           CASE
             WHEN upper(w) IN ('SUV','MPV','AUV','EV','HEV','PHEV','4WD','AWD','2WD') THEN upper(w)
             WHEN w ~ '[0-9]' THEN w
             ELSE upper(substr(w,1,1)) || lower(substr(w,2))
           END,
           ' '
         )
    FROM (
      SELECT w FROM unnest(string_to_array(regexp_replace(regexp_replace(trim(input), E'\\s+', ' ', 'g'), E'-', ' ', 'g'), ' ')) AS t(w)
      WHERE w <> ''
    ) s;
$$;

UPDATE vehicles
   SET vehicle_name = fleet_to_vehicle_title_case(vehicle_name),
       manufacturer = fleet_to_vehicle_title_case(manufacturer),
       updated_at   = NOW()
 WHERE deleted_at IS NULL
   AND (vehicle_name IS DISTINCT FROM fleet_to_vehicle_title_case(vehicle_name)
     OR manufacturer IS DISTINCT FROM fleet_to_vehicle_title_case(manufacturer));

DROP FUNCTION fleet_to_vehicle_title_case(text);

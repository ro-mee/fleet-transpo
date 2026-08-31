-- Persist the canonical location identity in the existing hotel setting.
-- The match is intentionally unambiguous and active-only; no new location is
-- created by this backfill.
UPDATE system_settings s
SET setting_value = jsonb_set(s.setting_value, '{location_id}', to_jsonb(l.location_id), true),
    updated_at = NOW()
FROM locations l
WHERE s.setting_key = 'hotel_location'
  AND jsonb_typeof(s.setting_value) = 'object'
  AND (s.setting_value ->> 'location_id') IS NULL
  AND l.is_active = true
  AND lower(regexp_replace(trim(l.name), E'\\s+', ' ', 'g')) =
      lower(regexp_replace(trim(s.setting_value ->> 'hotel_name'), E'\\s+', ' ', 'g'));

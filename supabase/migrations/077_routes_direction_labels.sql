-- Make legacy route labels explicitly directional. This is intentionally a
-- simple replacement so it is safe for existing Unicode route names.
UPDATE routes
SET route_name = replace(route_name, '↔', '→'),
    updated_at = NOW()
WHERE route_name LIKE '%↔%';

UPDATE routes
SET estimate_updated_at = COALESCE(estimate_updated_at, updated_at, created_at)
WHERE estimate_source = 'Legacy / Unknown'
  AND (estimated_distance IS NOT NULL OR estimated_duration IS NOT NULL);

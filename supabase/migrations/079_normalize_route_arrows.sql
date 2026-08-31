-- Keep legacy directional labels consistent with the canonical route notation.
UPDATE routes
SET route_name = replace(route_name, ' -> ', ' → '),
    updated_at = NOW()
WHERE route_name LIKE '% -> %';

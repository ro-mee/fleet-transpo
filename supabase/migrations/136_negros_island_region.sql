-- The PSA's 2Q 2026 PSGC publication includes the re-established Negros Island
-- Region under code 1800000000. Keep the display name curated here; the full
-- quarterly hierarchy is loaded by scripts/psgc-publication-import.mjs and
-- scripts/import-psgc.mjs.
-- Source: Philippine Statistics Authority, Philippine Standard Geographic Code,
-- publication date 30 June 2026. Acknowledgement of PSA is required.

INSERT INTO public.ph_regions (psgc_code, name, short_name)
VALUES ('1800000000', 'Negros Island Region (NIR)', 'NIR')
ON CONFLICT (psgc_code) DO NOTHING;

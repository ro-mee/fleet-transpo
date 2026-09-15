-- 112: backfill null LTO registration expiries from the plate window.
--
-- The LTO renewal window is deterministic per plate (last numeric digit →
-- month Jan(1)..Oct(0), second-to-last digit → week 1-7 / 8-14 / 15-21 /
-- 22-month-end), mirroring src/lib/lto-renewal.js resolveRenewalExpiry().
-- Attaching an OR/CR scan alone never wrote vehicles.registration_expiry
-- (only the Renew dialog does), so rows created via scan-only flows stayed
-- NULL and dispatch conflict checks reported "could not be verified".
--
-- Idempotent: only touches rows that are still NULL, and only when the plate
-- yields a valid window. Safe no-op on DBs that already backfilled. Also
-- carries the resolved date into OR_CR document rows whose expiry_date is
-- still NULL, so the two layers agree going forward.

-- Step 1: resolve the window-end date per vehicle into a temp table.
-- week2 = second-to-last digit, defaulting to '1' for single-digit plates
-- (same default as the JS calculator).
CREATE TEMP TABLE tmp_112_registration_backfill AS
SELECT vehicle_id, resolved AS expiry FROM (
  SELECT
    vehicle_id,
    CASE
      WHEN week2 IN ('1','2','3') THEN make_date(yr, mo, 7)
      WHEN week2 IN ('4','5','6') THEN make_date(yr, mo, 14)
      WHEN week2 IN ('7','8') THEN make_date(yr, mo, 21)
      ELSE (date_trunc('month', make_date(yr, mo, 1)) + interval '1 month' - interval '1 day')::date
    END AS resolved
  FROM (
    SELECT
      vehicle_id,
      mo,
      CASE WHEN week_end_this_year >= CURRENT_DATE THEN yr_this ELSE yr_this + 1 END AS yr,
      week2
    FROM (
      SELECT
        v.vehicle_id,
        CASE right(digits, 1)
          WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4
          WHEN '5' THEN 5 WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8
          WHEN '9' THEN 9 WHEN '0' THEN 10
        END AS mo,
        CASE WHEN char_length(digits) < 2 THEN '1'
             ELSE substring(digits from char_length(digits) - 1 for 1) END AS week2,
        EXTRACT(YEAR FROM CURRENT_DATE)::int AS yr_this,
        CASE
          WHEN CASE WHEN char_length(digits) < 2 THEN '1'
                    ELSE substring(digits from char_length(digits) - 1 for 1) END IN ('1','2','3')
            THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,
                   CASE right(digits, 1)
                     WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4
                     WHEN '5' THEN 5 WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8
                     WHEN '9' THEN 9 WHEN '0' THEN 10 END, 7)
          WHEN CASE WHEN char_length(digits) < 2 THEN '1'
                    ELSE substring(digits from char_length(digits) - 1 for 1) END IN ('4','5','6')
            THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,
                   CASE right(digits, 1)
                     WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4
                     WHEN '5' THEN 5 WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8
                     WHEN '9' THEN 9 WHEN '0' THEN 10 END, 14)
          WHEN CASE WHEN char_length(digits) < 2 THEN '1'
                    ELSE substring(digits from char_length(digits) - 1 for 1) END IN ('7','8')
            THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,
                   CASE right(digits, 1)
                     WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4
                     WHEN '5' THEN 5 WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8
                     WHEN '9' THEN 9 WHEN '0' THEN 10 END, 21)
          ELSE (date_trunc('month', make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,
                   CASE right(digits, 1)
                     WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4
                     WHEN '5' THEN 5 WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8
                     WHEN '9' THEN 9 WHEN '0' THEN 10 END, 1))
                + interval '1 month' - interval '1 day')::date
        END AS week_end_this_year
      FROM (
        SELECT
          v.vehicle_id,
          regexp_replace(v.plate_number, '\D', '', 'g') AS digits
        FROM vehicles v
        WHERE v.deleted_at IS NULL
          AND v.registration_expiry IS NULL
          AND regexp_replace(v.plate_number, '\D', '', 'g') <> ''
      ) v
    ) dated
    WHERE mo IS NOT NULL
  ) resolved
) final
WHERE resolved IS NOT NULL;

-- Step 2: apply to vehicles that are still NULL.
UPDATE vehicles v
SET registration_expiry = t.expiry
FROM tmp_112_registration_backfill t
WHERE v.vehicle_id = t.vehicle_id
  AND v.deleted_at IS NULL
  AND v.registration_expiry IS NULL;

-- Step 3: carry the resolved date into OR_CR scans that lack one.
UPDATE vehicledocuments d
SET expiry_date = v.registration_expiry,
    updated_at = NOW()
FROM vehicles v
WHERE d.vehicle_id = v.vehicle_id
  AND d.deleted_at IS NULL
  AND d.document_type = 'OR_CR'
  AND d.expiry_date IS NULL
  AND v.deleted_at IS NULL
  AND v.registration_expiry IS NOT NULL;

DROP TABLE IF EXISTS tmp_112_registration_backfill;

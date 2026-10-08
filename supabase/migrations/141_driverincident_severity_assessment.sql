ALTER TABLE driverincidents
  ADD COLUMN IF NOT EXISTS severity_assessment jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_driverincidents_severity_assessment'
       AND conrelid = 'driverincidents'::regclass
  ) THEN
    ALTER TABLE driverincidents
      ADD CONSTRAINT chk_driverincidents_severity_assessment
      CHECK (
        severity_assessment IS NULL OR (
          jsonb_typeof(severity_assessment) = 'object'
          AND severity_assessment->>'version' = '1'
          AND severity_assessment->>'finalSeverity' = severity
          AND severity_assessment->>'recommendedSeverity' IN ('Minor', 'Moderate', 'Major', 'Critical')
          AND severity_assessment->>'finalSeverity' IN ('Minor', 'Moderate', 'Major', 'Critical')
          AND severity_assessment->>'source' IN ('guided', 'override', 'sos')
          AND severity_assessment->>'reasonCode' IS NOT NULL
          AND severity_assessment->>'criticalConfirmed' IN ('true', 'false')
          AND severity_assessment->>'lowerSeverityConfirmed' IN ('true', 'false')
          AND ((severity_assessment->>'finalSeverity' = 'Critical') = (severity_assessment->>'criticalConfirmed' = 'true'))
          AND (
            (severity_assessment->>'recommendedSeverity' = 'Critical'
              AND severity_assessment->>'finalSeverity' <> 'Critical')
            = (severity_assessment->>'lowerSeverityConfirmed' = 'true')
          )
          AND CASE severity_assessment->>'source'
            WHEN 'sos' THEN
              severity_assessment->'answers' = 'null'::jsonb
              AND severity_assessment->>'recommendedSeverity' = 'Critical'
              AND severity_assessment->>'finalSeverity' = 'Critical'
              AND severity_assessment->>'reasonCode' = 'direct_sos'
              AND severity_assessment->'overrideReasonCode' = 'null'::jsonb
            WHEN 'guided' THEN
              jsonb_typeof(severity_assessment->'answers') = 'object'
              AND severity_assessment->'answers' ?& ARRAY['immediateDanger', 'vehicleSafety', 'tripImpact', 'hazardToOthers']
              AND (severity_assessment->'answers') - ARRAY['immediateDanger', 'vehicleSafety', 'tripImpact', 'hazardToOthers']::text[] = '{}'::jsonb
              AND severity_assessment->'answers'->>'immediateDanger' IN ('yes', 'no', 'unsure')
              AND severity_assessment->'answers'->>'vehicleSafety' IN ('safe', 'unsafe', 'unsure', 'not_applicable')
              AND severity_assessment->'answers'->>'tripImpact' IN ('none', 'delayed', 'stopped')
              AND severity_assessment->'answers'->>'hazardToOthers' IN ('yes', 'no', 'unsure', 'not_applicable')
              AND severity_assessment->>'finalSeverity' = severity_assessment->>'recommendedSeverity'
              AND severity_assessment->'overrideReasonCode' = 'null'::jsonb
            WHEN 'override' THEN
              jsonb_typeof(severity_assessment->'answers') = 'object'
              AND severity_assessment->'answers' ?& ARRAY['immediateDanger', 'vehicleSafety', 'tripImpact', 'hazardToOthers']
              AND (severity_assessment->'answers') - ARRAY['immediateDanger', 'vehicleSafety', 'tripImpact', 'hazardToOthers']::text[] = '{}'::jsonb
              AND severity_assessment->'answers'->>'immediateDanger' IN ('yes', 'no', 'unsure')
              AND severity_assessment->'answers'->>'vehicleSafety' IN ('safe', 'unsafe', 'unsure', 'not_applicable')
              AND severity_assessment->'answers'->>'tripImpact' IN ('none', 'delayed', 'stopped')
              AND severity_assessment->'answers'->>'hazardToOthers' IN ('yes', 'no', 'unsure', 'not_applicable')
              AND severity_assessment->>'finalSeverity' <> severity_assessment->>'recommendedSeverity'
              AND severity_assessment->>'overrideReasonCode' IN ('situation_changed', 'answers_missed_context', 'driver_judgment')
          END
        )
      );
  END IF;
END $$;

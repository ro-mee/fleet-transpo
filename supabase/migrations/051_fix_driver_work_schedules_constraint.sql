-- Fix mutually exclusive constraints for rest days
-- The previous constraint required shift_end > shift_start for ALL rows.
-- But rest days require shift_start = '00:00:00' and shift_end = '00:00:00',
-- which violates the previous rule.

ALTER TABLE driver_work_schedules 
  DROP CONSTRAINT IF EXISTS chk_sched_shift;

ALTER TABLE driver_work_schedules 
  ADD CONSTRAINT chk_sched_shift 
  CHECK (is_rest_day OR shift_end > shift_start);

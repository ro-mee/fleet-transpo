-- ============================================
-- MIGRATION 107: notification key reservation_approved → transport_assigned
--
-- The fleet request lifecycle has no Approved state
-- (Pending → Scheduled → Assigned → In Progress → Completed; see
-- src/lib/scheduling/reservation-state.js). Loop-closure moved to first
-- arrival at Assigned ("Transport Assigned"), so the stale preference key
-- is renamed to match. Naturally idempotent: re-running is a no-op once
-- no reservation_approved rows remain.
-- ============================================

UPDATE notification_preferences
   SET event_key = 'transport_assigned',
       updated_at = NOW()
 WHERE event_key = 'reservation_approved';

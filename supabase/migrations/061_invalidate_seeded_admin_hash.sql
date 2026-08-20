-- Security hardening: the admin@fleetops.com account seeded by migration 008
-- carried a publicly-known bcrypt hash ("admin123"). That value is dead and
-- must never authenticate anywhere, on any database.
--
-- This migration blanks the known hash wherever it still matches. It is a
-- safety net — the account itself is kept and rotated to a fresh strong hash
-- via a direct credential update (an ops action, not a schema change), so this
-- statement matches nothing on the live DB after that rotation and no-ops on
-- fresh databases (which have no seeded data at all).
UPDATE employees
   SET password_hash = NULL,
       updated_at = NOW()
 WHERE email = 'admin@fleetops.com'
   AND password_hash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
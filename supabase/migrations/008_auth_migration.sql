-- Add password_hash column for Auth.js integration
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Seed a system_admin test user with password "admin123"
-- bcrypt hash for "admin123" with 10 rounds
UPDATE employees SET password_hash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
WHERE email = 'admin@fleetops.com' AND password_hash IS NULL;

-- For new registrations, password_hash will be set via bcrypt on the application side
-- Existing users will be prompted to reset their password via the forgot-password flow

-- Add photo_urls to driverincidents
ALTER TABLE driverincidents
ADD COLUMN IF NOT EXISTS photo_urls text[] DEFAULT '{}';

-- Create the incident-evidence storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('incident-evidence', 'incident-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- Like fuel receipts, the backend uses the service_role key to upload and fetch signed URLs,
-- bypassing RLS. This keeps the bucket secure.

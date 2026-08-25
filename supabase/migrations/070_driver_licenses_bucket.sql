-- Create a secure storage bucket for driver licenses.
-- These are sensitive documents, so the bucket is private. Only authenticated staff
-- or the driver themselves should be able to read them (handled via signed URLs).
INSERT INTO storage.buckets (id, name, public) 
VALUES ('driver-licenses', 'driver-licenses', false)
ON CONFLICT (id) DO NOTHING;

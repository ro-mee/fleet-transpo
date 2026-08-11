-- Create the fuel-receipts storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('fuel-receipts', 'fuel-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies are not strictly necessary if the server uploads and generates signed URLs using the service_role key,
-- but creating a policy allows authenticated drivers to view/upload if we decide to handle it client-side.
-- For now, the backend service_role bypasses RLS, so this bucket is fully private and secure.

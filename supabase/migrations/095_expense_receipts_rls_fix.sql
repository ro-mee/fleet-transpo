-- Drop the overly permissive SELECT policy on expense-receipts
DROP POLICY IF EXISTS "Authenticated users can read their expense receipts" ON storage.objects;

-- We rely exclusively on the backend (using Service Role) for fetching signed URLs.

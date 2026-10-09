-- Private, owner-scoped document drafts. Record attachment is committed in the
-- same transaction as the driver/vehicle save. No existing media is migrated.
CREATE TABLE IF NOT EXISTS public.document_uploads (
  upload_id uuid PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES public.employees(employee_id),
  resource text NOT NULL CHECK (resource IN ('drivers', 'vehicles')),
  kind text NOT NULL CHECK (kind IN ('license_front', 'license_back', 'OR_CR', 'Insurance')),
  target_id integer,
  attached_record_id integer,
  bucket text NOT NULL CHECK (bucket IN ('driver-licenses', 'vehicle-documents')),
  object_key text NOT NULL UNIQUE,
  file_name varchar(255) NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 text NOT NULL,
  state text NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'ready', 'attached', 'cancelled', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  attached_at timestamptz,
  CHECK ((resource = 'drivers' AND kind IN ('license_front', 'license_back') AND bucket = 'driver-licenses')
      OR (resource = 'vehicles' AND kind IN ('OR_CR', 'Insurance') AND bucket = 'vehicle-documents'))
);
CREATE INDEX IF NOT EXISTS document_uploads_expiry_idx ON public.document_uploads (expires_at)
  WHERE state IN ('uploading', 'ready', 'cancelled');
CREATE INDEX IF NOT EXISTS document_uploads_record_idx ON public.document_uploads (resource, attached_record_id)
  WHERE state = 'attached';
ALTER TABLE public.document_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.document_uploads FROM anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vehicle-documents', 'vehicle-documents', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

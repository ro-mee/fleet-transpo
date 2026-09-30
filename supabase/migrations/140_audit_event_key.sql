-- A client-generated key is used only to deduplicate masked-license view
-- replays. Other audit events leave it NULL and are never client-deduplicated.
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS event_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_event_key
  ON public.audit_logs (event_key)
  WHERE event_key IS NOT NULL;

BEGIN;

-- Enable RLS on all tables that have it disabled
ALTER TABLE public.aiproviders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ailogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicleinspection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuelrequests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuelallocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_mfa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_card_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_receipt_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driverincidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_comments ENABLE ROW LEVEL SECURITY;

-- Note: We intentionally do NOT create explicit policies.
-- By default, when RLS is enabled but no policies are defined, PostgreSQL
-- applies a "Deny All" policy to roles that are subject to RLS (like the 
-- PostgREST anon and authenticated roles).
-- 
-- The Next.js API server connects as 'postgres' (a superuser/bypassrls role) 
-- via DATABASE_URL, which naturally bypasses RLS completely. 
-- Thus, the server APIs will continue to function exactly as before, 
-- but direct untrusted PostgREST queries will be denied.

COMMIT;

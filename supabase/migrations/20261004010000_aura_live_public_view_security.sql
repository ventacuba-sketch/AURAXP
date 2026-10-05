-- Keep the public Aura Check projection subject to the querying role's RLS.
-- Postgres 17 supports security_invoker views.
alter view public.live_aura_checks_public set (security_invoker = true);

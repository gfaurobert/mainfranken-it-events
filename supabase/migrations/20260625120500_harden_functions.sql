-- Hardening nach Security-Advisor
-- 1) set_updated_at: search_path fixiert (siehe init_schema; hier idempotent erneut gesetzt)
alter function public.set_updated_at() set search_path = '';

-- 2) rls_auto_enable() ist ein vorhandener Event-Trigger (auto-enable RLS auf neue public-Tables,
--    owner postgres, vermutlich aus Supabase-Security-Template). EXECUTE fuer PUBLIC entziehen,
--    damit anon/authenticated die SECURITY-DEFINER-Funktion nicht via RPC aufrufen koennen.
--    Kein Funktionsverlust: Event-Trigger feuern unabhaengig von EXECUTE-Grants.
revoke execute on function public.rls_auto_enable() from public;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Revoking
-- only from anon is insufficient because anon remains a member of PUBLIC and
-- therefore retains effective access. Keep these client RPCs callable by the
-- authenticated application and service role, but reject unsigned callers at
-- the function privilege boundary.

revoke all on function public.persist_transition(
    jsonb, jsonb, jsonb, jsonb, boolean, timestamptz
) from public, anon;
grant execute on function public.persist_transition(
    jsonb, jsonb, jsonb, jsonb, boolean, timestamptz
) to authenticated, service_role;

revoke all on function public.complete_timer(
    jsonb, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.complete_timer(
    jsonb, jsonb, jsonb, jsonb
) to authenticated, service_role;

revoke all on function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz,
    jsonb, timestamptz, boolean,
    jsonb, timestamptz, boolean
) from public, anon;
grant execute on function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz,
    jsonb, timestamptz, boolean,
    jsonb, timestamptz, boolean
) to authenticated, service_role;

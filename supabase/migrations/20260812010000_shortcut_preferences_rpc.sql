-- Update non-secret Shortcut preferences without requiring the browser to
-- retain or re-submit the stored API token.
create function public.update_shortcut_preferences(
    p_team_name text,
    p_excluded_statuses text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner uuid := auth.uid();
    v_updated integer;
begin
    if v_owner is null then
        raise exception 'AUTH_OWNER_REQUIRED';
    end if;

    update public.shortcut_settings
    set team_name = p_team_name,
        excluded_statuses = p_excluded_statuses
    where owner_id = v_owner;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'SHORTCUT_NOT_CONFIGURED';
    end if;
end;
$$;

revoke all on function public.update_shortcut_preferences(text, text[]) from public, anon;
grant execute on function public.update_shortcut_preferences(text, text[]) to authenticated, service_role;

comment on function public.update_shortcut_preferences(text, text[]) is
    'Updates owner-derived non-secret Shortcut preferences without reading or replacing the API token';

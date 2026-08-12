-- Persist the WorkTime project used by default for imported Shortcut stories.
-- Project data lives in pm_state_v1 rather than a relational projects table,
-- so this is intentionally an owner-scoped nullable identifier without an FK.

alter table public.shortcut_settings
    add column default_project_id text;

grant select (default_project_id) on table public.shortcut_settings to authenticated;
grant insert (default_project_id) on table public.shortcut_settings to authenticated;
grant update (default_project_id) on table public.shortcut_settings to authenticated;

drop function public.save_shortcut_settings(text, text, text[]);

create function public.save_shortcut_settings(
    p_shortcut_token text,
    p_team_name text,
    p_included_statuses text[] default array[
        'In Discovery',
        'Ready for Dev',
        'In Dev'
    ]::text[],
    p_default_project_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner uuid := auth.uid();
begin
    if v_owner is null then
        raise exception 'AUTH_OWNER_REQUIRED';
    end if;

    insert into public.shortcut_settings (
        owner_id,
        shortcut_token,
        team_name,
        included_statuses,
        default_project_id
    ) values (
        v_owner,
        p_shortcut_token,
        p_team_name,
        p_included_statuses,
        nullif(btrim(p_default_project_id), '')
    )
    on conflict (owner_id) do update set
        shortcut_token = excluded.shortcut_token,
        team_name = excluded.team_name,
        included_statuses = excluded.included_statuses,
        default_project_id = excluded.default_project_id;
end;
$$;

revoke all on function public.save_shortcut_settings(text, text, text[], text) from public, anon;
grant execute on function public.save_shortcut_settings(text, text, text[], text) to authenticated, service_role;

comment on function public.save_shortcut_settings(text, text, text[], text) is
    'Owner-derived Shortcut settings upsert that never returns the stored API token';

drop function public.update_shortcut_preferences(text, text[]);

create function public.update_shortcut_preferences(
    p_team_name text,
    p_included_statuses text[],
    p_default_project_id text default null
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
        included_statuses = p_included_statuses,
        default_project_id = nullif(btrim(p_default_project_id), '')
    where owner_id = v_owner;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'SHORTCUT_NOT_CONFIGURED';
    end if;
end;
$$;

revoke all on function public.update_shortcut_preferences(text, text[], text) from public, anon;
grant execute on function public.update_shortcut_preferences(text, text[], text) to authenticated, service_role;

comment on function public.update_shortcut_preferences(text, text[], text) is
    'Updates owner-derived non-secret Shortcut preferences without reading or replacing the API token';

comment on column public.shortcut_settings.default_project_id is
    'Nullable WorkTime PM project identifier applied to Shortcut task proposals by default';

-- Replace the legacy exclusion list with a positive Shortcut status allowlist.
-- Existing exclusion values cannot be inverted reliably, so existing owners
-- receive the new documented defaults during this one-time migration.

alter table public.shortcut_settings
    rename column excluded_statuses to included_statuses;

alter table public.shortcut_settings
    alter column included_statuses set default array[
        'In Discovery',
        'Ready for Dev',
        'In Dev'
    ]::text[];

update public.shortcut_settings
set included_statuses = array[
    'In Discovery',
    'Ready for Dev',
    'In Dev'
]::text[];

drop function public.save_shortcut_settings(text, text, text[]);

create function public.save_shortcut_settings(
    p_shortcut_token text,
    p_team_name text,
    p_included_statuses text[] default array[
        'In Discovery',
        'Ready for Dev',
        'In Dev'
    ]::text[]
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
        included_statuses
    ) values (
        v_owner,
        p_shortcut_token,
        p_team_name,
        p_included_statuses
    )
    on conflict (owner_id) do update set
        shortcut_token = excluded.shortcut_token,
        team_name = excluded.team_name,
        included_statuses = excluded.included_statuses;
end;
$$;

revoke all on function public.save_shortcut_settings(text, text, text[]) from public, anon;
grant execute on function public.save_shortcut_settings(text, text, text[]) to authenticated, service_role;

comment on function public.save_shortcut_settings(text, text, text[]) is
    'Owner-derived Shortcut settings upsert that never returns the stored API token';

drop function public.update_shortcut_preferences(text, text[]);

create function public.update_shortcut_preferences(
    p_team_name text,
    p_included_statuses text[]
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
        included_statuses = p_included_statuses
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

-- Owner-scoped Linear credentials. Browser callers can write, but never read,
-- the token; sync timestamps remain server-authored.
create table public.linear_settings (
    owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    linear_token text not null check (length(btrim(linear_token)) > 0),
    team_key text check (team_key is null or length(btrim(team_key)) > 0),
    included_statuses text[] not null default '{}'::text[],
    default_project_id text,
    last_synced_at timestamptz,
    updated_at timestamptz not null default now()
);

revoke all on table public.linear_settings from public, anon, authenticated;
grant all on table public.linear_settings to service_role;
grant select (owner_id, team_key, included_statuses, default_project_id, last_synced_at, updated_at)
    on table public.linear_settings to authenticated;
grant insert (owner_id, linear_token, team_key, included_statuses, default_project_id)
    on table public.linear_settings to authenticated;
grant update (owner_id, linear_token, team_key, included_statuses, default_project_id)
    on table public.linear_settings to authenticated;
grant delete on table public.linear_settings to authenticated;

alter table public.linear_settings enable row level security;
create policy linear_settings_owner_select on public.linear_settings
    for select to authenticated using (owner_id = (select auth.uid()));
create policy linear_settings_owner_insert on public.linear_settings
    for insert to authenticated with check (owner_id = (select auth.uid()));
create policy linear_settings_owner_update on public.linear_settings
    for update to authenticated
    using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy linear_settings_owner_delete on public.linear_settings
    for delete to authenticated using (owner_id = (select auth.uid()));

create trigger linear_settings_touch_updated_at
    before update on public.linear_settings
    for each row execute function public.touch_updated_at();

-- ON CONFLICT requires privileges that must never be granted to the browser.
create function private.save_linear_settings(
    p_linear_token text,
    p_team_key text default null,
    p_included_statuses text[] default '{}'::text[],
    p_default_project_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_owner uuid := auth.uid();
begin
    if v_owner is null then
        raise exception 'AUTH_OWNER_REQUIRED';
    end if;
    if p_linear_token is null or length(btrim(p_linear_token)) = 0 then
        raise exception 'LINEAR_TOKEN_INVALID: Enter a Linear personal API key';
    end if;
    if btrim(p_linear_token) ~* '^Bearer[[:space:]]' then
        raise exception 'LINEAR_TOKEN_INVALID: Paste the personal API key without the Bearer prefix';
    end if;

    insert into public.linear_settings (
        owner_id, linear_token, team_key, included_statuses, default_project_id
    ) values (
        v_owner, btrim(p_linear_token), nullif(btrim(p_team_key), ''),
        p_included_statuses, nullif(btrim(p_default_project_id), '')
    )
    on conflict (owner_id) do update set
        linear_token = excluded.linear_token,
        team_key = excluded.team_key,
        included_statuses = excluded.included_statuses,
        default_project_id = excluded.default_project_id;
end;
$$;

revoke all on function private.save_linear_settings(text, text, text[], text) from public, anon;
grant execute on function private.save_linear_settings(text, text, text[], text) to authenticated, service_role;

create function public.save_linear_settings(
    p_linear_token text,
    p_team_key text default null,
    p_included_statuses text[] default '{}'::text[],
    p_default_project_id text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
    select private.save_linear_settings(p_linear_token, p_team_key, p_included_statuses, p_default_project_id)
$$;

revoke all on function public.save_linear_settings(text, text, text[], text) from public, anon;
grant execute on function public.save_linear_settings(text, text, text[], text) to authenticated, service_role;

create function public.update_linear_preferences(
    p_team_key text,
    p_included_statuses text[],
    p_default_project_id text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_owner uuid := auth.uid();
    v_updated integer;
begin
    if v_owner is null then
        raise exception 'AUTH_OWNER_REQUIRED';
    end if;

    update public.linear_settings
    set team_key = nullif(btrim(p_team_key), ''),
        included_statuses = p_included_statuses,
        default_project_id = nullif(btrim(p_default_project_id), '')
    where owner_id = v_owner;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'LINEAR_NOT_CONFIGURED';
    end if;
end;
$$;

revoke all on function public.update_linear_preferences(text, text[], text) from public, anon;
grant execute on function public.update_linear_preferences(text, text[], text) to authenticated, service_role;

comment on table public.linear_settings is
    'Per-owner Linear connection; linear_token is not selectable by browser clients';
comment on column public.linear_settings.linear_token is
    'Plaintext personal API key protected by column privileges and owner RLS';
comment on column public.linear_settings.team_key is
    'Nullable team key; linear-sync compares case-insensitively, null means all accessible teams';
comment on column public.linear_settings.default_project_id is
    'Nullable WorkTime PM project identifier without a foreign key because projects live in pm_state_v1';
comment on column public.linear_settings.last_synced_at is
    'Written by linear-sync only after a successful upstream fetch';
comment on function public.save_linear_settings(text, text, text[], text) is
    'Invoker-only boundary for the private owner-derived Linear credential upsert; returns no token';
comment on function public.update_linear_preferences(text, text[], text) is
    'Owner-derived non-secret preference update that never reads or replaces the token';

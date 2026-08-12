-- Owner-scoped Shortcut credentials and sync preferences.
--
-- The API token is intentionally stored as plaintext protected by RLS and
-- column-level privileges. Authenticated clients may write the token but may
-- not select it back through the Data API; only the service role used by the
-- shortcut-sync Edge Function can read it.

create table public.shortcut_settings (
    owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    shortcut_token text not null check (length(btrim(shortcut_token)) > 0),
    team_name text not null check (length(btrim(team_name)) > 0),
    excluded_statuses text[] not null default array[
        'Defining Requirements',
        'Ready for Review',
        'Done'
    ]::text[],
    last_synced_at timestamptz,
    updated_at timestamptz not null default now()
);

revoke all on table public.shortcut_settings from anon, authenticated;
grant all on table public.shortcut_settings to service_role;

-- Browser callers can manage their own configuration without ever receiving
-- the stored credential. last_synced_at is server-authored after a successful
-- Shortcut fetch and is therefore read-only to authenticated clients.
grant select (owner_id, team_name, excluded_statuses, last_synced_at, updated_at)
    on table public.shortcut_settings to authenticated;
grant insert (owner_id, shortcut_token, team_name, excluded_statuses)
    on table public.shortcut_settings to authenticated;
grant update (owner_id, shortcut_token, team_name, excluded_statuses)
    on table public.shortcut_settings to authenticated;
grant delete on table public.shortcut_settings to authenticated;

alter table public.shortcut_settings enable row level security;

create policy shortcut_settings_owner_select on public.shortcut_settings
    for select to authenticated using (owner_id = auth.uid());
create policy shortcut_settings_owner_insert on public.shortcut_settings
    for insert to authenticated with check (owner_id = auth.uid());
create policy shortcut_settings_owner_update on public.shortcut_settings
    for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy shortcut_settings_owner_delete on public.shortcut_settings
    for delete to authenticated using (owner_id = auth.uid());

create trigger shortcut_settings_touch_updated_at
    before update on public.shortcut_settings
    for each row execute function public.touch_updated_at();

comment on table public.shortcut_settings is
    'Per-owner Shortcut credential and sync configuration; API tokens are not selectable by authenticated clients';
comment on column public.shortcut_settings.shortcut_token is
    'Plaintext Shortcut API token readable only by the service role and database administrators';
comment on column public.shortcut_settings.last_synced_at is
    'Timestamp written by shortcut-sync only after a successful Shortcut fetch';

-- PostgREST upserts require table-level SELECT, which would also make the
-- secret column selectable. This narrow RPC provides the intended singleton
-- upsert without granting that broader privilege or accepting an owner id.
create function public.save_shortcut_settings(
    p_shortcut_token text,
    p_team_name text,
    p_excluded_statuses text[] default array[
        'Defining Requirements',
        'Ready for Review',
        'Done'
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
        excluded_statuses
    ) values (
        v_owner,
        p_shortcut_token,
        p_team_name,
        p_excluded_statuses
    )
    on conflict (owner_id) do update set
        shortcut_token = excluded.shortcut_token,
        team_name = excluded.team_name,
        excluded_statuses = excluded.excluded_statuses;
end;
$$;

revoke all on function public.save_shortcut_settings(text, text, text[]) from public, anon;
grant execute on function public.save_shortcut_settings(text, text, text[]) to authenticated, service_role;

comment on function public.save_shortcut_settings(text, text, text[]) is
    'Owner-derived Shortcut settings upsert that never returns the stored API token';

-- Owner-scoped Google Calendar OAuth settings and server-authored task links.
-- Refresh tokens and PKCE verifier state are never selectable by browser clients.

create table public.google_calendar_settings (
    owner_id uuid primary key references auth.users(id) on delete cascade,
    refresh_token text not null check (length(btrim(refresh_token)) > 0),
    scope_level text not null check (scope_level in ('readonly', 'schedule')),
    selected_calendar_ids text[] not null default '{}'::text[]
        check (cardinality(selected_calendar_ids) <= 50),
    worktime_calendar_id text,
    connected_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

revoke all on table public.google_calendar_settings from anon, authenticated;
grant all on table public.google_calendar_settings to service_role;
grant select (
    owner_id, scope_level, selected_calendar_ids, worktime_calendar_id,
    connected_at, updated_at
) on table public.google_calendar_settings to authenticated;
grant update (selected_calendar_ids)
    on table public.google_calendar_settings to authenticated;

alter table public.google_calendar_settings enable row level security;
create policy google_calendar_settings_owner_select on public.google_calendar_settings
    for select to authenticated using (owner_id = (select auth.uid()));
create policy google_calendar_settings_owner_update on public.google_calendar_settings
    for update to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));

create trigger google_calendar_settings_touch_updated_at
    before update on public.google_calendar_settings
    for each row execute function public.touch_updated_at();

comment on table public.google_calendar_settings is
    'Per-owner Google Calendar connection; refresh_token is service-role-only';
comment on column public.google_calendar_settings.refresh_token is
    'Plaintext Google OAuth refresh token protected by column privileges and RLS';

create table public.google_calendar_oauth_states (
    state_hash text primary key check (length(state_hash) = 64),
    owner_id uuid not null references auth.users(id) on delete cascade,
    code_verifier text not null check (length(code_verifier) between 43 and 128),
    requested_scope_level text not null check (requested_scope_level in ('readonly', 'schedule')),
    return_to text not null check (length(btrim(return_to)) > 0),
    pending_task_id text,
    pending_scheduled_start timestamptz,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    check ((pending_task_id is null) = (pending_scheduled_start is null)),
    check (pending_task_id is null or length(btrim(pending_task_id)) > 0)
);

revoke all on table public.google_calendar_oauth_states from public, anon, authenticated;
grant all on table public.google_calendar_oauth_states to service_role;
alter table public.google_calendar_oauth_states enable row level security;

comment on table public.google_calendar_oauth_states is
    'Short-lived, one-time Google OAuth state and PKCE verifier rows; service-role-only';

create table public.google_calendar_task_links (
    owner_id uuid not null references auth.users(id) on delete cascade,
    task_id text not null check (length(btrim(task_id)) > 0),
    calendar_id text not null check (length(btrim(calendar_id)) > 0),
    event_id text not null check (length(btrim(event_id)) > 0),
    scheduled_start timestamptz not null,
    scheduled_end timestamptz not null,
    estimate_pomos integer not null check (estimate_pomos > 0),
    work_minutes integer not null check (work_minutes > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, task_id),
    unique (owner_id, calendar_id, event_id),
    check (scheduled_end > scheduled_start)
);

revoke all on table public.google_calendar_task_links from anon, authenticated;
grant all on table public.google_calendar_task_links to service_role;
grant select (
    owner_id, task_id, calendar_id, event_id, scheduled_start, scheduled_end,
    estimate_pomos, work_minutes, created_at, updated_at
) on table public.google_calendar_task_links to authenticated;

alter table public.google_calendar_task_links enable row level security;
create policy google_calendar_task_links_owner_select on public.google_calendar_task_links
    for select to authenticated using (owner_id = (select auth.uid()));

create trigger google_calendar_task_links_touch_updated_at
    before update on public.google_calendar_task_links
    for each row execute function public.touch_updated_at();

comment on table public.google_calendar_task_links is
    'Server-authored task-to-Google-event metadata; event titles are intentionally absent';

-- The OAuth callback is the only refresh-token writer. Keep the definer outside
-- the exposed schema and expose a service-role-only invoker wrapper.
create function private.save_google_calendar_connection(
    p_owner_id uuid,
    p_refresh_token text,
    p_scope_level text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_owner_id is null then
        raise exception 'AUTH_OWNER_REQUIRED';
    end if;
    if p_refresh_token is null or length(btrim(p_refresh_token)) = 0 then
        raise exception 'GOOGLE_REFRESH_TOKEN_REQUIRED';
    end if;
    if p_scope_level not in ('readonly', 'schedule') then
        raise exception 'GOOGLE_SCOPE_LEVEL_INVALID';
    end if;

    insert into public.google_calendar_settings (
        owner_id, refresh_token, scope_level
    ) values (
        p_owner_id, btrim(p_refresh_token), p_scope_level
    )
    on conflict (owner_id) do update set
        refresh_token = excluded.refresh_token,
        scope_level = excluded.scope_level;
end;
$$;

revoke all on function private.save_google_calendar_connection(uuid, text, text)
    from public, anon, authenticated;
grant execute on function private.save_google_calendar_connection(uuid, text, text)
    to service_role;

create function public.save_google_calendar_connection(
    p_owner_id uuid,
    p_refresh_token text,
    p_scope_level text
)
returns void
language sql
security invoker
set search_path = ''
as $$
    select private.save_google_calendar_connection(
        p_owner_id,
        p_refresh_token,
        p_scope_level
    )
$$;

revoke all on function public.save_google_calendar_connection(uuid, text, text)
    from public, anon, authenticated;
grant execute on function public.save_google_calendar_connection(uuid, text, text)
    to service_role;

comment on function public.save_google_calendar_connection(uuid, text, text) is
    'Service-role-only invoker boundary for the private Google refresh-token upsert';

create function public.update_google_calendar_preferences(
    p_selected_calendar_ids text[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_owner uuid := auth.uid();
    v_selected text[];
    v_updated integer;
begin
    if v_owner is null then
        raise exception 'AUTH_OWNER_REQUIRED';
    end if;
    if p_selected_calendar_ids is null
        or cardinality(p_selected_calendar_ids) > 50
        or exists (
            select 1
            from unnest(p_selected_calendar_ids) as value
            where value is null or length(btrim(value)) = 0
        ) then
        raise exception 'GOOGLE_CALENDAR_SELECTION_INVALID';
    end if;

    select coalesce(array_agg(value order by value), '{}'::text[])
    into v_selected
    from (
        select distinct btrim(value) as value
        from unnest(p_selected_calendar_ids) as value
    ) normalized;

    update public.google_calendar_settings
    set selected_calendar_ids = v_selected
    where owner_id = v_owner;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'GOOGLE_CALENDAR_NOT_CONFIGURED';
    end if;
end;
$$;

revoke all on function public.update_google_calendar_preferences(text[])
    from public, anon;
grant execute on function public.update_google_calendar_preferences(text[])
    to authenticated, service_role;

comment on function public.update_google_calendar_preferences(text[]) is
    'Updates owner-derived selected Google calendars without exposing the refresh token';

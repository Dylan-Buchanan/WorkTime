-- Preserve credentials and existing event attribution before retiring the singleton.
create table public.google_calendar_connections (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    google_account_id text check (length(btrim(google_account_id)) > 0),
    google_account_email text,
    primary_calendar_id text,
    refresh_token text not null check (length(btrim(refresh_token)) > 0),
    scope_level text not null check (scope_level in ('readonly', 'schedule')),
    selected_calendar_ids text[] not null default '{}'::text[] check (cardinality(selected_calendar_ids) <= 50),
    worktime_calendar_id text,
    is_scheduling_target boolean not null default false,
    identity_source text not null default 'legacy' check (identity_source in ('legacy', 'calendar_list', 'userinfo')),
    connected_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (owner_id, id),
    unique (owner_id, google_account_id),
    check ((identity_source = 'userinfo') = (google_account_id is not null)),
    check (identity_source <> 'calendar_list' or primary_calendar_id is not null)
);

insert into public.google_calendar_connections (
    owner_id, refresh_token, scope_level, selected_calendar_ids, worktime_calendar_id,
    connected_at, updated_at, is_scheduling_target
)
select owner_id, refresh_token, scope_level, selected_calendar_ids, worktime_calendar_id,
    connected_at, updated_at, true
from public.google_calendar_settings;

create unique index google_calendar_one_scheduling_target
    on public.google_calendar_connections (owner_id) where is_scheduling_target;

alter table public.google_calendar_task_links add column connection_id uuid;
update public.google_calendar_task_links l set connection_id = c.id
from public.google_calendar_connections c where c.owner_id = l.owner_id;
-- Old disconnects could leave links after deleting their credentials. These
-- links have no usable account attribution and cannot be recovered.
delete from public.google_calendar_task_links where connection_id is null;
alter table public.google_calendar_task_links alter column connection_id set not null;
alter table public.google_calendar_task_links add constraint google_calendar_task_links_connection_fk
    foreign key (owner_id, connection_id) references public.google_calendar_connections(owner_id, id) on delete cascade;
grant select (connection_id) on public.google_calendar_task_links to authenticated;
create index google_calendar_task_links_connection on public.google_calendar_task_links (owner_id, connection_id);

alter table public.google_calendar_oauth_states add column connection_id uuid;
-- A consent already in flight belongs to the old singleton, too.
update public.google_calendar_oauth_states s set connection_id = c.id
from public.google_calendar_connections c where c.owner_id = s.owner_id;
alter table public.google_calendar_oauth_states add constraint google_calendar_oauth_states_connection_fk
    foreign key (owner_id, connection_id) references public.google_calendar_connections(owner_id, id) on delete cascade;
create index google_calendar_oauth_states_connection on public.google_calendar_oauth_states (owner_id, connection_id);

revoke all on public.google_calendar_connections from public, anon, authenticated;
grant all on public.google_calendar_connections to service_role;
grant select (id, owner_id, google_account_id, google_account_email, primary_calendar_id,
    scope_level, selected_calendar_ids, worktime_calendar_id, is_scheduling_target,
    identity_source, connected_at, updated_at) on public.google_calendar_connections to authenticated;
grant update (selected_calendar_ids) on public.google_calendar_connections to authenticated;
alter table public.google_calendar_connections enable row level security;
create policy google_calendar_connections_owner_select on public.google_calendar_connections
    for select to authenticated using (owner_id = (select auth.uid()));
create policy google_calendar_connections_owner_update on public.google_calendar_connections
    for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create function public.normalize_google_calendar_selection() returns trigger
language plpgsql set search_path = '' as $$
begin
    if new.selected_calendar_ids is null or cardinality(new.selected_calendar_ids) > 50 or exists (
        select 1 from unnest(new.selected_calendar_ids) value where value is null or length(btrim(value)) = 0
    ) then raise exception 'GOOGLE_CALENDAR_SELECTION_INVALID'; end if;
    select coalesce(array_agg(value order by value), '{}'::text[]) into new.selected_calendar_ids
        from (select distinct btrim(value) value from unnest(new.selected_calendar_ids) value) normalized;
    return new;
end;
$$;
create trigger google_calendar_connections_normalize_selection before insert or update on public.google_calendar_connections
    for each row execute function public.normalize_google_calendar_selection();
create trigger google_calendar_connections_touch_updated_at before update on public.google_calendar_connections
    for each row execute function public.touch_updated_at();

-- PL/pgSQL bodies have no table dependency: explicitly retire both old signatures.
drop function public.save_google_calendar_connection(uuid, text, text);
drop function private.save_google_calendar_connection(uuid, text, text);
drop function public.update_google_calendar_preferences(text[]);

create function private.save_google_calendar_connection(
    p_owner_id uuid, p_connection_id uuid, p_google_account_id text,
    p_google_account_email text, p_primary_calendar_id text, p_refresh_token text, p_scope_level text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
    v_id uuid;
    v_sub text;
begin
    if p_owner_id is null then raise exception 'AUTH_OWNER_REQUIRED'; end if;
    if p_refresh_token is null or length(btrim(p_refresh_token)) = 0 then raise exception 'GOOGLE_REFRESH_TOKEN_REQUIRED'; end if;
    if p_google_account_id is null or length(btrim(p_google_account_id)) = 0 then raise exception 'GOOGLE_ACCOUNT_ID_REQUIRED'; end if;
    if p_scope_level is null or p_scope_level not in ('readonly', 'schedule') then raise exception 'GOOGLE_SCOPE_LEVEL_INVALID'; end if;
    -- Every membership/target writer takes the same owner lock, including when
    -- there are no connection rows yet. Concurrent callbacks cannot exceed five.
    perform 1 from auth.users where id = p_owner_id for update;
    if not found then raise exception 'AUTH_OWNER_REQUIRED'; end if;

    if p_connection_id is not null then
        select id, google_account_id into v_id, v_sub from public.google_calendar_connections
            where owner_id = p_owner_id and id = p_connection_id;
        if not found then raise exception 'GOOGLE_CONNECTION_NOT_FOUND'; end if;
        if v_sub is not null and v_sub <> p_google_account_id then raise exception 'GOOGLE_ACCOUNT_MISMATCH'; end if;
    else
        select id into v_id from public.google_calendar_connections
            where owner_id = p_owner_id and google_account_id = p_google_account_id;
    end if;

    if exists (select 1 from public.google_calendar_connections where owner_id = p_owner_id
        and google_account_id = p_google_account_id and id is distinct from v_id) then
        raise exception 'GOOGLE_ACCOUNT_MISMATCH';
    end if;
    if v_id is null then
        if (select count(*) from public.google_calendar_connections where owner_id = p_owner_id) >= 5 then
            raise exception 'GOOGLE_ACCOUNT_LIMIT_REACHED';
        end if;
        insert into public.google_calendar_connections (
            owner_id, google_account_id, google_account_email, primary_calendar_id,
            refresh_token, scope_level, identity_source, is_scheduling_target
        ) values (
            p_owner_id, p_google_account_id, p_google_account_email, p_primary_calendar_id,
            btrim(p_refresh_token), p_scope_level, 'userinfo',
            not exists (select 1 from public.google_calendar_connections where owner_id = p_owner_id and is_scheduling_target)
        ) returning id into v_id;
    else
        update public.google_calendar_connections set
            google_account_id = p_google_account_id,
            google_account_email = coalesce(p_google_account_email, google_account_email),
            primary_calendar_id = coalesce(p_primary_calendar_id, primary_calendar_id),
            refresh_token = btrim(p_refresh_token), scope_level = p_scope_level, identity_source = 'userinfo'
        where owner_id = p_owner_id and id = v_id;
    end if;
    return v_id;
end;
$$;
create function public.save_google_calendar_connection(
    p_owner_id uuid, p_connection_id uuid, p_google_account_id text,
    p_google_account_email text, p_primary_calendar_id text, p_refresh_token text, p_scope_level text
) returns uuid language sql security invoker set search_path = '' as $$
    select private.save_google_calendar_connection(p_owner_id, p_connection_id, p_google_account_id,
        p_google_account_email, p_primary_calendar_id, p_refresh_token, p_scope_level)
$$;
revoke all on function private.save_google_calendar_connection(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.save_google_calendar_connection(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function private.save_google_calendar_connection(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.save_google_calendar_connection(uuid, uuid, text, text, text, text, text) to service_role;

create function public.update_google_calendar_preferences(p_connection_id uuid, p_selected_calendar_ids text[])
returns void language plpgsql security invoker set search_path = '' as $$
declare
    v_owner uuid := auth.uid();
    v_selected text[];
begin
    if v_owner is null then raise exception 'AUTH_OWNER_REQUIRED'; end if;
    if p_selected_calendar_ids is null or cardinality(p_selected_calendar_ids) > 50 or exists (
        select 1 from unnest(p_selected_calendar_ids) value where value is null or length(btrim(value)) = 0
    ) then raise exception 'GOOGLE_CALENDAR_SELECTION_INVALID'; end if;
    select coalesce(array_agg(value order by value), '{}'::text[]) into v_selected
        from (select distinct btrim(value) value from unnest(p_selected_calendar_ids) value) normalized;
    update public.google_calendar_connections set selected_calendar_ids = v_selected
        where owner_id = v_owner and id = p_connection_id;
    if not found then raise exception 'GOOGLE_CONNECTION_NOT_FOUND'; end if;
end;
$$;
revoke all on function public.update_google_calendar_preferences(uuid, text[]) from public, anon;
grant execute on function public.update_google_calendar_preferences(uuid, text[]) to authenticated, service_role;

create function private.set_google_calendar_scheduling_connection(p_connection_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid();
begin
    if v_owner is null then raise exception 'AUTH_OWNER_REQUIRED'; end if;
    perform 1 from auth.users where id = v_owner for update;
    perform 1 from public.google_calendar_connections where owner_id = v_owner and id = p_connection_id;
    if not found then raise exception 'GOOGLE_CONNECTION_NOT_FOUND'; end if;
    -- Separate statements avoid a transient partial-unique-index violation.
    update public.google_calendar_connections set is_scheduling_target = false where owner_id = v_owner and is_scheduling_target;
    update public.google_calendar_connections set is_scheduling_target = true where owner_id = v_owner and id = p_connection_id;
end;
$$;
create function public.set_google_calendar_scheduling_connection(p_connection_id uuid)
returns void language sql security invoker set search_path = '' as $$
    select private.set_google_calendar_scheduling_connection(p_connection_id)
$$;
revoke all on function private.set_google_calendar_scheduling_connection(uuid) from public, anon;
revoke all on function public.set_google_calendar_scheduling_connection(uuid) from public, anon;
grant execute on function private.set_google_calendar_scheduling_connection(uuid) to authenticated, service_role;
grant execute on function public.set_google_calendar_scheduling_connection(uuid) to authenticated, service_role;

-- Delete and promote in one transaction; cascades remove only attributed links
-- and targeted OAuth states. Disconnect-all also consumes untargeted states.
create function private.delete_google_calendar_connections(p_owner_id uuid, p_connection_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_next uuid;
begin
    if p_owner_id is null then raise exception 'AUTH_OWNER_REQUIRED'; end if;
    perform 1 from auth.users where id = p_owner_id for update;
    if p_connection_id is null then
        delete from public.google_calendar_oauth_states where owner_id = p_owner_id;
        delete from public.google_calendar_connections where owner_id = p_owner_id;
    else
        delete from public.google_calendar_connections where owner_id = p_owner_id and id = p_connection_id;
        if not found then raise exception 'GOOGLE_CONNECTION_NOT_FOUND'; end if;
        if not exists (select 1 from public.google_calendar_connections where owner_id = p_owner_id and is_scheduling_target) then
            select id into v_next from public.google_calendar_connections where owner_id = p_owner_id
                order by (scope_level = 'schedule') desc, connected_at, id limit 1;
            update public.google_calendar_connections set is_scheduling_target = true where id = v_next;
        end if;
    end if;
end;
$$;
create function public.delete_google_calendar_connections(p_owner_id uuid, p_connection_id uuid)
returns void language sql security invoker set search_path = '' as $$
    select private.delete_google_calendar_connections(p_owner_id, p_connection_id)
$$;
revoke all on function private.delete_google_calendar_connections(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_google_calendar_connections(uuid, uuid) from public, anon, authenticated;
grant execute on function private.delete_google_calendar_connections(uuid, uuid) to service_role;
grant execute on function public.delete_google_calendar_connections(uuid, uuid) to service_role;

drop table public.google_calendar_settings;
comment on table public.google_calendar_connections is 'Per-owner Google accounts; refresh_token is service-role-only, null sub is legacy calendar-list identity';

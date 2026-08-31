-- Owner-scoped GitHub credentials and per-repository sync preferences.
-- Browser clients can manage their own connection and preferences but can
-- never select the token or author sync/staleness metadata.

create table public.github_settings (
    owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    token text not null check (length(btrim(token)) > 0),
    github_username text not null check (length(btrim(github_username)) > 0),
    last_synced_at timestamptz,
    updated_at timestamptz not null default now()
);

revoke all on table public.github_settings from anon, authenticated;
grant all on table public.github_settings to service_role;
grant select (owner_id, github_username, last_synced_at, updated_at)
    on table public.github_settings to authenticated;
grant insert (owner_id, token, github_username)
    on table public.github_settings to authenticated;
grant update (owner_id, token, github_username)
    on table public.github_settings to authenticated;
grant delete on table public.github_settings to authenticated;

alter table public.github_settings enable row level security;

create policy github_settings_owner_select on public.github_settings
    for select to authenticated using (owner_id = (select auth.uid()));
create policy github_settings_owner_insert on public.github_settings
    for insert to authenticated with check (owner_id = (select auth.uid()));
create policy github_settings_owner_update on public.github_settings
    for update to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
create policy github_settings_owner_delete on public.github_settings
    for delete to authenticated using (owner_id = (select auth.uid()));

create trigger github_settings_touch_updated_at
    before update on public.github_settings
    for each row execute function public.touch_updated_at();

comment on table public.github_settings is
    'Per-owner GitHub connection; token is service-role-only';
comment on column public.github_settings.token is
    'Plaintext GitHub access token protected by column privileges and RLS';
comment on column public.github_settings.last_synced_at is
    'Timestamp written by github-sync only after a successful GitHub fetch';

create table public.github_repos (
    owner_id uuid not null references public.github_settings(owner_id) on delete cascade,
    full_name text not null
        check (full_name ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
    selected boolean not null default true,
    project_id text check (project_id is null or length(btrim(project_id)) > 0),
    label_filter text check (label_filter is null or length(btrim(label_filter)) > 0),
    include_closed boolean not null default false,
    is_stale boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (owner_id, full_name)
);

revoke all on table public.github_repos from anon, authenticated;
grant all on table public.github_repos to service_role;
grant select (
    owner_id, full_name, selected, project_id, label_filter,
    include_closed, is_stale, updated_at
) on table public.github_repos to authenticated;
grant insert (
    owner_id, full_name, selected, project_id, label_filter, include_closed
) on table public.github_repos to authenticated;
grant update (
    owner_id, full_name, selected, project_id, label_filter, include_closed
) on table public.github_repos to authenticated;
grant delete on table public.github_repos to authenticated;

alter table public.github_repos enable row level security;

create policy github_repos_owner_select on public.github_repos
    for select to authenticated using (owner_id = (select auth.uid()));
create policy github_repos_owner_insert on public.github_repos
    for insert to authenticated with check (owner_id = (select auth.uid()));
create policy github_repos_owner_update on public.github_repos
    for update to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
create policy github_repos_owner_delete on public.github_repos
    for delete to authenticated using (owner_id = (select auth.uid()));

create trigger github_repos_touch_updated_at
    before update on public.github_repos
    for each row execute function public.touch_updated_at();

comment on table public.github_repos is
    'Owner-scoped GitHub repositories and browser-managed import preferences';
comment on column public.github_repos.is_stale is
    'Server-authored flag set when repository enumeration no longer returns this repository';

-- ON CONFLICT needs broader table privileges than the browser can safely hold.
-- Keep that definer implementation outside the exposed Data API schema.
create function private.save_github_settings(
    p_token text,
    p_github_username text
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
    if p_token is null or length(btrim(p_token)) = 0 then
        raise exception 'GITHUB_TOKEN_REQUIRED';
    end if;
    if p_github_username is null or length(btrim(p_github_username)) = 0 then
        raise exception 'GITHUB_USERNAME_REQUIRED';
    end if;

    insert into public.github_settings (
        owner_id, token, github_username
    ) values (
        v_owner, btrim(p_token), btrim(p_github_username)
    )
    on conflict (owner_id) do update set
        token = excluded.token,
        github_username = excluded.github_username;
end;
$$;

revoke all on function private.save_github_settings(text, text)
    from public, anon;
grant execute on function private.save_github_settings(text, text)
    to authenticated, service_role;

create function public.save_github_settings(
    p_token text,
    p_github_username text
)
returns void
language sql
security invoker
set search_path = ''
as $$
    select private.save_github_settings(p_token, p_github_username)
$$;

revoke all on function public.save_github_settings(text, text)
    from public, anon;
grant execute on function public.save_github_settings(text, text)
    to authenticated, service_role;

comment on function public.save_github_settings(text, text) is
    'Invoker-only Data API boundary for the private owner-derived GitHub credential upsert';

create function public.update_github_repo_preferences(
    p_full_name text,
    p_selected boolean,
    p_project_id text,
    p_label_filter text,
    p_include_closed boolean
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
    if p_full_name is null
        or p_full_name !~ '^[^/[:space:]]+/[^/[:space:]]+$' then
        raise exception 'GITHUB_REPO_INVALID';
    end if;
    if p_selected is null or p_include_closed is null then
        raise exception 'GITHUB_REPO_PREFERENCES_INVALID';
    end if;

    perform settings.owner_id
    from public.github_settings as settings
    where settings.owner_id = v_owner;
    if not found then
        raise exception 'GITHUB_NOT_CONFIGURED';
    end if;

    update public.github_repos
    set selected = p_selected,
        project_id = nullif(btrim(p_project_id), ''),
        label_filter = nullif(btrim(p_label_filter), ''),
        include_closed = p_include_closed
    where owner_id = v_owner
      and full_name = p_full_name;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'GITHUB_REPO_NOT_FOUND';
    end if;
end;
$$;

revoke all on function public.update_github_repo_preferences(
    text, boolean, text, text, boolean
) from public, anon;
grant execute on function public.update_github_repo_preferences(
    text, boolean, text, text, boolean
) to authenticated, service_role;

comment on function public.update_github_repo_preferences(
    text, boolean, text, text, boolean
) is 'Updates owner-derived GitHub repository preferences without changing server-authored staleness';

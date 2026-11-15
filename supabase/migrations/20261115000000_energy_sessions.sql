-- Task-blind check-ins are identified solely by the owner's Work window.
create table public.energy_sessions (
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    work_window_id text not null,
    energy smallint null check (energy between 1 and 5),
    clarity smallint null check (clarity between 1 and 5),
    caffeine boolean not null default false,
    energy_carried boolean not null default false,
    clarity_carried boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint energy_sessions_pkey primary key (owner_id, work_window_id)
);

revoke all on table public.energy_sessions from anon;
grant select, insert, update, delete on table public.energy_sessions to authenticated, service_role;
alter table public.energy_sessions enable row level security;

create policy energy_sessions_owner_select on public.energy_sessions
    for select to authenticated using (owner_id = (select auth.uid()));
create policy energy_sessions_owner_insert on public.energy_sessions
    for insert to authenticated with check (owner_id = (select auth.uid()));
create policy energy_sessions_owner_update on public.energy_sessions
    for update to authenticated
    using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy energy_sessions_owner_delete on public.energy_sessions
    for delete to authenticated using (owner_id = (select auth.uid()));

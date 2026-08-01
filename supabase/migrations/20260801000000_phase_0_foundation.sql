create table public.tasks (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    name text not null,
    -- Finalizing a task with no progress sets its target to ceil(0) = 0 in
    -- the existing Rust domain logic, so persistence must accept zero here.
    target_pomodoros integer not null check (target_pomodoros >= 0),
    completed_pomodoros real not null default 0 check (completed_pomodoros >= 0),
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    break_skips integer not null default 0 check (break_skips >= 0),
    archived boolean not null default false,
    unique (id, owner_id)
);

create table public.pomodoro_logs (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    -- Deliberately not a foreign key: delete_task removes the task but keeps
    -- its historical logs in both the Rust and shared TypeScript engines.
    task_id uuid not null,
    duration_minutes real not null check (duration_minutes >= 0),
    finished_at timestamptz not null,
    was_break boolean not null,
    break_skipped boolean not null default false
);

create table public.settings (
    owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    data jsonb not null
);

create table public.timer_state (
    owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    -- JSON payload contains active_task, current_cycle_pomodoros, and timer.
    data jsonb not null
);

create table public.pm_state (
    owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    data jsonb not null
);

create index tasks_owner_created_at_idx on public.tasks (owner_id, created_at);
create index pomodoro_logs_owner_finished_at_idx on public.pomodoro_logs (owner_id, finished_at);
create index pomodoro_logs_owner_task_id_idx on public.pomodoro_logs (owner_id, task_id);

revoke all on table public.tasks, public.pomodoro_logs, public.settings, public.timer_state, public.pm_state from anon;
grant select, insert, update, delete on table public.tasks, public.pomodoro_logs, public.settings, public.timer_state, public.pm_state to authenticated;

alter table public.tasks enable row level security;
alter table public.pomodoro_logs enable row level security;
alter table public.settings enable row level security;
alter table public.timer_state enable row level security;
alter table public.pm_state enable row level security;

create policy tasks_owner_select on public.tasks for select to authenticated using (owner_id = auth.uid());
create policy tasks_owner_insert on public.tasks for insert to authenticated with check (owner_id = auth.uid());
create policy tasks_owner_update on public.tasks for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy tasks_owner_delete on public.tasks for delete to authenticated using (owner_id = auth.uid());

create policy pomodoro_logs_owner_select on public.pomodoro_logs for select to authenticated using (owner_id = auth.uid());
create policy pomodoro_logs_owner_insert on public.pomodoro_logs for insert to authenticated with check (owner_id = auth.uid());
create policy pomodoro_logs_owner_update on public.pomodoro_logs for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy pomodoro_logs_owner_delete on public.pomodoro_logs for delete to authenticated using (owner_id = auth.uid());

create policy settings_owner_select on public.settings for select to authenticated using (owner_id = auth.uid());
create policy settings_owner_insert on public.settings for insert to authenticated with check (owner_id = auth.uid());
create policy settings_owner_update on public.settings for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy settings_owner_delete on public.settings for delete to authenticated using (owner_id = auth.uid());

create policy timer_state_owner_select on public.timer_state for select to authenticated using (owner_id = auth.uid());
create policy timer_state_owner_insert on public.timer_state for insert to authenticated with check (owner_id = auth.uid());
create policy timer_state_owner_update on public.timer_state for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy timer_state_owner_delete on public.timer_state for delete to authenticated using (owner_id = auth.uid());

create policy pm_state_owner_select on public.pm_state for select to authenticated using (owner_id = auth.uid());
create policy pm_state_owner_insert on public.pm_state for insert to authenticated with check (owner_id = auth.uid());
create policy pm_state_owner_update on public.pm_state for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy pm_state_owner_delete on public.pm_state for delete to authenticated using (owner_id = auth.uid());

-- Habit tracker tables: owner-scoped habits and idempotent bucket completions.
--
-- Both tables are row-level records in the staged-sync domain. Completions
-- carry their owner explicitly so their RLS policies can use the same direct
-- owner gate as the foundation tables instead of joining through habits.

create table public.habits (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    name text not null,
    description text not null default '',
    color text not null,
    frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
    position integer not null default 0 check (position >= 0),
    is_archived boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint habits_owner_id_unique unique (owner_id, id)
);

create table public.habit_completions (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    habit_id uuid not null,
    bucket text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint habit_completions_habit_owner_fkey
        foreign key (owner_id, habit_id)
        references public.habits (owner_id, id)
        on delete cascade,
    constraint habit_completions_habit_bucket_unique unique (habit_id, bucket),
    constraint habit_completions_owner_id_unique unique (owner_id, id)
);

create index habits_owner_position_idx on public.habits (owner_id, position);
create index habit_completions_owner_habit_bucket_idx
    on public.habit_completions (owner_id, habit_id, bucket);

revoke all on table public.habits, public.habit_completions from anon;
grant select, insert, update, delete on table public.habits, public.habit_completions to authenticated, service_role;

alter table public.habits enable row level security;
alter table public.habit_completions enable row level security;

create policy habits_owner_select on public.habits
    for select to authenticated using (owner_id = auth.uid());
create policy habits_owner_insert on public.habits
    for insert to authenticated with check (owner_id = auth.uid());
create policy habits_owner_update on public.habits
    for update to authenticated
    using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy habits_owner_delete on public.habits
    for delete to authenticated using (owner_id = auth.uid());

create policy habit_completions_owner_select on public.habit_completions
    for select to authenticated using (owner_id = auth.uid());
create policy habit_completions_owner_insert on public.habit_completions
    for insert to authenticated with check (owner_id = auth.uid());
create policy habit_completions_owner_update on public.habit_completions
    for update to authenticated
    using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy habit_completions_owner_delete on public.habit_completions
    for delete to authenticated using (owner_id = auth.uid());

create trigger habits_touch_updated_at
    before update on public.habits
    for each row execute function public.touch_updated_at();
create trigger habit_completions_touch_updated_at
    before update on public.habit_completions
    for each row execute function public.touch_updated_at();

comment on column public.habits.updated_at is
    'LWW merge timestamp advanced by the touch_updated_at trigger';
comment on column public.habit_completions.updated_at is
    'LWW merge timestamp advanced by the touch_updated_at trigger';
comment on constraint habit_completions_habit_bucket_unique on public.habit_completions is
    'Idempotency key for one completion bucket per habit';
comment on constraint habit_completions_owner_id_unique on public.habit_completions is
    'Per-owner completion identity used by staged sync replays';

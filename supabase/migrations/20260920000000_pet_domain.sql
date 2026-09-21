-- Owner-scoped pet domain tables. Reminder marks intentionally remain local-only.

create table public.pet_profiles (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    name text not null, birth_date date not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint pet_profiles_one_per_owner unique (owner_id), constraint pet_profiles_owner_id_unique unique (owner_id, id)
);
create table public.pet_schedule_items (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    activity_type text not null check (activity_type in ('potty','training','playtime','feeding')), label text not null,
    flexibility text not null check (flexibility in ('fixed','flexible')), priority integer not null, recurrence jsonb not null,
    is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint pet_schedule_recurrence_check check (
        (recurrence ->> 'mode' = 'fixed-time' and jsonb_typeof(recurrence -> 'time') = 'string'
            and jsonb_typeof(recurrence -> 'startMinutes') = 'number' and jsonb_typeof(recurrence -> 'endMinutes') = 'number')
        or (recurrence ->> 'mode' = 'interval' and jsonb_typeof(recurrence -> 'minMinutes') = 'number'
            and jsonb_typeof(recurrence -> 'maxMinutes') = 'number')
    ),
    constraint pet_schedule_items_owner_id_unique unique (owner_id, id)
);
create table public.pet_activity_records (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    activity_type text not null check (activity_type in ('potty','training','playtime','feeding')), occurred_at timestamptz not null,
    duration_minutes double precision check (duration_minutes is null or (duration_minutes >= 0 and duration_minutes < 'Infinity'::double precision)),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint pet_activity_records_owner_id_unique unique (owner_id, id)
);
create table public.pet_nap_records (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    started_at timestamptz not null, ended_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint pet_nap_records_owner_id_unique unique (owner_id, id)
);
create table public.pet_weight_entries (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    measured_at timestamptz not null, weight double precision not null check (weight > '-Infinity'::double precision and weight < 'Infinity'::double precision),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint pet_weight_entries_owner_id_unique unique (owner_id, id)
);
create table public.pet_training_skills (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    label text not null, notes text not null default '', status text not null check (status in ('introduced','progressing','reliable')),
    resolved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint pet_training_skills_owner_id_unique unique (owner_id, id)
);
create table public.pet_fixations (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    label text not null, notes text not null default '', resolved_at timestamptz, resolution_note text not null default '',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint pet_fixations_owner_id_unique unique (owner_id, id)
);
create table public.pet_notable_events (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    title text not null, notes text not null default '', occurred_at timestamptz not null,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint pet_notable_events_owner_id_unique unique (owner_id, id)
);

create index pet_profiles_owner_idx on public.pet_profiles (owner_id);
create index pet_schedule_items_owner_idx on public.pet_schedule_items (owner_id, priority, id);
create index pet_activity_records_owner_idx on public.pet_activity_records (owner_id, occurred_at, id);
create index pet_nap_records_owner_idx on public.pet_nap_records (owner_id, started_at, id);
create index pet_weight_entries_owner_idx on public.pet_weight_entries (owner_id, measured_at, id);
create index pet_training_skills_owner_idx on public.pet_training_skills (owner_id, status, id);
create index pet_fixations_owner_idx on public.pet_fixations (owner_id, resolved_at, id);
create index pet_notable_events_owner_idx on public.pet_notable_events (owner_id, occurred_at, id);

revoke all on table public.pet_profiles, public.pet_schedule_items, public.pet_activity_records, public.pet_nap_records,
    public.pet_weight_entries, public.pet_training_skills, public.pet_fixations, public.pet_notable_events from anon;
grant select, insert, update, delete on table public.pet_profiles, public.pet_schedule_items, public.pet_activity_records, public.pet_nap_records,
    public.pet_weight_entries, public.pet_training_skills, public.pet_fixations, public.pet_notable_events to authenticated, service_role;

alter table public.pet_profiles enable row level security;
alter table public.pet_schedule_items enable row level security;
alter table public.pet_activity_records enable row level security;
alter table public.pet_nap_records enable row level security;
alter table public.pet_weight_entries enable row level security;
alter table public.pet_training_skills enable row level security;
alter table public.pet_fixations enable row level security;
alter table public.pet_notable_events enable row level security;

do $$ declare t text; begin
  foreach t in array array['pet_profiles','pet_schedule_items','pet_activity_records','pet_nap_records','pet_weight_entries','pet_training_skills','pet_fixations','pet_notable_events'] loop
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t || '_owner_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t || '_owner_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t || '_owner_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t || '_owner_delete', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch_updated_at', t);
  end loop;
end $$;

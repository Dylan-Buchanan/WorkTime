-- Goals v1: owner-scoped trackers, lifecycle goals, and upsert-only period check-ins.

create table public.goal_trackers (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    name text not null,
    purpose text not null,
    cadence jsonb not null,
    cadence_anchor_at date not null,
    color text not null,
    sort_order double precision not null check (sort_order > '-Infinity'::double precision and sort_order < 'Infinity'::double precision),
    is_archived boolean not null,
    last_built_period_start date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint goal_trackers_owner_id_unique unique (owner_id,id),
    check (btrim(name) <> ''),
    check (purpose !~ E'[\r\n]'),
    check (jsonb_typeof(cadence) = 'object' and coalesce(jsonb_typeof(cadence->'weekday') = 'number' and (cadence->>'weekday')::numeric between 0 and 6 and (cadence->>'weekday')::numeric = trunc((cadence->>'weekday')::numeric) and ((cadence->>'kind' = 'monthly-weekday') or (cadence->>'kind' = 'every-n-weeks' and jsonb_typeof(cadence->'intervalWeeks') = 'number' and (cadence->>'intervalWeeks')::numeric between 1 and 9007199254740991 and (cadence->>'intervalWeeks')::numeric = trunc((cadence->>'intervalWeeks')::numeric))),false))
);
create index goal_trackers_owner_idx on public.goal_trackers (owner_id,sort_order);

create table public.goals (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    tracker_id uuid not null,
    title text not null,
    notes text not null,
    project_id text,
    metric jsonb,
    lifecycle text not null,
    achieved_at timestamptz,
    dropped_at timestamptz,
    sort_order double precision not null check (sort_order > '-Infinity'::double precision and sort_order < 'Infinity'::double precision),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint goals_owner_id_unique unique (owner_id,id),
    foreign key (owner_id,tracker_id) references public.goal_trackers(owner_id,id) on delete cascade,
    check (btrim(title) <> ''),
    check (lifecycle in ('active','achieved','dropped')),
    check (metric is null or (jsonb_typeof(metric) = 'object' and coalesce(jsonb_typeof(metric->'label') = 'string' and jsonb_typeof(metric->'target') = 'number' and jsonb_typeof(metric->'current') = 'number' and jsonb_typeof(metric->'unit') = 'string' and metric->>'source' in ('manual','liftingtracker') and jsonb_typeof(metric->'overridePinned') = 'boolean',false)))
);
create index goals_owner_idx on public.goals (owner_id,tracker_id,sort_order);

create table public.goal_check_ins (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    goal_id uuid not null,
    period_start date not null,
    did text not null,
    current text not null,
    planned jsonb not null,
    status_pill text not null,
    miss_reason text not null,
    is_focus boolean not null,
    evidence_task_ids jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint goal_check_ins_owner_id_unique unique (owner_id,id),
    foreign key (owner_id,goal_id) references public.goals(owner_id,id) on delete cascade,
    unique (owner_id,goal_id,period_start),
    check (status_pill in ('on-track','at-risk','blocked')),
    check (jsonb_typeof(planned) = 'array'),
    check (jsonb_typeof(evidence_task_ids) = 'array')
);
create index goal_check_ins_owner_idx on public.goal_check_ins (owner_id,goal_id,period_start);

revoke all on table public.goal_trackers,public.goals,public.goal_check_ins from public,anon,authenticated,service_role;
grant select,insert,update on table public.goal_trackers,public.goals,public.goal_check_ins to authenticated,service_role;

do $$ declare t text; begin
    foreach t in array array['goal_trackers','goals','goal_check_ins'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t || '_owner_select', t);
        execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t || '_owner_insert', t);
        execute format('create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t || '_owner_update', t);
        -- Structural delete policy; v1 exposes no delete grant or RPC operation.
        execute format('create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t || '_owner_delete', t);
        execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch_updated_at', t);
    end loop;
end $$;

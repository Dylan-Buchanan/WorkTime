-- Owner-scoped to-dos and staged-sync transport.
--
-- `due_date` is the one active occurrence. Recurrence does not auto-advance in
-- the database; a later domain command explicitly rolls it after check-off.

create table public.todos (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    title text not null,
    rule jsonb,
    due_date date,
    position integer not null default 0 check (position >= 0),
    is_archived boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint todos_rule_shape check (
        rule is null or (
            jsonb_typeof(rule) = 'object'
            and rule ->> 'type' in ('one-off', 'weekly', 'monthly', 'yearly')
        )
    ),
    constraint todos_owner_id_unique unique (owner_id, id)
);

create index todos_owner_position_idx on public.todos (owner_id, position);

revoke all on table public.todos from anon;
grant select, insert, update, delete on table public.todos to authenticated, service_role;

alter table public.todos enable row level security;

create policy todos_owner_select on public.todos
    for select to authenticated using (owner_id = auth.uid());
create policy todos_owner_insert on public.todos
    for insert to authenticated with check (owner_id = auth.uid());
create policy todos_owner_update on public.todos
    for update to authenticated
    using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy todos_owner_delete on public.todos
    for delete to authenticated using (owner_id = auth.uid());

create trigger todos_touch_updated_at
    before update on public.todos
    for each row execute function public.touch_updated_at();

comment on column public.todos.rule is
    'Normalized TodoRule JSON; null represents an unscheduled to-do';
comment on column public.todos.due_date is
    'The single active occurrence, retained while overdue until explicitly rolled';
comment on column public.todos.updated_at is
    'LWW merge timestamp advanced by the touch_updated_at trigger';

-- Retain the proven implementation as a private helper, removing the old
-- public 16-argument signature before publishing the 18-argument boundary.
alter function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean
) rename to apply_staged_sync_without_todos;

revoke all on function public.apply_staged_sync_without_todos(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean
) from public, anon, authenticated, service_role;

create function public.apply_staged_sync(
    p_task_upserts jsonb,
    p_task_tombstones jsonb,
    p_log_upserts jsonb,
    p_log_tombstones jsonb,
    p_habit_upserts jsonb,
    p_habit_tombstones jsonb,
    p_habit_completion_upserts jsonb,
    p_habit_completion_tombstones jsonb,
    p_todo_upserts jsonb,
    p_todo_tombstones jsonb,
    p_settings_data jsonb,
    p_settings_updated_at timestamptz,
    p_timer_data jsonb,
    p_timer_updated_at timestamptz,
    p_timer_new_generation boolean,
    p_pm_data jsonb,
    p_pm_updated_at timestamptz,
    p_full_wipe boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner uuid := auth.uid();
    v_todo jsonb;
begin
    if v_owner is null then
        raise exception 'AUTH_OWNER_REQUIRED';
    end if;

    perform public.apply_staged_sync_without_todos(
        p_task_upserts,
        p_task_tombstones,
        p_log_upserts,
        p_log_tombstones,
        p_habit_upserts,
        p_habit_tombstones,
        p_habit_completion_upserts,
        p_habit_completion_tombstones,
        p_settings_data,
        p_settings_updated_at,
        p_timer_data,
        p_timer_updated_at,
        p_timer_new_generation,
        p_pm_data,
        p_pm_updated_at,
        p_full_wipe
    );

    -- To-dos, like habits, are outside the scoped app-state wipe.
    if p_todo_tombstones is not null then
        for v_todo in select * from jsonb_array_elements(p_todo_tombstones)
        loop
            delete from public.todos
            where owner_id = v_owner
              and id = (v_todo ->> 'id')::uuid
              and updated_at <= (v_todo ->> 'deleted_at')::timestamptz;
        end loop;
    end if;

    if p_todo_upserts is not null then
        for v_todo in select * from jsonb_array_elements(p_todo_upserts)
        loop
            insert into public.todos (
                owner_id, id, title, rule, due_date, position,
                is_archived, created_at, updated_at
            )
            values (
                v_owner,
                (v_todo ->> 'id')::uuid,
                v_todo ->> 'title',
                case when jsonb_typeof(v_todo -> 'rule') = 'null' then null else v_todo -> 'rule' end,
                nullif(v_todo ->> 'due_date', '')::date,
                coalesce((v_todo ->> 'position')::integer, 0),
                coalesce((v_todo ->> 'is_archived')::boolean, false),
                (v_todo ->> 'created_at')::timestamptz,
                coalesce((v_todo ->> 'updated_at')::timestamptz, now())
            )
            on conflict (id, owner_id)
            do update set
                title = excluded.title,
                rule = excluded.rule,
                due_date = excluded.due_date,
                position = excluded.position,
                is_archived = excluded.is_archived,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at
            where excluded.updated_at > public.todos.updated_at;
        end loop;
    end if;
end;
$$;

revoke execute on function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean
) from anon;
grant execute on function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean
) to authenticated, service_role;

comment on function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean
) is 'Atomic staged-sync boundary including LWW to-do upserts and tombstones; scoped full wipe preserves habits, completions, PM state, and to-dos';

-- Add descriptions without changing the staged-sync wrapper chain.
alter table public.todos add column description text not null default '';
comment on column public.todos.description is
    'Optional free-form notes attached to the to-do';

create or replace function public.apply_staged_sync_without_todo_completions(
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
                owner_id, id, title, description, rule, due_date, estimate, current_task_id,
                position, is_archived, created_at, updated_at
            )
            values (
                v_owner,
                (v_todo ->> 'id')::uuid,
                v_todo ->> 'title',
                coalesce(v_todo ->> 'description', ''),
                case when jsonb_typeof(v_todo -> 'rule') = 'null' then null else v_todo -> 'rule' end,
                nullif(v_todo ->> 'due_date', '')::date,
                greatest(coalesce((v_todo ->> 'estimate')::integer, 1), 1),
                nullif(v_todo ->> 'current_task_id', '')::uuid,
                coalesce((v_todo ->> 'position')::integer, 0),
                coalesce((v_todo ->> 'is_archived')::boolean, false),
                (v_todo ->> 'created_at')::timestamptz,
                coalesce((v_todo ->> 'updated_at')::timestamptz, now())
            )
            on conflict (id, owner_id)
            do update set
                title = excluded.title,
                description = excluded.description,
                rule = excluded.rule,
                due_date = excluded.due_date,
                estimate = excluded.estimate,
                current_task_id = excluded.current_task_id,
                position = excluded.position,
                is_archived = excluded.is_archived,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at
            where excluded.updated_at > public.todos.updated_at;
        end loop;
    end if;
end;
$$;

-- This predecessor is called only by the owning security-definer wrapper.
revoke all on function public.apply_staged_sync_without_todo_completions(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean
) from public, anon, authenticated, service_role;
comment on function public.apply_staged_sync_without_todo_completions(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean
) is 'Internal staged-sync predecessor including to-do descriptions; not a client RPC';

-- Atomic persistence for Phase 1 timer/task writes.
--
-- Both functions run as the definer (bypassing RLS) but derive the owner
-- from the caller's JWT so callers can never target another owner. A single
-- function call is a single SQL transaction: either every table write in the
-- transition commits or none does.

create or replace function public.persist_transition(
    p_tasks jsonb,
    p_logs jsonb,
    p_settings jsonb,
    p_timer_data jsonb,
    p_timer_new_generation boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner uuid := auth.uid();
    v_task jsonb;
    v_log jsonb;
begin
    if v_owner is null then
        raise exception 'AUTH_OWNER_REQUIRED';
    end if;

    if p_tasks is not null then
        for v_task in select * from jsonb_array_elements(p_tasks)
        loop
            insert into public.tasks (owner_id, id, name, target_pomodoros, completed_pomodoros, created_at, completed_at, break_skips, archived)
            values (
                v_owner,
                (v_task ->> 'id')::uuid,
                v_task ->> 'name',
                (v_task ->> 'target_pomodoros')::integer,
                (v_task ->> 'completed_pomodoros')::real,
                (v_task ->> 'created_at')::timestamptz,
                nullif(v_task ->> 'completed_at', '')::timestamptz,
                coalesce((v_task ->> 'break_skips')::integer, 0),
                coalesce((v_task ->> 'archived')::boolean, false)
            )
            on conflict (id, owner_id)
            do update set
                name = excluded.name,
                target_pomodoros = excluded.target_pomodoros,
                completed_pomodoros = excluded.completed_pomodoros,
                created_at = excluded.created_at,
                completed_at = excluded.completed_at,
                break_skips = excluded.break_skips,
                archived = excluded.archived;
        end loop;
    end if;

    if p_logs is not null then
        for v_log in select * from jsonb_array_elements(p_logs)
        loop
            insert into public.pomodoro_logs (owner_id, task_id, duration_minutes, finished_at, was_break, break_skipped)
            values (
                v_owner,
                (v_log ->> 'task_id')::uuid,
                (v_log ->> 'duration_minutes')::real,
                (v_log ->> 'finished_at')::timestamptz,
                coalesce((v_log ->> 'was_break')::boolean, false),
                coalesce((v_log ->> 'break_skipped')::boolean, false)
            );
        end loop;
    end if;

    if p_settings is not null then
        insert into public.settings (owner_id, data)
        values (v_owner, p_settings)
        on conflict (owner_id)
        do update set data = excluded.data;
    end if;

    if p_timer_data is not null then
        insert into public.timer_state (owner_id, data, completed)
        values (v_owner, p_timer_data, false)
        on conflict (owner_id)
        do update set
            data = excluded.data,
            completed = case when p_timer_new_generation then false else timer_state.completed end;
    end if;
end;
$$;

-- Completes one timer generation atomically: claims the incomplete timer with a
-- compare-and-set against the raw persisted timer JSON, then inserts the log and
-- upserts the changed task in the same transaction. A failure anywhere rolls back
-- the claim so a retry can safely win instead of losing the log/task writes.
create or replace function public.complete_timer(
    p_expected_timer jsonb,
    p_timer_data jsonb,
    p_log jsonb,
    p_task jsonb
)
returns table (applied boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner uuid := auth.uid();
    v_rows integer;
begin
    if v_owner is null then
        raise exception 'AUTH_OWNER_REQUIRED';
    end if;

    update public.timer_state
        set data = p_timer_data,
            completed = true
        where owner_id = v_owner
          and completed = false
          and data @> jsonb_build_object('timer', p_expected_timer);
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return query select false;
        return;
    end if;
    if v_rows <> 1 then
        raise exception 'COMPLETION_TOO_MANY_ROWS: %', v_rows;
    end if;

    if p_log is not null then
        insert into public.pomodoro_logs (owner_id, task_id, duration_minutes, finished_at, was_break, break_skipped)
        values (
            v_owner,
            (p_log ->> 'task_id')::uuid,
            (p_log ->> 'duration_minutes')::real,
            (p_log ->> 'finished_at')::timestamptz,
            coalesce((p_log ->> 'was_break')::boolean, false),
            coalesce((p_log ->> 'break_skipped')::boolean, false)
        );
    end if;

    if p_task is not null then
        insert into public.tasks (owner_id, id, name, target_pomodoros, completed_pomodoros, created_at, completed_at, break_skips, archived)
        values (
            v_owner,
            (p_task ->> 'id')::uuid,
            p_task ->> 'name',
            (p_task ->> 'target_pomodoros')::integer,
            (p_task ->> 'completed_pomodoros')::real,
            (p_task ->> 'created_at')::timestamptz,
            nullif(p_task ->> 'completed_at', '')::timestamptz,
            coalesce((p_task ->> 'break_skips')::integer, 0),
            coalesce((p_task ->> 'archived')::boolean, false)
        )
        on conflict (id, owner_id)
        do update set
            name = excluded.name,
            target_pomodoros = excluded.target_pomodoros,
            completed_pomodoros = excluded.completed_pomodoros,
            created_at = excluded.created_at,
            completed_at = excluded.completed_at,
            break_skips = excluded.break_skips,
            archived = excluded.archived;
    end if;

    return query select true;
end;
$$;

grant execute on function public.persist_transition(jsonb, jsonb, jsonb, jsonb, boolean) to anon, authenticated, service_role;
grant execute on function public.complete_timer(jsonb, jsonb, jsonb, jsonb) to anon, authenticated, service_role;

comment on function public.persist_transition(jsonb, jsonb, jsonb, jsonb, boolean) is
    'Atomically persists the table slices produced by one ordinary engine transition';
comment on function public.complete_timer(jsonb, jsonb, jsonb, jsonb) is
    'Atomically claims and completes one timer generation, inserting its log and task update';

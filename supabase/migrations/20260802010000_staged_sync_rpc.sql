-- Staged-sync RPCs: idempotent log identity, LWW-safe upserts, and the atomic
-- transactional push boundary for staged non-completion changes.
--
-- persist_transition and complete_timer keep their exact public signatures but
-- now accept client log IDs and (for tasks) optional client updated_at values,
-- so the sync transport can retry them without creating duplicates or
-- overwriting newer rows. persist_transition also accepts a client timer
-- timestamp so a local-only generation install is LWW-gated against a
-- concurrent tab's newer timer row, matching apply_staged_sync. The new
-- apply_staged_sync function is the atomic push boundary used by the sync
-- coordinator: one function call is one SQL transaction that applies
-- tombstones, LWW-gated upserts, and a scoped full wipe. A full wipe clears
-- tasks/logs/settings/timer state but never pm_state.

-- Atomically persists the table slices produced by one ordinary engine
-- transition. Tasks carry an optional updated_at (legacy callers fall back to
-- now()); logs now require a client id and replay harmlessly via
-- `on conflict (owner_id, id) do nothing`. The timer upsert is LWW-gated on a
-- client-authored timestamp (install uses the local generation's completedAt;
-- legacy callers fall back to now()) so an install can never overwrite a
-- timer row another tab started after the client's pull. The old five-argument
-- definition is dropped so the ungated variant cannot be called.
drop function if exists public.persist_transition(jsonb, jsonb, jsonb, jsonb, boolean);

create or replace function public.persist_transition(
    p_tasks jsonb,
    p_logs jsonb,
    p_settings jsonb,
    p_timer_data jsonb,
    p_timer_new_generation boolean,
    p_timer_updated_at timestamptz default null
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
            insert into public.tasks (owner_id, id, name, target_pomodoros, completed_pomodoros, created_at, completed_at, break_skips, archived, updated_at)
            values (
                v_owner,
                (v_task ->> 'id')::uuid,
                v_task ->> 'name',
                (v_task ->> 'target_pomodoros')::integer,
                (v_task ->> 'completed_pomodoros')::real,
                (v_task ->> 'created_at')::timestamptz,
                nullif(v_task ->> 'completed_at', '')::timestamptz,
                coalesce((v_task ->> 'break_skips')::integer, 0),
                coalesce((v_task ->> 'archived')::boolean, false),
                coalesce((v_task ->> 'updated_at')::timestamptz, now())
            )
            on conflict (id, owner_id)
            do update set
                name = excluded.name,
                target_pomodoros = excluded.target_pomodoros,
                completed_pomodoros = excluded.completed_pomodoros,
                created_at = excluded.created_at,
                completed_at = excluded.completed_at,
                break_skips = excluded.break_skips,
                archived = excluded.archived,
                updated_at = excluded.updated_at;
        end loop;
    end if;

    if p_logs is not null then
        for v_log in select * from jsonb_array_elements(p_logs)
        loop
            insert into public.pomodoro_logs (owner_id, id, task_id, duration_minutes, finished_at, was_break, break_skipped)
            values (
                v_owner,
                (v_log ->> 'id')::uuid,
                (v_log ->> 'task_id')::uuid,
                (v_log ->> 'duration_minutes')::real,
                (v_log ->> 'finished_at')::timestamptz,
                coalesce((v_log ->> 'was_break')::boolean, false),
                coalesce((v_log ->> 'break_skipped')::boolean, false)
            )
            on conflict (owner_id, id)
            do nothing;
        end loop;
    end if;

    if p_settings is not null then
        insert into public.settings (owner_id, data)
        values (v_owner, p_settings)
        on conflict (owner_id)
        do update set data = excluded.data;
    end if;

    if p_timer_data is not null then
        insert into public.timer_state (owner_id, data, completed, updated_at)
        values (v_owner, p_timer_data, false, coalesce(p_timer_updated_at, now()))
        on conflict (owner_id)
        do update set
            data = excluded.data,
            completed = case when p_timer_new_generation then false else timer_state.completed end,
            updated_at = excluded.updated_at
        where excluded.updated_at > public.timer_state.updated_at;
    end if;
end;
$$;

-- Completes one timer generation atomically: claims the incomplete timer with a
-- compare-and-set against the raw persisted timer JSON, then inserts the log and
-- upserts the changed task in the same transaction. A failure anywhere rolls back
-- the claim so a retry can safely win instead of losing the log/task writes. The
-- The completion timestamp comes from the immutable client-authored log. This
-- keeps the completed row on the same client LWW timeline as a break generation
-- started immediately afterward; using server now() would incorrectly reject
-- that follow-on generation as stale. The task write carries the same client
-- timestamp and is LWW-gated so a delayed offline completion cannot overwrite a
-- newer rename/target/archive edit made by another client after the completion
-- was journaled; the log and timer claim still apply even when the task row is
-- gated out.
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
            completed = true,
            updated_at = coalesce((p_log ->> 'finished_at')::timestamptz, now())
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
        insert into public.pomodoro_logs (owner_id, id, task_id, duration_minutes, finished_at, was_break, break_skipped)
        values (
            v_owner,
            (p_log ->> 'id')::uuid,
            (p_log ->> 'task_id')::uuid,
            (p_log ->> 'duration_minutes')::real,
            (p_log ->> 'finished_at')::timestamptz,
            coalesce((p_log ->> 'was_break')::boolean, false),
            coalesce((p_log ->> 'break_skipped')::boolean, false)
        )
        on conflict (owner_id, id)
        do nothing;
    end if;

    if p_task is not null then
        insert into public.tasks (owner_id, id, name, target_pomodoros, completed_pomodoros, created_at, completed_at, break_skips, archived, updated_at)
        values (
            v_owner,
            (p_task ->> 'id')::uuid,
            p_task ->> 'name',
            (p_task ->> 'target_pomodoros')::integer,
            (p_task ->> 'completed_pomodoros')::real,
            (p_task ->> 'created_at')::timestamptz,
            nullif(p_task ->> 'completed_at', '')::timestamptz,
            coalesce((p_task ->> 'break_skips')::integer, 0),
            coalesce((p_task ->> 'archived')::boolean, false),
            coalesce((p_task ->> 'updated_at')::timestamptz, now())
        )
        on conflict (id, owner_id)
        do update set
            name = excluded.name,
            target_pomodoros = excluded.target_pomodoros,
            completed_pomodoros = excluded.completed_pomodoros,
            created_at = excluded.created_at,
            completed_at = excluded.completed_at,
            break_skips = excluded.break_skips,
            archived = excluded.archived,
            updated_at = excluded.updated_at
        where excluded.updated_at > public.tasks.updated_at;
    end if;

    return query select true;
end;
$$;

-- Applies one staged non-completion push transactionally. The owner is derived
-- exclusively from the caller's JWT; the payload never carries an owner. A full
-- wipe deletes tasks/logs/settings/timer state, requires default settings/timer
-- payloads, reinserts those defaults with timer completed=false, and never
-- deletes pm_state (PM may still be upserted in the same call).
create or replace function public.apply_staged_sync(
    p_task_upserts jsonb,
    p_task_tombstones jsonb,
    p_log_upserts jsonb,
    p_log_tombstones jsonb,
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
    v_task jsonb;
    v_log jsonb;
begin
    if v_owner is null then
        raise exception 'AUTH_OWNER_REQUIRED';
    end if;

    if p_full_wipe then
        delete from public.tasks where owner_id = v_owner;
        delete from public.pomodoro_logs where owner_id = v_owner;
        delete from public.settings where owner_id = v_owner;
        delete from public.timer_state where owner_id = v_owner;
        -- pm_state is deliberately outside the full-wipe scope and is not deleted.

        -- A wipe must end with default settings and a completed=false timer row,
        -- so non-null default payloads are required before reinserting them.
        if p_settings_data is null or p_timer_data is null then
            raise exception 'WIPE_REQUIRES_DEFAULT_SINGLETONS';
        end if;

        insert into public.settings (owner_id, data, updated_at)
        values (v_owner, p_settings_data, coalesce(p_settings_updated_at, now()))
        on conflict (owner_id)
        do update set
            data = excluded.data,
            updated_at = excluded.updated_at;

        insert into public.timer_state (owner_id, data, completed, updated_at)
        values (v_owner, p_timer_data, false, coalesce(p_timer_updated_at, now()))
        on conflict (owner_id)
        do update set
            data = excluded.data,
            completed = false,
            updated_at = excluded.updated_at;
    else
        -- Task tombstones delete only rows that have not changed since the
        -- deletion; a newer remote update survives and is adopted on the next
        -- pull.
        if p_task_tombstones is not null then
            for v_task in select * from jsonb_array_elements(p_task_tombstones)
            loop
                delete from public.tasks
                where owner_id = v_owner
                  and id = (v_task ->> 'id')::uuid
                  and updated_at <= (v_task ->> 'deleted_at')::timestamptz;
            end loop;
        end if;

        -- Log tombstones are immutable identity deletes by (owner_id, id).
        if p_log_tombstones is not null then
            for v_log in select * from jsonb_array_elements(p_log_tombstones)
            loop
                delete from public.pomodoro_logs
                where owner_id = v_owner
                  and id = (v_log ->> 'id')::uuid;
            end loop;
        end if;

        -- Task upserts are LWW-gated so an older client snapshot cannot
        -- overwrite a row that changed after the pull.
        if p_task_upserts is not null then
            for v_task in select * from jsonb_array_elements(p_task_upserts)
            loop
                insert into public.tasks (owner_id, id, name, target_pomodoros, completed_pomodoros, created_at, completed_at, break_skips, archived, updated_at)
                values (
                    v_owner,
                    (v_task ->> 'id')::uuid,
                    v_task ->> 'name',
                    (v_task ->> 'target_pomodoros')::integer,
                    (v_task ->> 'completed_pomodoros')::real,
                    (v_task ->> 'created_at')::timestamptz,
                    nullif(v_task ->> 'completed_at', '')::timestamptz,
                    coalesce((v_task ->> 'break_skips')::integer, 0),
                    coalesce((v_task ->> 'archived')::boolean, false),
                    coalesce((v_task ->> 'updated_at')::timestamptz, now())
                )
                on conflict (id, owner_id)
                do update set
                    name = excluded.name,
                    target_pomodoros = excluded.target_pomodoros,
                    completed_pomodoros = excluded.completed_pomodoros,
                    created_at = excluded.created_at,
                    completed_at = excluded.completed_at,
                    break_skips = excluded.break_skips,
                    archived = excluded.archived,
                    updated_at = excluded.updated_at
                where excluded.updated_at > public.tasks.updated_at;
            end loop;
        end if;

        -- Log upserts replay the same client UUID as a no-op via the per-owner
        -- unique (owner_id, id) conflict target.
        if p_log_upserts is not null then
            for v_log in select * from jsonb_array_elements(p_log_upserts)
            loop
                insert into public.pomodoro_logs (owner_id, id, task_id, duration_minutes, finished_at, was_break, break_skipped)
                values (
                    v_owner,
                    (v_log ->> 'id')::uuid,
                    (v_log ->> 'task_id')::uuid,
                    (v_log ->> 'duration_minutes')::real,
                    (v_log ->> 'finished_at')::timestamptz,
                    coalesce((v_log ->> 'was_break')::boolean, false),
                    coalesce((v_log ->> 'break_skipped')::boolean, false)
                )
                on conflict (owner_id, id)
                do nothing;
            end loop;
        end if;

        -- Singleton rows are whole-row LWW upserts with explicit client
        -- timestamps.
        if p_settings_data is not null then
            insert into public.settings (owner_id, data, updated_at)
            values (v_owner, p_settings_data, coalesce(p_settings_updated_at, now()))
            on conflict (owner_id)
            do update set
                data = excluded.data,
                updated_at = excluded.updated_at
            where excluded.updated_at > public.settings.updated_at;
        end if;

        if p_timer_data is not null then
            insert into public.timer_state (owner_id, data, completed, updated_at)
            values (v_owner, p_timer_data, false, coalesce(p_timer_updated_at, now()))
            on conflict (owner_id)
            do update set
                data = excluded.data,
                completed = case when p_timer_new_generation then false else timer_state.completed end,
                updated_at = excluded.updated_at
            where excluded.updated_at > public.timer_state.updated_at;
        end if;
    end if;

    -- PM state is outside the full-wipe scope: an unrelated staged PM edit may
    -- be upserted alongside a wipe, but the wipe itself never deletes it.
    if p_pm_data is not null then
        insert into public.pm_state (owner_id, data, updated_at)
        values (v_owner, p_pm_data, coalesce(p_pm_updated_at, now()))
        on conflict (owner_id)
        do update set
            data = excluded.data,
            updated_at = excluded.updated_at
        where excluded.updated_at > public.pm_state.updated_at;
    end if;
end;
$$;

revoke execute on function public.persist_transition(jsonb, jsonb, jsonb, jsonb, boolean, timestamptz) from anon;
revoke execute on function public.complete_timer(jsonb, jsonb, jsonb, jsonb) from anon;
grant execute on function public.persist_transition(jsonb, jsonb, jsonb, jsonb, boolean, timestamptz) to authenticated, service_role;
grant execute on function public.complete_timer(jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.apply_staged_sync(jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean) to authenticated, service_role;

comment on function public.persist_transition(jsonb, jsonb, jsonb, jsonb, boolean, timestamptz) is
    'Atomically persists the table slices produced by one ordinary engine transition';
comment on function public.complete_timer(jsonb, jsonb, jsonb, jsonb) is
    'Atomically claims and completes one timer generation, inserting its log and task update';
comment on function public.apply_staged_sync(jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean) is
    'Atomic push boundary for staged non-completion changes: tombstones, LWW-gated upserts, and a scoped full wipe that never deletes pm_state';

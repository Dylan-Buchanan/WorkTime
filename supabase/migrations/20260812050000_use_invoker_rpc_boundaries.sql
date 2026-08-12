-- Keep every Data API entry point in the exposed public schema as SECURITY
-- INVOKER. The ordinary transition/preference functions can operate directly
-- under the caller's table grants and RLS policies. The staged-sync coordinator
-- and secret-bearing Shortcut upsert genuinely need their existing definer
-- implementations, so move those implementations into an unexposed schema and
-- retain narrow public invoker wrappers with the same PostgREST signatures.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter function public.persist_transition(
    jsonb, jsonb, jsonb, jsonb, boolean, timestamptz
) security invoker;

alter function public.complete_timer(
    jsonb, jsonb, jsonb, jsonb
) security invoker;

alter function public.update_shortcut_preferences(
    text, text[], text
) security invoker;

-- This implementation must remain a definer because it invokes the private
-- staged-sync helper chain whose EXECUTE privileges are owner-only.
alter function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz,
    jsonb, timestamptz, boolean,
    jsonb, timestamptz, boolean
) set schema private;

revoke all on function private.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz,
    jsonb, timestamptz, boolean,
    jsonb, timestamptz, boolean
) from public, anon;
grant execute on function private.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz,
    jsonb, timestamptz, boolean,
    jsonb, timestamptz, boolean
) to authenticated, service_role;

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
    p_todo_completion_upserts jsonb,
    p_todo_completion_tombstones jsonb,
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
language sql
security invoker
set search_path = ''
as $$
    select private.apply_staged_sync(
        p_task_upserts,
        p_task_tombstones,
        p_log_upserts,
        p_log_tombstones,
        p_habit_upserts,
        p_habit_tombstones,
        p_habit_completion_upserts,
        p_habit_completion_tombstones,
        p_todo_upserts,
        p_todo_tombstones,
        p_todo_completion_upserts,
        p_todo_completion_tombstones,
        p_settings_data,
        p_settings_updated_at,
        p_timer_data,
        p_timer_updated_at,
        p_timer_new_generation,
        p_pm_data,
        p_pm_updated_at,
        p_full_wipe
    )
$$;

revoke all on function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz,
    jsonb, timestamptz, boolean,
    jsonb, timestamptz, boolean
) from public, anon;
grant execute on function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz,
    jsonb, timestamptz, boolean,
    jsonb, timestamptz, boolean
) to authenticated, service_role;

comment on function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz,
    jsonb, timestamptz, boolean,
    jsonb, timestamptz, boolean
) is 'Invoker-only Data API boundary for the private atomic staged-sync implementation';

-- The Shortcut upsert needs table-level SELECT for ON CONFLICT, but granting
-- that to authenticated would make shortcut_token readable. Preserve the
-- narrow definer implementation outside the exposed schema instead.
alter function public.save_shortcut_settings(
    text, text, text[], text
) set schema private;

revoke all on function private.save_shortcut_settings(
    text, text, text[], text
) from public, anon;
grant execute on function private.save_shortcut_settings(
    text, text, text[], text
) to authenticated, service_role;

create function public.save_shortcut_settings(
    p_shortcut_token text,
    p_team_name text,
    p_included_statuses text[] default array[
        'In Discovery',
        'Ready for Dev',
        'In Dev'
    ]::text[],
    p_default_project_id text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
    select private.save_shortcut_settings(
        p_shortcut_token,
        p_team_name,
        p_included_statuses,
        p_default_project_id
    )
$$;

revoke all on function public.save_shortcut_settings(
    text, text, text[], text
) from public, anon;
grant execute on function public.save_shortcut_settings(
    text, text, text[], text
) to authenticated, service_role;

comment on function public.save_shortcut_settings(
    text, text, text[], text
) is 'Invoker-only Data API boundary for the private owner-derived Shortcut credential upsert';

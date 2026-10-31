-- Preserve the existing 36-input RPC under a private wrapper; add exactly six goal inputs.
drop function public.apply_staged_sync(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean);
alter function private.apply_staged_sync(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean) rename to apply_staged_sync_without_goals;
revoke all on function private.apply_staged_sync_without_goals(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean) from public,anon,authenticated,service_role;

create function private.apply_staged_sync(
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
    p_pet_activity_upserts jsonb,
    p_pet_activity_tombstones jsonb,
    p_pet_profile_upsert jsonb,
    p_pet_profile_tombstone jsonb,
    p_pet_schedule_upserts jsonb,
    p_pet_schedule_tombstones jsonb,
    p_pet_nap_upserts jsonb,
    p_pet_nap_tombstones jsonb,
    p_pet_weight_upserts jsonb,
    p_pet_weight_tombstones jsonb,
    p_pet_training_skill_upserts jsonb,
    p_pet_training_skill_tombstones jsonb,
    p_pet_fixation_upserts jsonb,
    p_pet_fixation_tombstones jsonb,
    p_pet_notable_event_upserts jsonb,
    p_pet_notable_event_tombstones jsonb,
    p_settings_data jsonb,
    p_settings_updated_at timestamptz,
    p_timer_data jsonb,
    p_timer_updated_at timestamptz,
    p_timer_new_generation boolean,
    p_pm_data jsonb,
    p_pm_updated_at timestamptz,
    p_full_wipe boolean,
    p_goal_tracker_upserts jsonb,
    p_goal_tracker_tombstones jsonb,
    p_goal_upserts jsonb,
    p_goal_tombstones jsonb,
    p_goal_check_in_upserts jsonb,
    p_goal_check_in_tombstones jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_row jsonb;
begin
    if v_owner is null then raise exception 'AUTH_OWNER_REQUIRED'; end if;
    perform private.apply_staged_sync_without_goals(p_task_upserts,p_task_tombstones,p_log_upserts,p_log_tombstones,p_habit_upserts,p_habit_tombstones,p_habit_completion_upserts,p_habit_completion_tombstones,p_todo_upserts,p_todo_tombstones,p_todo_completion_upserts,p_todo_completion_tombstones,p_pet_activity_upserts,p_pet_activity_tombstones,p_pet_profile_upsert,p_pet_profile_tombstone,p_pet_schedule_upserts,p_pet_schedule_tombstones,p_pet_nap_upserts,p_pet_nap_tombstones,p_pet_weight_upserts,p_pet_weight_tombstones,p_pet_training_skill_upserts,p_pet_training_skill_tombstones,p_pet_fixation_upserts,p_pet_fixation_tombstones,p_pet_notable_event_upserts,p_pet_notable_event_tombstones,p_settings_data,p_settings_updated_at,p_timer_data,p_timer_updated_at,p_timer_new_generation,p_pm_data,p_pm_updated_at,p_full_wipe);

    -- v1 has no hard-delete operation. Tombstone inputs reserve the structural sync signature.
    if jsonb_array_length(coalesce(p_goal_tracker_tombstones,'[]')) > 0
        or jsonb_array_length(coalesce(p_goal_tombstones,'[]')) > 0
        or jsonb_array_length(coalesce(p_goal_check_in_tombstones,'[]')) > 0 then
        raise exception 'GOALS_ARCHIVE_ONLY';
    end if;

    -- Parent rows precede children. Check-ins retain the server id on natural-key conflict.
    for v_row in select * from jsonb_array_elements(coalesce(p_goal_tracker_upserts,'[]')) loop
        insert into public.goal_trackers(owner_id,id,name,purpose,cadence,cadence_anchor_at,color,sort_order,is_archived,last_built_period_start,created_at,updated_at)
        values(v_owner,(v_row->>'id')::uuid,(v_row->>'name')::text,(v_row->>'purpose')::text,nullif(v_row->'cadence','null'::jsonb),(v_row->>'cadence_anchor_at')::date,(v_row->>'color')::text,(v_row->>'sort_order')::double precision,(v_row->>'is_archived')::boolean,(v_row->>'last_built_period_start')::date,(v_row->>'created_at')::timestamptz,(v_row->>'updated_at')::timestamptz)
        on conflict (owner_id,id) do update set
            name=excluded.name, purpose=excluded.purpose, cadence=excluded.cadence, cadence_anchor_at=excluded.cadence_anchor_at, color=excluded.color, sort_order=excluded.sort_order, is_archived=excluded.is_archived, last_built_period_start=greatest(public.goal_trackers.last_built_period_start,excluded.last_built_period_start), created_at=excluded.created_at, updated_at=excluded.updated_at
        where excluded.updated_at > public.goal_trackers.updated_at;
    end loop;
    for v_row in select * from jsonb_array_elements(coalesce(p_goal_upserts,'[]')) loop
        insert into public.goals(owner_id,id,tracker_id,title,notes,project_id,metric,lifecycle,achieved_at,dropped_at,sort_order,created_at,updated_at)
        values(v_owner,(v_row->>'id')::uuid,(v_row->>'tracker_id')::uuid,(v_row->>'title')::text,(v_row->>'notes')::text,(v_row->>'project_id')::text,nullif(v_row->'metric','null'::jsonb),(v_row->>'lifecycle')::text,(v_row->>'achieved_at')::timestamptz,(v_row->>'dropped_at')::timestamptz,(v_row->>'sort_order')::double precision,(v_row->>'created_at')::timestamptz,(v_row->>'updated_at')::timestamptz)
        on conflict (owner_id,id) do update set
            tracker_id=excluded.tracker_id, title=excluded.title, notes=excluded.notes, project_id=excluded.project_id, metric=excluded.metric, lifecycle=excluded.lifecycle, achieved_at=excluded.achieved_at, dropped_at=excluded.dropped_at, sort_order=excluded.sort_order, created_at=excluded.created_at, updated_at=excluded.updated_at
        where excluded.updated_at > public.goals.updated_at;
    end loop;
    for v_row in select * from jsonb_array_elements(coalesce(p_goal_check_in_upserts,'[]')) loop
        insert into public.goal_check_ins(owner_id,id,goal_id,period_start,did,current,planned,status_pill,miss_reason,is_focus,evidence_task_ids,created_at,updated_at)
        values(v_owner,(v_row->>'id')::uuid,(v_row->>'goal_id')::uuid,(v_row->>'period_start')::date,(v_row->>'did')::text,(v_row->>'current')::text,nullif(v_row->'planned','null'::jsonb),(v_row->>'status_pill')::text,(v_row->>'miss_reason')::text,(v_row->>'is_focus')::boolean,nullif(v_row->'evidence_task_ids','null'::jsonb),(v_row->>'created_at')::timestamptz,(v_row->>'updated_at')::timestamptz)
        on conflict (owner_id,goal_id,period_start) do update set
            did=excluded.did, current=excluded.current, planned=excluded.planned, status_pill=excluded.status_pill, miss_reason=excluded.miss_reason, is_focus=excluded.is_focus, evidence_task_ids=excluded.evidence_task_ids, created_at=excluded.created_at, updated_at=excluded.updated_at
        where excluded.updated_at > public.goal_check_ins.updated_at;
    end loop;
end $$;

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
    p_pet_activity_upserts jsonb,
    p_pet_activity_tombstones jsonb,
    p_pet_profile_upsert jsonb,
    p_pet_profile_tombstone jsonb,
    p_pet_schedule_upserts jsonb,
    p_pet_schedule_tombstones jsonb,
    p_pet_nap_upserts jsonb,
    p_pet_nap_tombstones jsonb,
    p_pet_weight_upserts jsonb,
    p_pet_weight_tombstones jsonb,
    p_pet_training_skill_upserts jsonb,
    p_pet_training_skill_tombstones jsonb,
    p_pet_fixation_upserts jsonb,
    p_pet_fixation_tombstones jsonb,
    p_pet_notable_event_upserts jsonb,
    p_pet_notable_event_tombstones jsonb,
    p_settings_data jsonb,
    p_settings_updated_at timestamptz,
    p_timer_data jsonb,
    p_timer_updated_at timestamptz,
    p_timer_new_generation boolean,
    p_pm_data jsonb,
    p_pm_updated_at timestamptz,
    p_full_wipe boolean,
    p_goal_tracker_upserts jsonb,
    p_goal_tracker_tombstones jsonb,
    p_goal_upserts jsonb,
    p_goal_tombstones jsonb,
    p_goal_check_in_upserts jsonb,
    p_goal_check_in_tombstones jsonb
) returns void language sql security invoker set search_path = '' as $$
    select private.apply_staged_sync(p_task_upserts,p_task_tombstones,p_log_upserts,p_log_tombstones,p_habit_upserts,p_habit_tombstones,p_habit_completion_upserts,p_habit_completion_tombstones,p_todo_upserts,p_todo_tombstones,p_todo_completion_upserts,p_todo_completion_tombstones,p_pet_activity_upserts,p_pet_activity_tombstones,p_pet_profile_upsert,p_pet_profile_tombstone,p_pet_schedule_upserts,p_pet_schedule_tombstones,p_pet_nap_upserts,p_pet_nap_tombstones,p_pet_weight_upserts,p_pet_weight_tombstones,p_pet_training_skill_upserts,p_pet_training_skill_tombstones,p_pet_fixation_upserts,p_pet_fixation_tombstones,p_pet_notable_event_upserts,p_pet_notable_event_tombstones,p_settings_data,p_settings_updated_at,p_timer_data,p_timer_updated_at,p_timer_new_generation,p_pm_data,p_pm_updated_at,p_full_wipe,p_goal_tracker_upserts,p_goal_tracker_tombstones,p_goal_upserts,p_goal_tombstones,p_goal_check_in_upserts,p_goal_check_in_tombstones)
$$;

revoke all on function private.apply_staged_sync(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function private.apply_staged_sync(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated,service_role;
revoke all on function public.apply_staged_sync(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.apply_staged_sync(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated,service_role;

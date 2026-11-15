-- Preserve the current 42-input implementation and append the energy domain.
drop function public.apply_staged_sync(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb);
alter function private.apply_staged_sync(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) rename to apply_staged_sync_without_energy;
revoke all on function private.apply_staged_sync_without_energy(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

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
    p_goal_check_in_tombstones jsonb,
    p_energy_upserts jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_row jsonb;
begin
    if v_owner is null then raise exception 'AUTH_OWNER_REQUIRED'; end if;
    perform private.apply_staged_sync_without_energy(p_task_upserts,p_task_tombstones,p_log_upserts,p_log_tombstones,p_habit_upserts,p_habit_tombstones,p_habit_completion_upserts,p_habit_completion_tombstones,p_todo_upserts,p_todo_tombstones,p_todo_completion_upserts,p_todo_completion_tombstones,p_pet_activity_upserts,p_pet_activity_tombstones,p_pet_profile_upsert,p_pet_profile_tombstone,p_pet_schedule_upserts,p_pet_schedule_tombstones,p_pet_nap_upserts,p_pet_nap_tombstones,p_pet_weight_upserts,p_pet_weight_tombstones,p_pet_training_skill_upserts,p_pet_training_skill_tombstones,p_pet_fixation_upserts,p_pet_fixation_tombstones,p_pet_notable_event_upserts,p_pet_notable_event_tombstones,p_settings_data,p_settings_updated_at,p_timer_data,p_timer_updated_at,p_timer_new_generation,p_pm_data,p_pm_updated_at,p_full_wipe,p_goal_tracker_upserts,p_goal_tracker_tombstones,p_goal_upserts,p_goal_tombstones,p_goal_check_in_upserts,p_goal_check_in_tombstones);
    -- Like goals, energy survives p_full_wipe (which only resets app state).
    for v_row in select * from jsonb_array_elements(coalesce(p_energy_upserts,'[]')) loop
        insert into public.energy_sessions(owner_id,work_window_id,energy,clarity,caffeine,energy_carried,clarity_carried,created_at,updated_at)
        values(v_owner,v_row->>'work_window_id',(v_row->>'energy')::smallint,(v_row->>'clarity')::smallint,(v_row->>'caffeine')::boolean,(v_row->>'energy_carried')::boolean,(v_row->>'clarity_carried')::boolean,(v_row->>'created_at')::timestamptz,(v_row->>'updated_at')::timestamptz)
        on conflict (owner_id,work_window_id) do update set
            energy=excluded.energy, clarity=excluded.clarity, caffeine=excluded.caffeine,
            energy_carried=excluded.energy_carried, clarity_carried=excluded.clarity_carried,
            created_at=excluded.created_at, updated_at=excluded.updated_at
        where excluded.updated_at > public.energy_sessions.updated_at;
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
    p_goal_check_in_tombstones jsonb,
    p_energy_upserts jsonb
) returns void language sql security invoker set search_path = '' as $$
    select private.apply_staged_sync(p_task_upserts,p_task_tombstones,p_log_upserts,p_log_tombstones,p_habit_upserts,p_habit_tombstones,p_habit_completion_upserts,p_habit_completion_tombstones,p_todo_upserts,p_todo_tombstones,p_todo_completion_upserts,p_todo_completion_tombstones,p_pet_activity_upserts,p_pet_activity_tombstones,p_pet_profile_upsert,p_pet_profile_tombstone,p_pet_schedule_upserts,p_pet_schedule_tombstones,p_pet_nap_upserts,p_pet_nap_tombstones,p_pet_weight_upserts,p_pet_weight_tombstones,p_pet_training_skill_upserts,p_pet_training_skill_tombstones,p_pet_fixation_upserts,p_pet_fixation_tombstones,p_pet_notable_event_upserts,p_pet_notable_event_tombstones,p_settings_data,p_settings_updated_at,p_timer_data,p_timer_updated_at,p_timer_new_generation,p_pm_data,p_pm_updated_at,p_full_wipe,p_goal_tracker_upserts,p_goal_tracker_tombstones,p_goal_upserts,p_goal_tombstones,p_goal_check_in_upserts,p_goal_check_in_tombstones,p_energy_upserts)
$$;

revoke all on function private.apply_staged_sync(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function private.apply_staged_sync(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated,service_role;
revoke all on function public.apply_staged_sync(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.apply_staged_sync(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,timestamptz,boolean,jsonb,timestamptz,boolean,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated,service_role;

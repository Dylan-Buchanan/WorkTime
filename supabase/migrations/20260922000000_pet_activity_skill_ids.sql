-- Persist optional historical skill tags on training activity records.

alter table public.pet_activity_records
    add column skill_ids jsonb,
    add constraint pet_activity_records_skill_ids_check check (
        skill_ids is null
        or (
            jsonb_typeof(skill_ids) = 'array'
            and not jsonb_path_exists(skill_ids, 'strict $[*] ? (@.type() != "string")')
        )
    );

-- The staged-sync RPC uses explicit columns, so replace only its private
-- implementation. The public named-parameter signature remains unchanged.
create or replace function private.apply_staged_sync(
    p_task_upserts jsonb, p_task_tombstones jsonb, p_log_upserts jsonb, p_log_tombstones jsonb,
    p_habit_upserts jsonb, p_habit_tombstones jsonb, p_habit_completion_upserts jsonb, p_habit_completion_tombstones jsonb,
    p_todo_upserts jsonb, p_todo_tombstones jsonb, p_todo_completion_upserts jsonb, p_todo_completion_tombstones jsonb,
    p_pet_activity_upserts jsonb, p_pet_activity_tombstones jsonb,
    p_pet_profile_upsert jsonb, p_pet_profile_tombstone jsonb,
    p_pet_schedule_upserts jsonb, p_pet_schedule_tombstones jsonb,
    p_pet_nap_upserts jsonb, p_pet_nap_tombstones jsonb,
    p_pet_weight_upserts jsonb, p_pet_weight_tombstones jsonb,
    p_pet_training_skill_upserts jsonb, p_pet_training_skill_tombstones jsonb,
    p_pet_fixation_upserts jsonb, p_pet_fixation_tombstones jsonb,
    p_pet_notable_event_upserts jsonb, p_pet_notable_event_tombstones jsonb,
    p_settings_data jsonb, p_settings_updated_at timestamptz, p_timer_data jsonb, p_timer_updated_at timestamptz,
    p_timer_new_generation boolean, p_pm_data jsonb, p_pm_updated_at timestamptz, p_full_wipe boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_row jsonb;
begin
  if v_owner is null then raise exception 'AUTH_OWNER_REQUIRED'; end if;
  perform private.apply_staged_sync_without_pets(
    p_task_upserts,p_task_tombstones,p_log_upserts,p_log_tombstones,p_habit_upserts,p_habit_tombstones,
    p_habit_completion_upserts,p_habit_completion_tombstones,p_todo_upserts,p_todo_tombstones,
    p_todo_completion_upserts,p_todo_completion_tombstones,p_settings_data,p_settings_updated_at,
    p_timer_data,p_timer_updated_at,p_timer_new_generation,p_pm_data,p_pm_updated_at,p_full_wipe);

  -- Tombstones are applied before upserts and only win against older/equal rows.
  if p_pet_profile_tombstone is not null then delete from public.pet_profiles where owner_id=v_owner and updated_at <= (p_pet_profile_tombstone->>'deleted_at')::timestamptz; end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_activity_tombstones,'[]')) loop delete from public.pet_activity_records where owner_id=v_owner and id=(v_row->>'id')::uuid and updated_at <= (v_row->>'deleted_at')::timestamptz; end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_schedule_tombstones,'[]')) loop delete from public.pet_schedule_items where owner_id=v_owner and id=(v_row->>'id')::uuid and updated_at <= (v_row->>'deleted_at')::timestamptz; end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_nap_tombstones,'[]')) loop delete from public.pet_nap_records where owner_id=v_owner and id=(v_row->>'id')::uuid and updated_at <= (v_row->>'deleted_at')::timestamptz; end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_weight_tombstones,'[]')) loop delete from public.pet_weight_entries where owner_id=v_owner and id=(v_row->>'id')::uuid and updated_at <= (v_row->>'deleted_at')::timestamptz; end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_training_skill_tombstones,'[]')) loop delete from public.pet_training_skills where owner_id=v_owner and id=(v_row->>'id')::uuid and updated_at <= (v_row->>'deleted_at')::timestamptz; end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_fixation_tombstones,'[]')) loop delete from public.pet_fixations where owner_id=v_owner and id=(v_row->>'id')::uuid and updated_at <= (v_row->>'deleted_at')::timestamptz; end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_notable_event_tombstones,'[]')) loop delete from public.pet_notable_events where owner_id=v_owner and id=(v_row->>'id')::uuid and updated_at <= (v_row->>'deleted_at')::timestamptz; end loop;

  if p_pet_profile_upsert is not null then
    insert into public.pet_profiles(owner_id,id,name,birth_date,created_at,updated_at) values(v_owner,(p_pet_profile_upsert->>'id')::uuid,p_pet_profile_upsert->>'name',(p_pet_profile_upsert->>'birth_date')::date,(p_pet_profile_upsert->>'created_at')::timestamptz,(p_pet_profile_upsert->>'updated_at')::timestamptz)
    on conflict (owner_id) do update set id=excluded.id,name=excluded.name,birth_date=excluded.birth_date,created_at=excluded.created_at,updated_at=excluded.updated_at where excluded.updated_at > public.pet_profiles.updated_at;
  end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_activity_upserts,'[]')) loop insert into public.pet_activity_records(owner_id,id,activity_type,occurred_at,duration_minutes,skill_ids,created_at,updated_at) values(v_owner,(v_row->>'id')::uuid,v_row->>'activity_type',(v_row->>'occurred_at')::timestamptz,(v_row->>'duration_minutes')::double precision,v_row->'skill_ids',(v_row->>'created_at')::timestamptz,(v_row->>'updated_at')::timestamptz) on conflict (owner_id,id) do update set activity_type=excluded.activity_type,occurred_at=excluded.occurred_at,duration_minutes=excluded.duration_minutes,skill_ids=excluded.skill_ids,created_at=excluded.created_at,updated_at=excluded.updated_at where excluded.updated_at > public.pet_activity_records.updated_at; end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_schedule_upserts,'[]')) loop insert into public.pet_schedule_items(owner_id,id,activity_type,label,flexibility,priority,recurrence,is_active,created_at,updated_at) values(v_owner,(v_row->>'id')::uuid,v_row->>'activity_type',v_row->>'label',v_row->>'flexibility',(v_row->>'priority')::integer,v_row->'recurrence',(v_row->>'is_active')::boolean,(v_row->>'created_at')::timestamptz,(v_row->>'updated_at')::timestamptz) on conflict (owner_id,id) do update set activity_type=excluded.activity_type,label=excluded.label,flexibility=excluded.flexibility,priority=excluded.priority,recurrence=excluded.recurrence,is_active=excluded.is_active,created_at=excluded.created_at,updated_at=excluded.updated_at where excluded.updated_at > public.pet_schedule_items.updated_at; end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_nap_upserts,'[]')) loop insert into public.pet_nap_records(owner_id,id,started_at,ended_at,created_at,updated_at) values(v_owner,(v_row->>'id')::uuid,(v_row->>'started_at')::timestamptz,(v_row->>'ended_at')::timestamptz,(v_row->>'created_at')::timestamptz,(v_row->>'updated_at')::timestamptz) on conflict (owner_id,id) do update set started_at=excluded.started_at,ended_at=excluded.ended_at,created_at=excluded.created_at,updated_at=excluded.updated_at where excluded.updated_at > public.pet_nap_records.updated_at; end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_weight_upserts,'[]')) loop insert into public.pet_weight_entries(owner_id,id,measured_at,weight,created_at,updated_at) values(v_owner,(v_row->>'id')::uuid,(v_row->>'measured_at')::timestamptz,(v_row->>'weight')::double precision,(v_row->>'created_at')::timestamptz,(v_row->>'updated_at')::timestamptz) on conflict (owner_id,id) do update set measured_at=excluded.measured_at,weight=excluded.weight,created_at=excluded.created_at,updated_at=excluded.updated_at where excluded.updated_at > public.pet_weight_entries.updated_at; end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_training_skill_upserts,'[]')) loop insert into public.pet_training_skills(owner_id,id,label,notes,status,resolved_at,created_at,updated_at) values(v_owner,(v_row->>'id')::uuid,v_row->>'label',v_row->>'notes',v_row->>'status',(v_row->>'resolved_at')::timestamptz,(v_row->>'created_at')::timestamptz,(v_row->>'updated_at')::timestamptz) on conflict (owner_id,id) do update set label=excluded.label,notes=excluded.notes,status=excluded.status,resolved_at=excluded.resolved_at,created_at=excluded.created_at,updated_at=excluded.updated_at where excluded.updated_at > public.pet_training_skills.updated_at; end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_fixation_upserts,'[]')) loop insert into public.pet_fixations(owner_id,id,label,notes,resolved_at,resolution_note,created_at,updated_at) values(v_owner,(v_row->>'id')::uuid,v_row->>'label',v_row->>'notes',(v_row->>'resolved_at')::timestamptz,v_row->>'resolution_note',(v_row->>'created_at')::timestamptz,(v_row->>'updated_at')::timestamptz) on conflict (owner_id,id) do update set label=excluded.label,notes=excluded.notes,resolved_at=excluded.resolved_at,resolution_note=excluded.resolution_note,created_at=excluded.created_at,updated_at=excluded.updated_at where excluded.updated_at > public.pet_fixations.updated_at; end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_pet_notable_event_upserts,'[]')) loop insert into public.pet_notable_events(owner_id,id,title,notes,occurred_at,created_at,updated_at) values(v_owner,(v_row->>'id')::uuid,v_row->>'title',v_row->>'notes',(v_row->>'occurred_at')::timestamptz,(v_row->>'created_at')::timestamptz,(v_row->>'updated_at')::timestamptz) on conflict (owner_id,id) do update set title=excluded.title,notes=excluded.notes,occurred_at=excluded.occurred_at,created_at=excluded.created_at,updated_at=excluded.updated_at where excluded.updated_at > public.pet_notable_events.updated_at; end loop;
end $$;

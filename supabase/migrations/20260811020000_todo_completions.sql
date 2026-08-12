-- Immutable, owner-scoped history for completed to-do occurrences.

create table public.todo_completions (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    todo_id uuid not null,
    bucket text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint todo_completions_todo_owner_fkey foreign key (owner_id, todo_id)
        references public.todos (owner_id, id) on delete cascade,
    constraint todo_completions_todo_bucket_unique unique (todo_id, bucket),
    constraint todo_completions_owner_id_unique unique (owner_id, id)
);

create index todo_completions_owner_todo_bucket_idx
    on public.todo_completions (owner_id, todo_id, bucket);

revoke all on table public.todo_completions from anon;
grant select, insert, update, delete on table public.todo_completions to authenticated, service_role;
alter table public.todo_completions enable row level security;
create policy todo_completions_owner_select on public.todo_completions for select to authenticated using (owner_id = auth.uid());
create policy todo_completions_owner_insert on public.todo_completions for insert to authenticated with check (owner_id = auth.uid());
create policy todo_completions_owner_update on public.todo_completions for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy todo_completions_owner_delete on public.todo_completions for delete to authenticated using (owner_id = auth.uid());

create trigger todo_completions_touch_updated_at before update on public.todo_completions
    for each row execute function public.touch_updated_at();

alter function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean
) rename to apply_staged_sync_without_todo_completions;

revoke all on function public.apply_staged_sync_without_todo_completions(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
    jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean
) from public, anon, authenticated, service_role;

create function public.apply_staged_sync(
    p_task_upserts jsonb, p_task_tombstones jsonb,
    p_log_upserts jsonb, p_log_tombstones jsonb,
    p_habit_upserts jsonb, p_habit_tombstones jsonb,
    p_habit_completion_upserts jsonb, p_habit_completion_tombstones jsonb,
    p_todo_upserts jsonb, p_todo_tombstones jsonb,
    p_todo_completion_upserts jsonb, p_todo_completion_tombstones jsonb,
    p_settings_data jsonb, p_settings_updated_at timestamptz,
    p_timer_data jsonb, p_timer_updated_at timestamptz, p_timer_new_generation boolean,
    p_pm_data jsonb, p_pm_updated_at timestamptz, p_full_wipe boolean
)
returns void language plpgsql security definer set search_path = public
as $$
declare
    v_owner uuid := auth.uid();
    v_completion jsonb;
begin
    if v_owner is null then raise exception 'AUTH_OWNER_REQUIRED'; end if;

    perform public.apply_staged_sync_without_todo_completions(
        p_task_upserts, p_task_tombstones, p_log_upserts, p_log_tombstones,
        p_habit_upserts, p_habit_tombstones, p_habit_completion_upserts, p_habit_completion_tombstones,
        p_todo_upserts, p_todo_tombstones, p_settings_data, p_settings_updated_at,
        p_timer_data, p_timer_updated_at, p_timer_new_generation,
        p_pm_data, p_pm_updated_at, p_full_wipe
    );

    if p_todo_completion_tombstones is not null then
        for v_completion in select * from jsonb_array_elements(p_todo_completion_tombstones)
        loop
            delete from public.todo_completions
            where owner_id = v_owner and id = (v_completion ->> 'id')::uuid;
        end loop;
    end if;

    if p_todo_completion_upserts is not null then
        for v_completion in select * from jsonb_array_elements(p_todo_completion_upserts)
        loop
            insert into public.todo_completions (owner_id, id, todo_id, bucket, created_at, updated_at)
            values (
                v_owner, (v_completion ->> 'id')::uuid, (v_completion ->> 'todo_id')::uuid,
                v_completion ->> 'bucket',
                coalesce((v_completion ->> 'created_at')::timestamptz, now()),
                coalesce((v_completion ->> 'updated_at')::timestamptz, now())
            )
            on conflict (todo_id, bucket) do nothing;
        end loop;
    end if;
end;
$$;

revoke execute on function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean
) from anon;
grant execute on function public.apply_staged_sync(
    jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb,
    jsonb, jsonb, jsonb, timestamptz, jsonb, timestamptz, boolean, jsonb, timestamptz, boolean
) to authenticated, service_role;

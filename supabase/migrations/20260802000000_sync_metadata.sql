-- Sync metadata: updated_at timestamps, backfill policy, and log identity.
--
-- Adds the timestamp basis required for deterministic LWW merging on every
-- mutable table and the explicit per-owner idempotency target for staged log
-- upserts. Table ownership, grants, RLS policies, and timer_state.completed
-- are intentionally untouched.

-- Backfill policy: tasks are row-level records with an immutable created_at,
-- so historical task rows are given an exact baseline by copying created_at.
-- settings/timer_state/pm_state are whole-row JSONB documents with no per-field
-- source timestamp, so every pre-existing JSONB row receives the SAME
-- migration-window baseline captured once below (see the do block).
--
-- All additions follow a staged nullable -> backfill -> default/not-null
-- sequence so hosted rows migrate safely instead of being rewritten by a
-- single `add column ... not null default now()`.

alter table public.tasks add column updated_at timestamptz;
update public.tasks set updated_at = created_at where updated_at is null;
alter table public.tasks alter column updated_at set default now();
alter table public.tasks alter column updated_at set not null;

alter table public.settings add column updated_at timestamptz;
alter table public.timer_state add column updated_at timestamptz;
alter table public.pm_state add column updated_at timestamptz;

do $$
declare
    v_backfill_at timestamptz := now();
begin
    update public.settings set updated_at = v_backfill_at where updated_at is null;
    update public.timer_state set updated_at = v_backfill_at where updated_at is null;
    update public.pm_state set updated_at = v_backfill_at where updated_at is null;
end;
$$;

alter table public.settings alter column updated_at set default now();
alter table public.settings alter column updated_at set not null;
alter table public.timer_state alter column updated_at set default now();
alter table public.timer_state alter column updated_at set not null;
alter table public.pm_state alter column updated_at set default now();
alter table public.pm_state alter column updated_at set not null;

-- Deliberate client timestamp preservation: on UPDATE, stamp now() only when
-- the caller left updated_at unchanged from the stored value. A staged-sync
-- upsert that authors its own newer LWW timestamp is preserved; ordinary
-- legacy/direct writes that omit the column are covered. INSERTs rely on the
-- non-null `default now()` when no timestamp is supplied.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.updated_at is not distinct from old.updated_at then
        new.updated_at := now();
    end if;
    return new;
end;
$$;

create trigger tasks_touch_updated_at
    before update on public.tasks
    for each row execute function public.touch_updated_at();
create trigger settings_touch_updated_at
    before update on public.settings
    for each row execute function public.touch_updated_at();
create trigger timer_state_touch_updated_at
    before update on public.timer_state
    for each row execute function public.touch_updated_at();
create trigger pm_state_touch_updated_at
    before update on public.pm_state
    for each row execute function public.touch_updated_at();

-- Per-owner idempotency key for staged log upserts. The global primary key
-- remains the integrity anchor; this named unique constraint gives the staged
-- sync RPC an explicit `on conflict (owner_id, id)` target so replaying the
-- same client-authored log uuid is a no-op rather than a duplicate insert.
alter table public.pomodoro_logs
    add constraint pomodoro_logs_owner_id_unique unique (owner_id, id);

comment on column public.tasks.updated_at is
    'LWW merge timestamp; backfilled from created_at and advanced by the touch_updated_at trigger';
comment on column public.settings.updated_at is
    'LWW merge timestamp; migration-window backfill for pre-existing rows, advanced by the touch_updated_at trigger';
comment on column public.timer_state.updated_at is
    'LWW merge timestamp; migration-window backfill for pre-existing rows, advanced by the touch_updated_at trigger';
comment on column public.pm_state.updated_at is
    'LWW merge timestamp; migration-window backfill for pre-existing rows, advanced by the touch_updated_at trigger';
comment on constraint pomodoro_logs_owner_id_unique on public.pomodoro_logs is
    'Per-owner log idempotency key used as the staged sync upsert conflict target';

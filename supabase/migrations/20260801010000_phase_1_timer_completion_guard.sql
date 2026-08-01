alter table public.timer_state
    add column completed boolean not null default false;

comment on column public.timer_state.completed is
    'Idempotency guard for completion of the current timer generation';

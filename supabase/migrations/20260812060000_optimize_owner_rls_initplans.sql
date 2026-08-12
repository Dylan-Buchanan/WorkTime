-- Evaluate the authenticated owner once per statement instead of once per row.
-- The scalar subquery is an initPlan because auth.uid() is independent of row
-- data; ownership semantics and policy roles/commands remain unchanged.

alter policy tasks_owner_select on public.tasks
    using (owner_id = (select auth.uid()));
alter policy tasks_owner_insert on public.tasks
    with check (owner_id = (select auth.uid()));
alter policy tasks_owner_update on public.tasks
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
alter policy tasks_owner_delete on public.tasks
    using (owner_id = (select auth.uid()));

alter policy pomodoro_logs_owner_select on public.pomodoro_logs
    using (owner_id = (select auth.uid()));
alter policy pomodoro_logs_owner_insert on public.pomodoro_logs
    with check (owner_id = (select auth.uid()));
alter policy pomodoro_logs_owner_update on public.pomodoro_logs
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
alter policy pomodoro_logs_owner_delete on public.pomodoro_logs
    using (owner_id = (select auth.uid()));

alter policy settings_owner_select on public.settings
    using (owner_id = (select auth.uid()));
alter policy settings_owner_insert on public.settings
    with check (owner_id = (select auth.uid()));
alter policy settings_owner_update on public.settings
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
alter policy settings_owner_delete on public.settings
    using (owner_id = (select auth.uid()));

alter policy timer_state_owner_select on public.timer_state
    using (owner_id = (select auth.uid()));
alter policy timer_state_owner_insert on public.timer_state
    with check (owner_id = (select auth.uid()));
alter policy timer_state_owner_update on public.timer_state
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
alter policy timer_state_owner_delete on public.timer_state
    using (owner_id = (select auth.uid()));

alter policy pm_state_owner_select on public.pm_state
    using (owner_id = (select auth.uid()));
alter policy pm_state_owner_insert on public.pm_state
    with check (owner_id = (select auth.uid()));
alter policy pm_state_owner_update on public.pm_state
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
alter policy pm_state_owner_delete on public.pm_state
    using (owner_id = (select auth.uid()));

alter policy habits_owner_select on public.habits
    using (owner_id = (select auth.uid()));
alter policy habits_owner_insert on public.habits
    with check (owner_id = (select auth.uid()));
alter policy habits_owner_update on public.habits
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
alter policy habits_owner_delete on public.habits
    using (owner_id = (select auth.uid()));

alter policy habit_completions_owner_select on public.habit_completions
    using (owner_id = (select auth.uid()));
alter policy habit_completions_owner_insert on public.habit_completions
    with check (owner_id = (select auth.uid()));
alter policy habit_completions_owner_update on public.habit_completions
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
alter policy habit_completions_owner_delete on public.habit_completions
    using (owner_id = (select auth.uid()));

alter policy todos_owner_select on public.todos
    using (owner_id = (select auth.uid()));
alter policy todos_owner_insert on public.todos
    with check (owner_id = (select auth.uid()));
alter policy todos_owner_update on public.todos
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
alter policy todos_owner_delete on public.todos
    using (owner_id = (select auth.uid()));

alter policy todo_completions_owner_select on public.todo_completions
    using (owner_id = (select auth.uid()));
alter policy todo_completions_owner_insert on public.todo_completions
    with check (owner_id = (select auth.uid()));
alter policy todo_completions_owner_update on public.todo_completions
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
alter policy todo_completions_owner_delete on public.todo_completions
    using (owner_id = (select auth.uid()));

alter policy shortcut_settings_owner_select on public.shortcut_settings
    using (owner_id = (select auth.uid()));
alter policy shortcut_settings_owner_insert on public.shortcut_settings
    with check (owner_id = (select auth.uid()));
alter policy shortcut_settings_owner_update on public.shortcut_settings
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
alter policy shortcut_settings_owner_delete on public.shortcut_settings
    using (owner_id = (select auth.uid()));

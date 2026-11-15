-- Seed a fixed local test user so features can be exercised without the
-- invite flow. The email/password below are test-only credentials for the
-- local stack; never use this file against a hosted project.
--
-- The password is hashed with pgcrypto's bcrypt (the same scheme GoTrue uses),
-- so it is never committed or stored in plain text.

create extension if not exists pgcrypto with schema extensions;

insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    email_change_token_current,
    reauthentication_token,
    phone,
    phone_change,
    phone_change_token,
    confirmation_sent_at,
    recovery_sent_at,
    email_change_sent_at,
    last_sign_in_at,
    phone_confirmed_at,
    phone_change_sent_at,
    reauthentication_sent_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at,
    email_change_confirm_status,
    is_sso_user,
    is_anonymous
)
values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'dbuchananh@gmail.com',
    extensions.crypt('Test123!', extensions.gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    now(),
    now(),
    null,
    now(),
    null,
    null,
    null,
    '{"provider": "email", "providers": ["email"]}',
    '{}',
    false,
    now(),
    now(),
    0,
    false,
    false
)
on conflict (email) where is_sso_user = false
do update set
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    updated_at = excluded.updated_at;

insert into auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
)
select
    gen_random_uuid(),
    u.id,
    u.id::text,
    jsonb_build_object('sub', u.id::text, 'email', u.email),
    'email',
    now(),
    now(),
    now()
from auth.users u
where u.email = 'dbuchananh@gmail.com'
on conflict (provider_id, provider) do nothing;

-- Seed representative application data for the fixed local user. The IDs are
-- stable so this block is safe to replay and the PM tasks can link to the
-- corresponding timer tasks. This file is intended for local `db reset` only.

insert into public.tasks (
    id,
    owner_id,
    name,
    target_pomodoros,
    completed_pomodoros,
    created_at,
    completed_at,
    break_skips,
    archived,
    updated_at
)
select
    seed.id,
    owner.owner_id,
    seed.name,
    seed.target_pomodoros,
    seed.completed_pomodoros,
    seed.created_at,
    seed.completed_at,
    seed.break_skips,
    seed.archived,
    now()
from (
    values
        ('10000000-0000-4000-8000-000000000001'::uuid, 'Prepare launch brief', 6, 2::real, '2026-08-01T09:00:00Z'::timestamptz, null::timestamptz, 0, false),
        ('10000000-0000-4000-8000-000000000002'::uuid, 'Review product feedback', 4, 4::real, '2026-07-29T14:00:00Z'::timestamptz, (current_date - 2)::timestamptz, 1, false),
        ('10000000-0000-4000-8000-000000000003'::uuid, 'Plan focused work block', 3, 1::real, '2026-08-03T08:30:00Z'::timestamptz, null::timestamptz, 0, false),
        ('10000000-0000-4000-8000-000000000004'::uuid, 'Submit expense report', 1, 0::real, '2026-08-04T16:00:00Z'::timestamptz, null::timestamptz, 0, false),
        ('10000000-0000-4000-8000-000000000005'::uuid, 'Archived onboarding notes', 2, 2::real, '2026-07-01T10:00:00Z'::timestamptz, '2026-07-02T11:00:00Z'::timestamptz, 0, true),
        ('10000000-0000-4000-8000-000000000006'::uuid, 'Schedule stakeholder demo', 2, 0::real, '2026-08-02T10:00:00Z'::timestamptz, null::timestamptz, 0, false),
        ('10000000-0000-4000-8000-000000000007'::uuid, 'Read one technical chapter', 2, 0::real, '2026-08-02T18:00:00Z'::timestamptz, null::timestamptz, 0, false),
        ('10000000-0000-4000-8000-000000000008'::uuid, 'Replace air filter', 1, 0::real, '2026-08-03T19:00:00Z'::timestamptz, null::timestamptz, 0, false)
) as seed(id, name, target_pomodoros, completed_pomodoros, created_at, completed_at, break_skips, archived)
cross join lateral (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
on conflict (id, owner_id) do update set
    name = excluded.name,
    target_pomodoros = excluded.target_pomodoros,
    completed_pomodoros = excluded.completed_pomodoros,
    created_at = excluded.created_at,
    completed_at = excluded.completed_at,
    break_skips = excluded.break_skips,
    archived = excluded.archived,
    updated_at = now();

insert into public.pm_state (owner_id, data, updated_at)
select
    u.id,
    jsonb_build_object(
        'projects', jsonb_build_object(
            '20000000-0000-4000-8000-000000000001', jsonb_build_object(
                'id', '20000000-0000-4000-8000-000000000001',
                'name', 'Product Launch',
                'color', '#6366F1',
                'description', 'Coordinate the next product launch.',
                'isArchived', false,
                'sortOrder', 0,
                'createdAt', '2026-08-01T08:00:00.000Z',
                'updatedAt', '2026-08-01T08:00:00.000Z'
            ),
            '20000000-0000-4000-8000-000000000002', jsonb_build_object(
                'id', '20000000-0000-4000-8000-000000000002',
                'name', 'Personal Development',
                'color', '#10B981',
                'description', 'Learning and routines that support focused work.',
                'isArchived', false,
                'sortOrder', 1,
                'createdAt', '2026-08-01T08:05:00.000Z',
                'updatedAt', '2026-08-01T08:05:00.000Z'
            ),
            '20000000-0000-4000-8000-000000000003', jsonb_build_object(
                'id', '20000000-0000-4000-8000-000000000003',
                'name', 'Home & Admin',
                'color', '#F59E0B',
                'description', 'Small administrative tasks and household upkeep.',
                'isArchived', false,
                'sortOrder', 2,
                'createdAt', '2026-08-01T08:10:00.000Z',
                'updatedAt', '2026-08-01T08:10:00.000Z'
            )
        ),
        'tasks', jsonb_build_object(
            '30000000-0000-4000-8000-000000000001', jsonb_build_object(
                'id', '30000000-0000-4000-8000-000000000001',
                'title', 'Prepare launch brief',
                'projectId', '20000000-0000-4000-8000-000000000001',
                'status', 'In Progress',
                'priority', 'High',
                'dueDate', to_char(current_date + 2, 'YYYY-MM-DD'),
                'estimatePomos', 6,
                'timeSpentMinutes', 50,
                'workedPomos', 2,
                'lastWorkedAt', '2026-08-05T15:30:00.000Z',
                'description', 'Turn the launch goals into a concise brief for the team.',
                'tags', jsonb_build_array('launch', 'writing'),
                'links', jsonb_build_array('https://example.com/launch-brief'),
                'checklist', jsonb_build_array(
                    jsonb_build_object('id', 'check-brief-1', 'title', 'Collect launch goals', 'done', true),
                    jsonb_build_object('id', 'check-brief-2', 'title', 'Draft risks and dependencies', 'done', false)
                ),
                'sortOrder', 0,
                'isArchived', false,
                'createdAt', '2026-08-01T09:00:00.000Z',
                'updatedAt', '2026-08-05T15:30:00.000Z',
                'appTaskId', '10000000-0000-4000-8000-000000000001',
                'relatedTo', jsonb_build_array()
            ),
            '30000000-0000-4000-8000-000000000002', jsonb_build_object(
                'id', '30000000-0000-4000-8000-000000000002',
                'title', 'Review product feedback',
                'projectId', '20000000-0000-4000-8000-000000000001',
                'status', 'Done',
                'priority', 'Medium',
                'dueDate', to_char(current_date - 2, 'YYYY-MM-DD'),
                'estimatePomos', 4,
                'timeSpentMinutes', 100,
                'workedPomos', 4,
                'lastWorkedAt', '2026-08-04T12:00:00.000Z',
                'description', 'Review the latest feedback and pull out launch-critical changes.',
                'tags', jsonb_build_array('research'),
                'links', jsonb_build_array(),
                'checklist', jsonb_build_array(),
                'sortOrder', 1,
                'isArchived', false,
                'createdAt', '2026-07-29T14:00:00.000Z',
                'updatedAt', '2026-08-04T12:00:00.000Z',
                'appTaskId', '10000000-0000-4000-8000-000000000002',
                'relatedTo', jsonb_build_array()
            ),
            '30000000-0000-4000-8000-000000000003', jsonb_build_object(
                'id', '30000000-0000-4000-8000-000000000003',
                'title', 'Plan focused work block',
                'projectId', '20000000-0000-4000-8000-000000000001',
                'status', 'Next',
                'priority', 'High',
                'dueDate', to_char(current_date + 1, 'YYYY-MM-DD'),
                'estimatePomos', 3,
                'timeSpentMinutes', 25,
                'workedPomos', 1,
                'description', 'Choose the next three outcomes and protect time to finish them.',
                'tags', jsonb_build_array('planning'),
                'links', jsonb_build_array(),
                'checklist', jsonb_build_array(),
                'sortOrder', 2,
                'isArchived', false,
                'createdAt', '2026-08-03T08:30:00.000Z',
                'updatedAt', '2026-08-03T08:30:00.000Z',
                'appTaskId', '10000000-0000-4000-8000-000000000003',
                'relatedTo', jsonb_build_array('30000000-0000-4000-8000-000000000002')
            ),
            '30000000-0000-4000-8000-000000000004', jsonb_build_object(
                'id', '30000000-0000-4000-8000-000000000004',
                'title', 'Submit expense report',
                'projectId', '20000000-0000-4000-8000-000000000003',
                'status', 'Backlog',
                'priority', 'Low',
                'dueDate', to_char(current_date + 5, 'YYYY-MM-DD'),
                'estimatePomos', 1,
                'timeSpentMinutes', 0,
                'workedPomos', 0,
                'description', 'Gather receipts and submit the monthly expense report.',
                'tags', jsonb_build_array('admin'),
                'links', jsonb_build_array(),
                'checklist', jsonb_build_array(),
                'sortOrder', 0,
                'isArchived', false,
                'createdAt', '2026-08-04T16:00:00.000Z',
                'updatedAt', '2026-08-04T16:00:00.000Z',
                'appTaskId', '10000000-0000-4000-8000-000000000004',
                'relatedTo', jsonb_build_array()
            ),
            '30000000-0000-4000-8000-000000000005', jsonb_build_object(
                'id', '30000000-0000-4000-8000-000000000005',
                'title', 'Schedule stakeholder demo',
                'projectId', '20000000-0000-4000-8000-000000000001',
                'status', 'Blocked',
                'priority', 'High',
                'dueDate', to_char(current_date + 7, 'YYYY-MM-DD'),
                'estimatePomos', 2,
                'timeSpentMinutes', 0,
                'workedPomos', 0,
                'description', 'Waiting for stakeholder availability before sending the invite.',
                'tags', jsonb_build_array('coordination'),
                'links', jsonb_build_array('https://example.com/stakeholder-notes'),
                'checklist', jsonb_build_array(),
                'sortOrder', 3,
                'isArchived', false,
                'createdAt', '2026-08-02T10:00:00.000Z',
                'updatedAt', '2026-08-02T10:00:00.000Z',
                'appTaskId', '10000000-0000-4000-8000-000000000006',
                'relatedTo', jsonb_build_array('30000000-0000-4000-8000-000000000001')
            ),
            '30000000-0000-4000-8000-000000000006', jsonb_build_object(
                'id', '30000000-0000-4000-8000-000000000006',
                'title', 'Read one technical chapter',
                'projectId', '20000000-0000-4000-8000-000000000002',
                'status', 'Next',
                'priority', 'Medium',
                'dueDate', to_char(current_date + 3, 'YYYY-MM-DD'),
                'estimatePomos', 2,
                'timeSpentMinutes', 0,
                'workedPomos', 0,
                'description', 'Read and summarize one chapter from the current engineering book.',
                'tags', jsonb_build_array('learning'),
                'links', jsonb_build_array(),
                'checklist', jsonb_build_array(),
                'sortOrder', 0,
                'isArchived', false,
                'createdAt', '2026-08-02T18:00:00.000Z',
                'updatedAt', '2026-08-02T18:00:00.000Z',
                'appTaskId', '10000000-0000-4000-8000-000000000007',
                'relatedTo', jsonb_build_array()
            ),
            '30000000-0000-4000-8000-000000000007', jsonb_build_object(
                'id', '30000000-0000-4000-8000-000000000007',
                'title', 'Replace air filter',
                'projectId', '20000000-0000-4000-8000-000000000003',
                'status', 'Backlog',
                'priority', 'Low',
                'estimatePomos', 1,
                'timeSpentMinutes', 0,
                'workedPomos', 0,
                'description', 'Buy and replace the HVAC air filter.',
                'tags', jsonb_build_array('home'),
                'links', jsonb_build_array(),
                'checklist', jsonb_build_array(),
                'sortOrder', 1,
                'isArchived', false,
                'createdAt', '2026-08-03T19:00:00.000Z',
                'updatedAt', '2026-08-03T19:00:00.000Z',
                'appTaskId', '10000000-0000-4000-8000-000000000008',
                'relatedTo', jsonb_build_array()
            )
        ),
        'meta', jsonb_build_object('initializedAt', '2026-08-01T08:00:00.000Z')
    ),
    now()
from auth.users u
where u.email = 'dbuchananh@gmail.com'
on conflict (owner_id) do update set
    data = excluded.data,
    updated_at = now();

insert into public.habits (
    id,
    owner_id,
    name,
    description,
    color,
    frequency,
    position,
    is_archived,
    created_at,
    updated_at
)
select
    seed.id,
    owner.owner_id,
    seed.name,
    seed.description,
    seed.color,
    seed.frequency,
    seed.position,
    seed.is_archived,
    seed.created_at,
    now()
from (
    values
        ('40000000-0000-4000-8000-000000000001'::uuid, 'Morning planning', 'Set the day''s top priorities before opening email.', '#6366F1', 'daily', 0, false, '2026-08-01T08:00:00Z'::timestamptz),
        ('40000000-0000-4000-8000-000000000002'::uuid, 'Strength training', 'Move for at least 30 minutes.', '#10B981', 'weekly', 1, false, '2026-08-01T08:05:00Z'::timestamptz),
        ('40000000-0000-4000-8000-000000000003'::uuid, 'Monthly budget review', 'Review spending and plan the next month.', '#F59E0B', 'monthly', 2, false, '2026-08-01T08:10:00Z'::timestamptz),
        ('40000000-0000-4000-8000-000000000004'::uuid, 'Read before bed', 'Read a few pages before sleep.', '#8B5CF6', 'daily', 3, true, '2026-07-01T21:00:00Z'::timestamptz)
) as seed(id, name, description, color, frequency, position, is_archived, created_at)
cross join lateral (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
on conflict (owner_id, id) do update set
    name = excluded.name,
    description = excluded.description,
    color = excluded.color,
    frequency = excluded.frequency,
    position = excluded.position,
    is_archived = excluded.is_archived,
    created_at = excluded.created_at,
    updated_at = now();

insert into public.habit_completions (id, owner_id, habit_id, bucket, created_at, updated_at)
select seed.id, u.id, seed.habit_id, seed.bucket, now(), now()
from (
    values
        ('50000000-0000-4000-8000-000000000001'::uuid, '40000000-0000-4000-8000-000000000001'::uuid, to_char(current_date, 'YYYY-MM-DD')),
        ('50000000-0000-4000-8000-000000000002'::uuid, '40000000-0000-4000-8000-000000000001'::uuid, to_char(current_date - 1, 'YYYY-MM-DD')),
        ('50000000-0000-4000-8000-000000000003'::uuid, '40000000-0000-4000-8000-000000000001'::uuid, to_char(current_date - 2, 'YYYY-MM-DD')),
        ('50000000-0000-4000-8000-000000000004'::uuid, '40000000-0000-4000-8000-000000000002'::uuid, to_char(current_date - extract(dow from current_date)::integer, 'YYYY-MM-DD')),
        ('50000000-0000-4000-8000-000000000005'::uuid, '40000000-0000-4000-8000-000000000002'::uuid, to_char(current_date - extract(dow from current_date)::integer - 7, 'YYYY-MM-DD')),
        ('50000000-0000-4000-8000-000000000006'::uuid, '40000000-0000-4000-8000-000000000003'::uuid, to_char(date_trunc('month', current_date)::date, 'YYYY-MM-DD')),
        ('50000000-0000-4000-8000-000000000007'::uuid, '40000000-0000-4000-8000-000000000003'::uuid, to_char((date_trunc('month', current_date) - interval '1 month')::date, 'YYYY-MM-DD'))
) as seed(id, habit_id, bucket)
cross join lateral (
    select id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) u
on conflict (owner_id, id) do update set
    habit_id = excluded.habit_id,
    bucket = excluded.bucket,
    updated_at = now();

insert into public.todos (
    id, owner_id, title, rule, due_date, position, is_archived, created_at, updated_at
)
select
    seed.id, u.id, seed.title, seed.rule, seed.due_date, seed.position,
    seed.is_archived, seed.created_at, now()
from (
    values
        (
            '60000000-0000-4000-8000-000000000001'::uuid,
            'Review today''s priorities',
            jsonb_build_object('type', 'weekly', 'weekdays', jsonb_build_array(extract(dow from current_date)::integer)),
            current_date,
            0,
            false,
            '2026-08-01T08:00:00Z'::timestamptz
        ),
        (
            '60000000-0000-4000-8000-000000000002'::uuid,
            'Submit expense report',
            jsonb_build_object('type', 'one-off', 'date', to_char(current_date + 3, 'YYYY-MM-DD')),
            current_date + 3,
            1,
            false,
            '2026-08-01T08:05:00Z'::timestamptz
        ),
        (
            '60000000-0000-4000-8000-000000000003'::uuid,
            'Organize reference notes',
            null::jsonb,
            null::date,
            2,
            false,
            '2026-08-01T08:10:00Z'::timestamptz
        )
) as seed(id, title, rule, due_date, position, is_archived, created_at)
cross join lateral (
    select id from auth.users where email = 'dbuchananh@gmail.com'
) u
on conflict (owner_id, id) do update set
    title = excluded.title,
    rule = excluded.rule,
    due_date = excluded.due_date,
    position = excluded.position,
    is_archived = excluded.is_archived,
    created_at = excluded.created_at,
    updated_at = now();

-- Goals test data: a weekly tracker with two active goals and three periods of
-- check-in history. The anchor is the most recent Sunday minus three weeks, so
-- the current period is always open and the previous period is always complete
-- and ready for the deck builder, whenever the fixed local user signs in.
-- Dates are relative to the reset date rather than fixed calendar dates.

insert into public.goal_trackers (
    id, owner_id, name, purpose, project_id, cadence, cadence_anchor_at, color,
    sort_order, is_archived, last_built_period_start, created_at, updated_at
)
select
    '70000000-0000-4000-8000-000000000001'::uuid,
    owner.owner_id,
    'Weekly review (test)',
    'A ready-to-use tracker for the check-in wizard and deck builder.',
    '20000000-0000-4000-8000-000000000001',
    jsonb_build_object('kind', 'every-n-weeks', 'weekday', 0, 'intervalWeeks', 1),
    grid.anchor,
    '#6366F1',
    -1,
    false,
    null,
    (grid.anchor - 2)::timestamptz + interval '12 hours',
    now()
from (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
cross join lateral (
    -- Most recent Sunday, then three weekly periods back.
    select (current_date - extract(dow from current_date)::integer - 21)::date as anchor
) grid
on conflict (owner_id, id) do update set
    name = excluded.name,
    purpose = excluded.purpose,
    project_id = excluded.project_id,
    cadence = excluded.cadence,
    cadence_anchor_at = excluded.cadence_anchor_at,
    color = excluded.color,
    sort_order = excluded.sort_order,
    is_archived = excluded.is_archived,
    last_built_period_start = excluded.last_built_period_start,
    updated_at = now();

insert into public.goals (
    id, owner_id, tracker_id, title, notes, project_link_mode, project_id, metric,
    lifecycle, achieved_at, dropped_at, sort_order, created_at, updated_at
)
select
    seed.id,
    owner.owner_id,
    '70000000-0000-4000-8000-000000000001'::uuid,
    seed.title,
    seed.notes,
    seed.project_link_mode,
    seed.project_id,
    seed.metric,
    'active',
    null,
    null,
    seed.sort_order,
    (grid.anchor - 2)::timestamptz + interval '12 hours',
    now()
from (
    values
        (
            '70000000-0000-4000-8000-000000000002'::uuid,
            'Run a full check-in',
            'Walk every wizard field: status, focus, did, current, plans, and miss reason.',
            'inherit',
            null,
            null::jsonb,
            0
        ),
        (
            '70000000-0000-4000-8000-000000000003'::uuid,
            'Build the first deck',
            'Generate a deck from the completed period and review every slide.',
            'project',
            '20000000-0000-4000-8000-000000000002',
            jsonb_build_object(
                'label', 'Slides reviewed',
                'current', 2,
                'target', 6,
                'unit', 'slides',
                'source', 'manual',
                'overridePinned', false
            ),
            1
        )
) as seed(id, title, notes, project_link_mode, project_id, metric, sort_order)
cross join (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
cross join lateral (
    select (current_date - extract(dow from current_date)::integer - 21)::date as anchor
) grid
on conflict (owner_id, id) do update set
    tracker_id = excluded.tracker_id,
    title = excluded.title,
    notes = excluded.notes,
    project_link_mode = excluded.project_link_mode,
    project_id = excluded.project_id,
    metric = excluded.metric,
    lifecycle = excluded.lifecycle,
    achieved_at = excluded.achieved_at,
    dropped_at = excluded.dropped_at,
    sort_order = excluded.sort_order,
    updated_at = now();

-- Three past periods per goal: enough for the deck sparkline, a completed
-- deck period, and the wizard's "did not do" comparison. The current period is
-- intentionally left without check-ins so the wizard opens on a fresh draft.
insert into public.goal_check_ins (
    id, owner_id, goal_id, period_start, did, current, planned,
    status_pill, miss_reason, is_focus, evidence_task_ids, created_at, updated_at
)
select
    seed.id,
    owner.owner_id,
    seed.goal_id,
    (grid.anchor + seed.period_offset)::date,
    seed.did,
    seed.current,
    jsonb_build_array(jsonb_build_object(
        'text', seed.plan_text,
        'dueDate', to_char(grid.anchor + seed.due_offset, 'YYYY-MM-DD')
    )),
    seed.status_pill,
    seed.miss_reason,
    seed.is_focus,
    '[]'::jsonb,
    (grid.anchor + seed.period_offset)::timestamptz + interval '18 hours',
    now()
from (
    values
        (
            '70000000-0000-4000-8000-000000000101'::uuid,
            '70000000-0000-4000-8000-000000000002'::uuid,
            0,
            'Set up the tracker and sketched the first goals.',
            'Choosing a weekly review cadence.',
            'Draft the check-in fields', 6,
            'on-track', '', true
        ),
        (
            '70000000-0000-4000-8000-000000000102'::uuid,
            '70000000-0000-4000-8000-000000000002'::uuid,
            7,
            E'Draft the check-in fields\nTested the wizard end to end.',
            'Reviewing the deck outline.',
            'Review the deck draft', 13,
            'at-risk', '', true
        ),
        (
            '70000000-0000-4000-8000-000000000103'::uuid,
            '70000000-0000-4000-8000-000000000002'::uuid,
            14,
            'Reviewed the wizard copy and fixed two rough edges.',
            'Ready for a full dry run.',
            'Run a complete check-in', 20,
            'on-track',
            'The deck draft slipped because the wizard copy took longer than planned.',
            true
        ),
        (
            '70000000-0000-4000-8000-000000000201'::uuid,
            '70000000-0000-4000-8000-000000000003'::uuid,
            0,
            'Picked the deck sections to include.',
            'Gathering completed period history.',
            'Wire the deck preview', 6,
            'on-track', '', true
        ),
        (
            '70000000-0000-4000-8000-000000000202'::uuid,
            '70000000-0000-4000-8000-000000000003'::uuid,
            7,
            E'Wire the deck preview\nTested the slide order.',
            'Reviewing the closing slide.',
            'Adjust the closing slide', 13,
            'at-risk', '', false
        ),
        (
            '70000000-0000-4000-8000-000000000203'::uuid,
            '70000000-0000-4000-8000-000000000003'::uuid,
            14,
            E'Adjust the closing slide\nRegenerated the deck.',
            'Reviewing the appendix roster.',
            'Publish the deck', 20,
            'on-track', '', false
        )
) as seed(id, goal_id, period_offset, did, current, plan_text, due_offset, status_pill, miss_reason, is_focus)
cross join (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
cross join lateral (
    select (current_date - extract(dow from current_date)::integer - 21)::date as anchor
) grid
on conflict (owner_id, goal_id, period_start) do update set
    did = excluded.did,
    current = excluded.current,
    planned = excluded.planned,
    status_pill = excluded.status_pill,
    miss_reason = excluded.miss_reason,
    is_focus = excluded.is_focus,
    evidence_task_ids = excluded.evidence_task_ids,
    created_at = excluded.created_at,
    updated_at = now();

-- Pet test data: an 18-week-old puppy with a routine, five days of care
-- history, tagged training sessions, active and resolved fixations, weights,
-- naps, and a notable-event timeline. Dates are relative to the reset date so
-- the sample always looks current. Stable IDs and upserts keep the block safe
-- to replay. This file is intended for local `db reset` only.

insert into public.pet_profiles (id, owner_id, name, birth_date, created_at, updated_at)
select
    '80000000-0000-4000-8000-000000000001'::uuid,
    u.id,
    'Mochi',
    current_date - 126,
    now() - interval '126 days',
    now()
from auth.users u
where u.email = 'dbuchananh@gmail.com'
on conflict (owner_id) do update set
    id = excluded.id,
    name = excluded.name,
    birth_date = excluded.birth_date,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

insert into public.pet_schedule_items (
    id, owner_id, activity_type, label, flexibility, priority, recurrence, is_active, created_at, updated_at
)
select
    seed.id,
    owner.owner_id,
    seed.activity_type,
    seed.label,
    seed.flexibility,
    seed.priority,
    seed.recurrence,
    seed.is_active,
    now() - interval '14 days',
    now()
from (
    values
        (
            '80000000-0000-4000-8000-000000000101'::uuid,
            'potty', 'Potty break', 'flexible', 0,
            jsonb_build_object('mode', 'interval', 'minMinutes', 45, 'maxMinutes', 75),
            true
        ),
        (
            '80000000-0000-4000-8000-000000000102'::uuid,
            'feeding', 'Breakfast', 'fixed', 0,
            jsonb_build_object('mode', 'fixed-time', 'time', '07:30', 'startMinutes', 450, 'endMinutes', 465),
            true
        ),
        (
            '80000000-0000-4000-8000-000000000103'::uuid,
            'training', 'Training session', 'flexible', 1,
            jsonb_build_object('mode', 'fixed-time', 'time', '12:30', 'startMinutes', 750, 'endMinutes', 770),
            true
        ),
        (
            '80000000-0000-4000-8000-000000000104'::uuid,
            'playtime', 'Playtime', 'flexible', 2,
            jsonb_build_object('mode', 'fixed-time', 'time', '16:00', 'startMinutes', 960, 'endMinutes', 990),
            true
        ),
        (
            '80000000-0000-4000-8000-000000000105'::uuid,
            'feeding', 'Dinner', 'fixed', 0,
            jsonb_build_object('mode', 'fixed-time', 'time', '18:30', 'startMinutes', 1110, 'endMinutes', 1125),
            true
        )
) as seed(id, activity_type, label, flexibility, priority, recurrence, is_active)
cross join (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
on conflict (owner_id, id) do update set
    activity_type = excluded.activity_type,
    label = excluded.label,
    flexibility = excluded.flexibility,
    priority = excluded.priority,
    recurrence = excluded.recurrence,
    is_active = excluded.is_active,
    created_at = excluded.created_at,
    updated_at = now();

insert into public.pet_training_skills (id, owner_id, label, notes, status, resolved_at, created_at, updated_at)
select
    seed.id,
    owner.owner_id,
    seed.label,
    seed.notes,
    seed.status,
    seed.resolved_at,
    seed.created_at,
    now()
from (
    values
        (
            '90000000-0000-4000-8000-000000000001'::uuid,
            'Sit', 'Lure → hand signal', 'reliable',
            now() - interval '10 days', now() - interval '50 days'
        ),
        (
            '90000000-0000-4000-8000-000000000002'::uuid,
            'Recall', 'Long line in the park', 'progressing',
            null::timestamptz, now() - interval '24 days'
        ),
        (
            '90000000-0000-4000-8000-000000000003'::uuid,
            'Loose leash', 'Still distracted by squirrels', 'introduced',
            null::timestamptz, now() - interval '9 days'
        ),
        (
            '90000000-0000-4000-8000-000000000004'::uuid,
            'Settle on mat', 'Calms down after ~5 minutes', 'reliable',
            now() - interval '3 days', now() - interval '21 days'
        )
) as seed(id, label, notes, status, resolved_at, created_at)
cross join (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
on conflict (owner_id, id) do update set
    label = excluded.label,
    notes = excluded.notes,
    status = excluded.status,
    resolved_at = excluded.resolved_at,
    created_at = excluded.created_at,
    updated_at = now();

insert into public.pet_fixations (id, owner_id, label, notes, resolved_at, resolution_note, created_at, updated_at)
select
    seed.id,
    owner.owner_id,
    seed.label,
    seed.notes,
    seed.resolved_at,
    seed.resolution_note,
    seed.created_at,
    now()
from (
    values
        (
            'a0000000-0000-4000-8000-000000000001'::uuid,
            'Chasing the vacuum', 'Barks at the robot vacuum every morning',
            null::timestamptz, '', now() - interval '12 days'
        ),
        (
            'a0000000-0000-4000-8000-000000000002'::uuid,
            'Biting the leash', 'Worse when excited on the way to the park',
            null::timestamptz, '', now() - interval '5 days'
        ),
        (
            'a0000000-0000-4000-8000-000000000003'::uuid,
            'Chewing shoes', 'Only the left ones, naturally',
            now() - interval '18 days', 'Grew out of it once the teething phase passed', now() - interval '45 days'
        )
) as seed(id, label, notes, resolved_at, resolution_note, created_at)
cross join (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
on conflict (owner_id, id) do update set
    label = excluded.label,
    notes = excluded.notes,
    resolved_at = excluded.resolved_at,
    resolution_note = excluded.resolution_note,
    created_at = excluded.created_at,
    updated_at = now();

insert into public.pet_notable_events (id, owner_id, title, notes, occurred_at, created_at, updated_at)
select
    seed.id,
    owner.owner_id,
    seed.title,
    seed.notes,
    seed.occurred_at,
    seed.occurred_at,
    now()
from (
    values
        (
            'b0000000-0000-4000-8000-000000000001'::uuid,
            'First night home', 'Cried for ten minutes, then slept through',
            date_trunc('day', now()) - interval '70 days' + interval '12 hours'
        ),
        (
            'b0000000-0000-4000-8000-000000000002'::uuid,
            'First successful potty outside', 'Three days of treats finally paid off',
            date_trunc('day', now()) - interval '63 days' + interval '12 hours'
        ),
        (
            'b0000000-0000-4000-8000-000000000003'::uuid,
            'Met the neighbour''s dog', 'Polite sniff, one play bow, no barking',
            date_trunc('day', now()) - interval '42 days' + interval '12 hours'
        ),
        (
            'b0000000-0000-4000-8000-000000000004'::uuid,
            'First walk around the block', 'Managed the whole loop without a carry',
            date_trunc('day', now()) - interval '35 days' + interval '12 hours'
        ),
        (
            'b0000000-0000-4000-8000-000000000005'::uuid,
            'First reliable sit', 'Hand signal from across the kitchen',
            date_trunc('day', now()) - interval '14 days' + interval '12 hours'
        )
) as seed(id, title, notes, occurred_at)
cross join (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
on conflict (owner_id, id) do update set
    title = excluded.title,
    notes = excluded.notes,
    occurred_at = excluded.occurred_at,
    created_at = excluded.created_at,
    updated_at = now();

insert into public.pet_weight_entries (id, owner_id, measured_at, weight, created_at, updated_at)
select
    seed.id,
    owner.owner_id,
    date_trunc('day', now()) - (seed.days_ago || ' days')::interval + interval '8 hours',
    seed.weight,
    date_trunc('day', now()) - (seed.days_ago || ' days')::interval + interval '8 hours',
    now()
from (
    values
        ('e0000000-0000-4000-8000-000000000001'::uuid, 42, 3.1::double precision),
        ('e0000000-0000-4000-8000-000000000002'::uuid, 28, 4.4::double precision),
        ('e0000000-0000-4000-8000-000000000003'::uuid, 14, 5.9::double precision),
        ('e0000000-0000-4000-8000-000000000004'::uuid, 2, 7.2::double precision)
) as seed(id, days_ago, weight)
cross join (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
on conflict (owner_id, id) do update set
    measured_at = excluded.measured_at,
    weight = excluded.weight,
    created_at = excluded.created_at,
    updated_at = now();

insert into public.pet_nap_records (id, owner_id, started_at, ended_at, created_at, updated_at)
select
    seed.id,
    owner.owner_id,
    seed.started_at,
    seed.ended_at,
    seed.started_at,
    now()
from (
    values
        (
            'd0000000-0000-4000-8000-000000000001'::uuid,
            date_trunc('day', now()) - interval '1 day' + interval '9 hours 30 minutes',
            date_trunc('day', now()) - interval '1 day' + interval '10 hours 15 minutes'
        ),
        (
            'd0000000-0000-4000-8000-000000000002'::uuid,
            date_trunc('day', now()) - interval '1 day' + interval '13 hours 15 minutes',
            date_trunc('day', now()) - interval '1 day' + interval '14 hours 5 minutes'
        ),
        (
            'd0000000-0000-4000-8000-000000000003'::uuid,
            date_trunc('day', now()) + interval '10 hours',
            date_trunc('day', now()) + interval '10 hours 40 minutes'
        ),
        (
            'd0000000-0000-4000-8000-000000000004'::uuid,
            date_trunc('day', now()) + interval '14 hours 10 minutes',
            date_trunc('day', now()) + interval '14 hours 55 minutes'
        )
) as seed(id, started_at, ended_at)
cross join (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
where seed.ended_at <= now()
on conflict (owner_id, id) do update set
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    created_at = excluded.created_at,
    updated_at = now();

-- Five days of care history. Training sessions carry skill tags so the
-- Training tab shows per-skill session counts, and the recent-session list has
-- enough rows to scroll. All rows are anchored to completed prior days.
insert into public.pet_activity_records (
    id, owner_id, activity_type, occurred_at, duration_minutes, skill_ids,
    schedule_item_id, schedule_occurrence_start, created_at, updated_at
)
select
    md5('pet-activity-history-' || history.days_ago || '-' || seed.slot)::uuid,
    owner.owner_id,
    seed.activity_type,
    date_trunc('day', now()) - (history.days_ago || ' days')::interval + seed.at,
    case
        when seed.activity_type = 'training' then
            case history.days_ago when 6 then 15 when 4 then 20 when 2 then 12 else 18 end::double precision
        else seed.duration_minutes
    end,
    case
        when seed.activity_type <> 'training' then null
        when history.days_ago = 6 then '["90000000-0000-4000-8000-000000000001", "90000000-0000-4000-8000-000000000002"]'::jsonb
        when history.days_ago = 4 then '["90000000-0000-4000-8000-000000000001", "90000000-0000-4000-8000-000000000004"]'::jsonb
        when history.days_ago = 2 then '["90000000-0000-4000-8000-000000000002", "90000000-0000-4000-8000-000000000003"]'::jsonb
        else '["90000000-0000-4000-8000-000000000001", "90000000-0000-4000-8000-000000000002", "90000000-0000-4000-8000-000000000003"]'::jsonb
    end,
    null::uuid,
    null::timestamptz,
    date_trunc('day', now()) - (history.days_ago || ' days')::interval + seed.at,
    now()
from (
    values (6), (4), (2), (1)
) as history(days_ago)
cross join (
    values
        ('feeding-am', 'feeding', interval '7 hours 30 minutes', null::double precision),
        ('potty-am', 'potty', interval '8 hours 10 minutes', null::double precision),
        ('training', 'training', interval '12 hours 30 minutes', null::double precision),
        ('potty-mid', 'potty', interval '13 hours', null::double precision),
        ('playtime', 'playtime', interval '16 hours', 25::double precision),
        ('potty-pm', 'potty', interval '17 hours 10 minutes', null::double precision),
        ('feeding-pm', 'feeding', interval '18 hours 30 minutes', null::double precision)
) as seed(slot, activity_type, at, duration_minutes)
cross join (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
on conflict (owner_id, id) do update set
    activity_type = excluded.activity_type,
    occurred_at = excluded.occurred_at,
    duration_minutes = excluded.duration_minutes,
    skill_ids = excluded.skill_ids,
    schedule_item_id = excluded.schedule_item_id,
    schedule_occurrence_start = excluded.schedule_occurrence_start,
    created_at = excluded.created_at,
    updated_at = now();

-- Recent rows for the current day. They are all `now() - interval` so they are
-- never future-stamped, and the newest potty record anchors the interval item.
insert into public.pet_activity_records (
    id, owner_id, activity_type, occurred_at, duration_minutes, skill_ids,
    schedule_item_id, schedule_occurrence_start, created_at, updated_at
)
select
    md5('pet-activity-today-' || seed.slot)::uuid,
    owner.owner_id,
    seed.activity_type,
    now() - seed.ago,
    seed.duration_minutes,
    seed.skill_ids,
    null::uuid,
    null::timestamptz,
    now() - seed.ago,
    now()
from (
    values
        ('potty-recent', 'potty', interval '30 minutes', null::double precision, null::jsonb),
        ('potty-earlier', 'potty', interval '3 hours', null::double precision, null::jsonb),
        ('feeding', 'feeding', interval '5 hours', null::double precision, null::jsonb),
        ('training', 'training', interval '2 hours', 15::double precision,
            '["90000000-0000-4000-8000-000000000002", "90000000-0000-4000-8000-000000000003"]'::jsonb),
        ('playtime', 'playtime', interval '90 minutes', 20::double precision, null::jsonb)
) as seed(slot, activity_type, ago, duration_minutes, skill_ids)
cross join (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
on conflict (owner_id, id) do update set
    activity_type = excluded.activity_type,
    occurred_at = excluded.occurred_at,
    duration_minutes = excluded.duration_minutes,
    skill_ids = excluded.skill_ids,
    schedule_item_id = excluded.schedule_item_id,
    schedule_occurrence_start = excluded.schedule_occurrence_start,
    created_at = excluded.created_at,
    updated_at = now();

-- Energy check-in history: two weeks of Work-window ratings so the Analytics
-- Wellbeing heatmap, the rated-sessions footnote, and the recent list are
-- populated on any reset date. `clarity` is the mental rating the app labels
-- "Clarity". `work_window_id` is the text ISO window start the app writes (no
-- foreign key; sessions are task-blind), built from relative dates at typical
-- work hours. Rows flagged carried skipped a rating and reuse the previous
-- same-day value, matching `resolveEnergyPrefill`. A row exists for today only
-- once its start time has passed, and the (owner_id, work_window_id) conflict
-- target keeps the block safe to replay.

insert into public.energy_sessions (
    owner_id, work_window_id, energy, clarity, caffeine,
    energy_carried, clarity_carried, created_at, updated_at
)
select
    owner.owner_id,
    to_char(stamp.window_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    seed.energy,
    seed.clarity,
    seed.caffeine,
    seed.energy_carried,
    seed.clarity_carried,
    stamp.window_at,
    now()
from (
    values
        (13, interval '9 hours', 4, 4, false, false, false),
        (13, interval '10 hours 30 minutes', 3, 3, true, false, false),
        (13, interval '13 hours 30 minutes', 2, 3, true, false, false),
        (13, interval '16 hours', 3, 2, false, false, false),
        (12, interval '9 hours', 5, 4, true, false, false),
        (12, interval '11 hours 15 minutes', 4, 3, true, false, false),
        (12, interval '14 hours', 3, 2, false, false, false),
        (11, interval '9 hours', 3, 2, false, false, false),
        (11, interval '10 hours 30 minutes', 3, 2, false, true, true),
        (11, interval '14 hours', 2, 2, true, false, false),
        (11, interval '16 hours 15 minutes', 2, 1, true, false, false),
        (10, interval '8 hours 45 minutes', 4, 5, false, false, false),
        (10, interval '11 hours', null, null, false, false, false),
        (10, interval '15 hours', 3, 3, true, false, false),
        (9, interval '9 hours', 5, 4, true, false, false),
        (9, interval '10 hours 30 minutes', 5, 4, false, true, true),
        (9, interval '14 hours 45 minutes', 3, 3, false, false, false),
        (8, interval '9 hours', 2, 2, false, false, false),
        (8, interval '11 hours 30 minutes', 2, 1, true, false, false),
        (8, interval '15 hours', 3, 2, true, false, false),
        (7, interval '9 hours 15 minutes', 4, 4, false, false, false),
        (7, interval '13 hours 30 minutes', 4, 3, true, false, false),
        (6, interval '9 hours 30 minutes', 3, 4, false, false, false),
        (6, interval '11 hours 15 minutes', 3, 4, false, true, true),
        (6, interval '14 hours 30 minutes', 2, 2, false, false, false),
        (5, interval '8 hours 45 minutes', 4, 3, true, false, false),
        (5, interval '10 hours 45 minutes', 4, 2, true, false, false),
        (5, interval '16 hours 15 minutes', 2, 2, false, false, false),
        (4, interval '9 hours 15 minutes', 3, 3, false, false, false),
        (4, interval '11 hours 45 minutes', 2, 2, true, false, false),
        (4, interval '13 hours 45 minutes', 1, 2, true, false, false),
        (4, interval '16 hours', 3, 3, false, false, false),
        (3, interval '9 hours', 4, 4, false, false, false),
        (3, interval '10 hours 45 minutes', 4, 4, false, true, true),
        (3, interval '14 hours 15 minutes', 2, 3, true, false, false),
        (2, interval '8 hours 45 minutes', 5, 4, true, false, false),
        (2, interval '12 hours 30 minutes', 3, 2, true, false, false),
        (2, interval '15 hours 30 minutes', 3, 3, false, false, false),
        (1, interval '9 hours', 3, 4, false, false, false),
        (1, interval '11 hours', 4, 3, true, false, false),
        (1, interval '14 hours', 2, 2, false, false, false),
        (1, interval '16 hours 30 minutes', 3, 2, true, false, false),
        (0, interval '8 hours 30 minutes', 4, 4, false, false, false)
) as seed(days_ago, at, energy, clarity, caffeine, energy_carried, clarity_carried)
cross join (
    select id as owner_id
    from auth.users
    where email = 'dbuchananh@gmail.com'
) owner
cross join lateral (
    select date_trunc('day', now()) - (seed.days_ago || ' days')::interval + seed.at as window_at
) stamp
where stamp.window_at <= now()
on conflict (owner_id, work_window_id) do update set
    energy = excluded.energy,
    clarity = excluded.clarity,
    caffeine = excluded.caffeine,
    energy_carried = excluded.energy_carried,
    clarity_carried = excluded.clarity_carried,
    created_at = excluded.created_at,
    updated_at = now();

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

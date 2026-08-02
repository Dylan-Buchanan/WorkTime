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

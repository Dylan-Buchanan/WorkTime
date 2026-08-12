# Validation

## Automated Checks

```powershell
pnpm test:unit
pnpm test:integration
pnpm run build
```

## Manual Verification Steps

1. Start Supabase and serve functions, create an authenticated user, and insert a valid `shortcut_settings` row.
    - Expected: named non-secret columns are readable, while selecting `shortcut_token` is denied.

2. Invoke `shortcut-sync` with the user's Supabase session.
    - Expected: only stories owned by the Shortcut token member and belonging to the selected team are returned, with `status_name`; `last_synced_at` is updated.

3. Replace the stored token with a revoked token and invoke again.
    - Expected: HTTP 401 with `SHORTCUT_TOKEN_INVALID`; no token appears in response or logs.

## Build / Compilation

```powershell
pnpm run build
```

## Common Pitfalls

- Do not serve all functions with `--no-verify-jwt`; only `invite-signup` is configured to skip JWT verification.
- Do not use `.select("*")` from authenticated browser code because the token column intentionally has no SELECT grant.
- Treat Shortcut's `next` as an opaque path/query only after same-origin/path validation.

# Validation

## Automated Checks

```powershell
pnpm test:unit -- src/lib/data/ShortcutDataAccess.test.ts src/components/ShortcutIntegrationCard.test.tsx src/components/IntegrationsPage.test.tsx src/lib/integrations/registry.test.ts
pnpm test:unit
pnpm test:integration
pnpm run build
```

## Manual Verification Steps

1. With local Supabase and functions running, open `/integrations` as an authenticated user and connect a valid Shortcut token/team.
    - Expected: the token clears from the form, only public settings remain visible, and a reload stays connected.
2. Change team/exclusions, save, reload, and sync.
    - Expected: settings persist without re-entering the token; Sync now shows a proposal preview and skip counts.
3. Cancel once, then sync and confirm.
    - Expected: cancel creates nothing; confirm creates PM tasks with Shortcut links and shows created/skipped totals plus last-sync time.
4. Try a revoked token and a rate-limited response.
    - Expected: reconnect guidance appears for the revoked token and retry guidance appears for 429.

## Build / Compilation

```powershell
pnpm run build
```

## Common Pitfalls

- Do not select, echo, log, or locally persist `shortcut_token`.
- Keep the route binding under `AuthenticatedShell`.
- Do not create tasks during fetch or preview rendering.
- Treat `last_synced_at` as the fetch timestamp, not the task-confirmation timestamp.

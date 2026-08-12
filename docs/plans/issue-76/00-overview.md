# Overview

> **Issue:** 76
> **Classification Type:** T2
> **Severity:** Low

## Goal

Replace the Shortcut placeholder with an authenticated, owner-scoped connection and manual preview/confirm sync flow that creates tasks through the existing project-manager pipeline.

## Approach

Add a narrow preference-update RPC and a typed Supabase adapter for the existing issue-74 contracts. Add a Shortcut-specific card and preview modal, wire it to `usePM()` only inside the authenticated route, and retain the generic placeholder cards for Google Calendar and GitHub.

## Key Files

| File | Purpose |
| --- | --- |
| `supabase/migrations/20260812010000_shortcut_preferences_rpc.sql` | Secret-free owner preference updates |
| `supabase/README.md` | Document the browser-safe settings operations |
| `src/lib/data/ShortcutDataAccess.ts` | Typed settings and Edge Function transport |
| `src/lib/data/ShortcutDataAccess.test.ts` | Adapter and error-mapping coverage |
| `src/components/ShortcutIntegrationCard.tsx` | Connect, settings, sync, preview, confirmation, and errors |
| `src/components/ShortcutIntegrationCard.test.tsx` | Interactive Shortcut flow coverage |
| `src/components/IntegrationsPage.tsx` | Insert the implemented Shortcut card into the registry grid |
| `src/components/IntegrationsPage.test.tsx` | Updated placeholder and binding expectations |
| `src/lib/integrations/registry.ts` | Mark Shortcut implemented |
| `src/lib/integrations/registry.test.ts` | Updated registry contract |
| `src/App.tsx` | Bind authenticated owner/PM state to the integration page |
| `integration/shortcutSettings.integration.test.ts` | Preference RPC authorization and secret-preservation coverage |

## Dependencies / Prerequisites

- Issue 74's `shortcut_settings` migration and `shortcut-sync` Edge Function are present.
- The pure `src/lib/engine/shortcutClassification.ts` contract is present.
- Task creation continues through `usePM().createTask`.

## Risks / Open Questions

- `last_synced_at` represents the successful Shortcut fetch, even when a preview is cancelled.
- The current backend accepts a team name but provides no team-discovery endpoint, so the selector is an editable team-name control.
- Multi-task confirmation is not transactional; partial failures must report the number already created.

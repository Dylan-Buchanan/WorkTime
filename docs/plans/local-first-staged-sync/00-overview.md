# Overview

> **Issue:** `docs/issues/local-first-staged-sync.md`
> **Classification Type:** T4
> **Severity:** High

## Goal

Replace per-interaction Supabase reads and writes with a per-owner, localStorage-backed staging store. Timer/task and Project Manager commands must complete locally with zero network activity, while one retry-safe sync action performs pull -> three-way merge -> push, preserves timer completion CAS semantics, and exposes pending/error state through the authenticated UI and platform lifecycle hooks.

## Approach

Implement the change in dependency order: establish client log identity and database sync metadata; add idempotent transactional RPC support; define the versioned staging record; implement local commands, pure merge rules, and timer-completion journaling; connect the Supabase transport and serialized sync coordinator; then rewire React contexts, web lifecycle behavior, the Tauri close handshake, and the test suites.

The sync model is deliberately three-way. `lastSynced` is the baseline, the staging record is the local branch, and the newest pull is the remote branch. For tasks, fields changed on only one branch are retained; when both branches changed the same field, the task row's `updated_at` decides and the remote value wins exact timestamp ties. Settings, timer state, and PM state use whole-row LWW. Logs are immutable and unioned by client UUID. Tombstones carry deletion timestamps, and a scoped full-wipe marker overrides tasks/logs/settings/timer state while leaving PM state untouched.

The actual Tauri 2.8 close API available in this repository is `CloseRequestApi::prevent_close()`. Use it to implement the requirement described as `prevent_cancel`, with an allow-once frontend/backend event handshake so the frontend's eventual `window.close()` is not intercepted a second time.

## Key Files

| File | Purpose |
| --- | --- |
| `src/lib/data/staging/types.ts` | Persisted per-owner staging schema, timestamps, tombstones, completion journal, and `lastSynced` snapshot |
| `src/lib/data/staging/LocalStagingStore.ts` | Versioned localStorage persistence, owner isolation, revision-safe updates, pending counts, and subscriptions |
| `src/lib/data/StagedDataAccess.ts` | Local-only implementation of engine commands and PM reads/writes |
| `src/lib/data/sync/merge.ts` | Pure three-way merge and push-plan construction |
| `src/lib/data/sync/timerCompletions.ts` | Local timer-generation journal and CAS winner/loser reconciliation |
| `src/lib/data/sync/SyncCoordinator.ts` | Serialized pull -> merge -> completion CAS -> push flow, bootstrap guard, retry, and commit handling |
| `src/lib/data/SupabaseDataAccess.ts` | Authenticated, paginated remote pull and RPC-based push transport; no longer the per-interaction source of truth |
| `supabase/migrations/20260802000000_sync_metadata.sql` | `updated_at` backfill/default/trigger behavior and log identity constraint |
| `supabase/migrations/20260802010000_staged_sync_rpc.sql` | Existing RPC compatibility updates plus transactional staged-sync application |
| `src/state/SyncContext.tsx` | Authenticated sync state, focus/visibility/pagehide triggers, and cross-tab view refresh |
| `src/components/SyncControls.tsx` | Sync button, pending count, statuses, errors, and next-visit banner |
| `src/state/AppStateContext.tsx` | Local command result adoption and timer progression without command-following network refreshes |
| `src/state/ProjectManagerContext.tsx` | Immediate local PM staging while preserving UI/server-slice reload contracts |
| `src/state/StateSyncBridge.tsx` | Batched local target propagation followed by one sync action |
| `src-tauri/src/lib.rs` | Close-request interception and event handshake without commands or new dependencies |

## Dependencies / Prerequisites

- Tasks are ordered. Complete schema/RPC contracts before enabling the production sync transport.
- Tasks 04-09 form the data-safety core and should be reviewed together before context/UI rewiring.
- The local Supabase stack is required for migration, RPC, integration, and E2E validation.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PUBLIC_APP_URL` are required for production/PWA/Tauri build gates.
- Preserve the user's existing dirty-worktree changes; modify only files listed by the implementation task being executed.

## Risks / Open Questions

- No stakeholder blocker remains. The explicit requirement that PM survives reset overrides the current `SettingsPanel` call to `resetPM()`; remove that call and correct the confirmation copy.
- Client timestamps make LWW sensitive to device clock skew. Use injected clocks in tests and deterministic remote-wins ties; do not invent a second conflict-resolution protocol in this issue.
- Local edits may occur while a sync is in flight. Commit only the exact revisions/entities acknowledged by the push, then recompute pending state so later edits cannot be cleared accidentally.
- Timer completions require more than snapshot LWW. Completion-derived task/log/timer changes must remain associated with their generation until the existing `complete_timer` CAS reports a winner or loser.
- Browser `pagehide` work can be terminated at any point. Treat it as a foreground best-effort call only; the persisted pending state and next-visit banner are the recovery path.
- The research document's statement that `docs/brainstorming/Data-Architecture.md` is missing is stale in the current dirty worktree. The file now exists, but implementation must not depend on it beyond the decisions already captured in the requirements and this plan.


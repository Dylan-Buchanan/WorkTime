# Research: Habit Tracker: HabitContext provider

## Overview

The habit engine, row-level staged persistence, and sync merge plumbing are already present in the current worktree. The missing layer is the authenticated React provider that reads and writes the staged habit/completion arrays, owns device-local habit-page UI state, and follows the existing Project Manager reload/save lifecycle.

## Issue Context

- User/requested outcome: Add `HabitContext`, wire it into the authenticated shell, and cover hydration, actions, local UI persistence, revision reloads, and zero-sync behavior.
- Current pain or bug: No habit provider or authenticated `/habits` consumer exists yet.
- Scope classification, if known: T2

## Current Behavior

- `DataAccess` exposes `saveHabits(habits, completions)` and `loadHabits()` (`src/lib/data/DataAccess.ts:110-113`). The staged implementation replaces the local collections in one write and creates tombstones for omitted rows (`src/lib/data/StagedDataAccess.ts:391-443`); it does not call the network.
- `SyncProvider` owns bootstrap initialization, local-store subscriptions, and the monotonic `revision` value (`src/state/SyncContext.tsx:31-44`, `src/state/SyncContext.tsx:169-205`). Contexts consume `revision` to reload their own staged slices; local writes do not themselves call `sync`.
- `ProjectManagerProvider` loads its server slice and local UI separately, gates saves on `hydrated && initialized`, uses suppress-once refs during reloads, and persists only PM UI to `pm_state_v1` (`src/state/ProjectManagerContext.tsx:218-325`).
- `Habit`, `HabitCompletion`, and the pure habit factories already define the row shapes and creation defaults (`src/state/types.ts:101-120`, `src/lib/habits/factories.ts:4-26`).
- The existing authenticated hierarchy is `DataProvider -> SyncProvider -> AppStateProvider -> ProjectManagerProvider -> StateSyncBridge` (`src/App.tsx:57-73`), and public auth routes are outside it.

## Relevant Files And Entry Points

- `src/lib/data/DataAccess.ts:110-118` - habit load/save and revision-related data contract.
- `src/lib/data/StagedDataAccess.ts:391-443` - local staged habit persistence and cloning behavior.
- `src/state/SyncContext.tsx:31-44,169-205` - initialized/revision values and local-write notifications.
- `src/state/ProjectManagerContext.tsx:218-335` - hydration, save, reload, UI-key, and manual-refresh template.
- `src/state/ProjectManagerContext.test.tsx:238-253` - provider-wrap and suppress-once reload assertion pattern.
- `src/App.tsx:57-73` - authenticated provider wiring boundary.
- `src/lib/habits/types.ts` and `src/lib/habits/factories.ts` - period/input and domain creation types.

## Data Flow Or Control Flow

1. An authenticated shell constructs the owner-scoped `DataAccess` and mounts the habit provider inside `SyncProvider`.
2. The provider reads the device-local UI key and asynchronously calls `data.loadHabits()`; the loaded arrays become record-backed React state while UI state remains local to the device.
3. A habit action updates React state. Once hydrated and initialized, the save effect calls `data.saveHabits` with the complete habit and completion collections; this stages immediately and emits a local revision but does not invoke `sync`.
4. Same-tab or cross-tab staging changes bump `revision`; the provider reloads the staged arrays, retains device-local UI, and suppresses the resulting state from being restaged.

## Important Contracts And Constraints

- `pm_state_v1` is reserved for PM UI. Habit UI needs a distinct key and must not enter the `worktime:staging:v1:*` record.
- The first load may return empty data before bootstrap. The save effect must not seed or stage defaults until `initialized` is true.
- Actions should operate on the provider’s current full collections so omitted habits/completions are represented as staged deletions by `StagedDataAccess`.
- Deleting a habit must remove its completions from the same saved snapshot. Archive is a row patch and does not remove completions.
- Completion checking is idempotent by `(habitId, bucket)`; unchecking removes the matching completion from the local collection.
- Reordering updates `position` and `updatedAt` for the supplied existing habit IDs, matching PM’s local reorder semantics.
- The provider must not register its own storage/focus listeners or trigger remote sync; `SyncProvider` is the single owner of those concerns.

## Existing Tests And Validation

- `src/state/ProjectManagerContext.test.tsx` covers default hydration, initialization gating, immediate staging, local UI restoration, revision reloads, and no restaging after reload.
- `src/lib/data/InMemoryDataAccess.test.ts:135-170` and `src/lib/data/StagedDataAccess.test.ts:391-433` cover habit array cloning and local persistence.
- No HabitContext test or provider wiring exists yet.
- The focused validation surface is the new context test plus the full unit suite and `npm run build`.

## Risks, Edge Cases, And Unknowns

- A revision may arrive while a provider save is still pending or failed. Reloading the stale staged snapshot in that window could clobber an in-memory edit; the PM serialized-snapshot guard must be retained.
- Device-local selected/expanded IDs can refer to deleted or remotely removed habits. Reload normalization should drop invalid references while retaining valid UI state.
- Malformed localStorage should fall back to safe defaults without preventing habit hydration.
- The provider API is not consumed by the current UI, so the action names and period representation need to remain straightforward for the subsequent habits-page issue. Use the domain’s day/week/month/year period vocabulary.

## Downstream Guidance

- Requirements should preserve the separation between staged domain data and device-local UI, the initialized save gate, and the zero-sync action contract.
- Planning should reuse PM’s serialized snapshot/suppress-once pattern and add provider-wrap tests with an `InMemoryDataAccess` probe.
- Do not add a habits page, route, navigation item, engine behavior, or sync implementation in this issue beyond the provider wiring required by the authenticated shell.

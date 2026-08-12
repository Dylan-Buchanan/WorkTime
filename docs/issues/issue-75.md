## Title: Frontend: Shortcut story classification and task proposal logic

## Tags

Complexity Classification: T1
Severity: Low
Reason: New pure TypeScript module plus its unit test and an index export — self-contained and additive. Blast Radius=1 (new module + test + index export, no existing dependents), Uncertainty=2 (logic fully specified, but the exact slim story payload contract depends on the parallel backend Edge Function issue and dedup normalization edge cases are minor unknowns), Behavior=3 (multi-branch classification, app_url normalization/dedup, proposal mapping, counts), Testing=1 (straightforward no-mock Vitest matching existing engine tests), Reversibility=1 (new files only, no data or semantics changes). Total=8 → T1.
Needs research before implementation: Yes
Research needed: Pin down the exact slim story payload contract from the backend `shortcut-sync` issue (field names, types, nullability of estimate/deadline/archived/story_type/labels), and confirm PMTask dedup matching semantics (match against all `links[]` entries, and what URL normalization beyond trailing-slash trimming is required).

## Summary

Add a pure TypeScript module that classifies fetched Shortcut stories as already-added / status-excluded / archived / new against the current PMTask set and builds PMTask proposals for new stories, unit-tested without mocks.

## Steps to Reproduce Context

1. A sync fetches the owner's team stories (slim payload from the `shortcut-sync` Edge Function).
2. The module classifies each story against current PMTask `links[]` entries and the excluded status list.
3. New eligible stories become PMTask proposals rendered in the UI preview step.

## Expected Behavior

- Stories whose normalized `app_url` matches an existing PMTask `links[]` entry are skipped as already-added.
- Stories whose status name is in the excluded list ("Defining Requirements", "Ready for Review", "Done") are skipped.
- Stories archived in Shortcut are skipped.
- Proposals map story fields onto PMTask fields (title, description, estimate→`estimatePomos`, deadline→`dueDate`, `app_url`→`links[]`, story_type→tags) with an unassigned project by default.
- The module is pure (no I/O, no wall-clock, no random-ID dependencies) and fully unit-tested following the engine test conventions.

## Actual Behavior

Not implemented. No classification or proposal logic exists.

## Requirements for completed issue

1. Given a story payload, the current PMState tasks, and the excluded status list, the module returns a list of proposals plus counts (new / skipped already-added / skipped status-excluded / skipped archived).
2. Dedup matches a normalized story `app_url` against existing PMTask `links[]` entries; the normalization rule is defined and tested.
3. Proposals map story fields to PMTask fields (title, description, `estimatePomos`, `dueDate`, `links`, `tags`) with an unassigned project by default.
4. The module has no I/O, network, wall-clock, or random-ID dependencies and is covered by unit tests consistent with the existing engine tests.

## Context

- Files:
  - `src/state/types.ts` — `PMTask` interface (fields: `title`, `projectId`, `status`, `priority`, `dueDate?`, `estimatePomos?`, `description?`, `tags: string[]`, `links: string[]`, `isArchived`, etc.).
  - `src/lib/engine/` — pure TypeScript source-of-truth modules and their no-mock test convention (`startOfDay.ts`, `weekOverview.ts`, `diffEngine.ts`, `*.test.ts`).
  - `src/lib/engine/index.ts` — re-export pattern for new modules.
- Code Snippets:

```ts
// src/state/types.ts
export interface PMTask {
    id: string;
    title: string;
    projectId: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string; // ISO date
    estimatePomos?: number;
    description?: string; // markdown
    tags: string[];
    links: string[]; // urls
    // ...
}
```

- Shortcut API story fields (from docs): `app_url`, `name`, `description`, `estimate` (int|null), `deadline` (date|null), `workflow_state_id`, `completed`, `archived`, `story_type` ("feature"|"bug"|"chore"), `labels`.

## Notes

- Depends on the slim story payload shape defined by the backend `shortcut-sync` issue; keep the payload contract in sync when that issue lands.
- AGENTS.md: "Do not change timer/task semantics without updating the TypeScript engine tests" — new logic follows the same testing convention.

## Title: To-dos — recurrence rule engine (one-off / weekly / monthly / yearly)

## Tags

Complexity Classification: T1
Severity: Low
Reason: New, fully isolated pure-TS module in `src/lib/todos/` mirroring the established `src/lib/habits/` engine pattern. Blast Radius=1 (brand-new files only; no todos/recurrence code exists in the repo today, no existing dependents), Uncertainty=2 (the local-calendar math is well-precedented by `habits/calendar.ts`, but the monthly "last day − N" and yearly Feb 29 edge-case semantics still need definition), Behavior=3 (complex date-math logic, validation, and dedup — but no data model, DB, auth, or infra change), Testing=1 (pure functions with injected dates make heavy Vitest coverage straightforward; zero user impact until later slices wire it up), Reversibility=1 (new module; simple revert, no data consequences). Total=8 → T1.
Needs research before implementation: No

## Summary

Create the pure TypeScript recurrence engine in `src/lib/todos/` that defines to-do rule types and computes due dates. Rules are one-off or recurring (weekly / monthly / yearly) with multi-select days within each rule. Monthly supports days 1–31 (clamping to the last day of short months) plus "last day" and "last day − N"; yearly is mm/dd with Feb 29 skipped in non-leap years. Due dates never auto-advance — `nextOccurrence(rule, completionTime)` runs only at creation and check-off.

## Steps to Reproduce Context

1. A user wants to create a to-do that recurs weekly on Mon/Wed, monthly on the 31st, or yearly on 02-29.
2. Today no to-do domain exists: there is no `src/lib/todos/` module, no recurrence rule types, and no `isDueOn`/`nextOccurrence` functions anywhere in `src/`.

## Expected Behavior

- Rule types distinguish one-off to-dos from the three recurrence kinds (weekly / monthly / yearly), each with multi-select day support within the rule.
- Monthly day rules support 1–31 with clamping to the last day of short months, plus "last day" and "last day − N".
- Yearly rules are mm/dd, with Feb 29 skipped in non-leap years.
- `isDueOn` and `nextOccurrence` are pure functions with no I/O, network, wall-clock, or random-ID dependencies in command inputs.
- Rules are validated and day selections are deduplicated.

## Actual Behavior

No to-do or recurrence code exists. `src/lib/habits/calendar.ts` already provides the local-calendar primitives this can build on (noon-based date keys to avoid DST midnight issues, DST-safe `addLocalDays`, and leap-year-aware month bucketing), and `src/lib/habits/` plus `src/lib/habits/habits.test.ts` is the pure-engine + Vitest pattern to mirror — but there are no recurrence rule types or next-occurrence functions.

## Requirements for completed issue

1. Define pure TS types for one-off and recurring (weekly / monthly / yearly) to-do rules with multi-select day support, including monthly "last day" / "last day − N" and yearly mm/dd.
2. Implement `isDueOn` and `nextOccurrence` with documented clamp (monthly 1–31), skip (Feb 29 in non-leap years), validation, and dedup semantics. No auto-advance of due dates and no background processing anywhere.
3. Add heavy Vitest coverage in `src/lib/todos/` mirroring `src/lib/habits/habits.test.ts` — injected dates/ids, no hidden I/O.

## Context

- Files:
  - `src/lib/habits/` — the pure-engine pattern to mirror (`index.ts`, `calendar.ts`, `factories.ts`, `types.ts`), with Vitest coverage in `src/lib/habits/habits.test.ts`.
  - `src/lib/habits/calendar.ts` — reusable local-calendar math: `localDateAtNoon` (noon-based dates avoid midnight DST transitions), `addLocalDays` (DST-safe calendar-day shifts), `dayBucket`/`monthBucket` (leap-year-aware month bucketing).
  - `src/state/types.ts` — where shared domain types (e.g., `Habit`, `Task`) live.
- Code Snippets:

```
// src/lib/habits/calendar.ts — the local-date conventions the recurrence engine should follow
function localDateAtNoon(year: number, month: number, day: number): Date {
    return new Date(year, month, day, 12, 0, 0, 0);
}
export function addLocalDays(date: Date, days: number): Date {
    const [year, month, day] = localDateParts(date);
    const shifted = localDateAtNoon(year, month, day);
    shifted.setDate(shifted.getDate() + days);
    return shifted;
}
```

## Notes

- This is dependency slice #1 of the to-do list feature (issue #51); Issue B (schema + staged persistence) depends on these rule types.
- Must follow the AGENTS.md constraint: the engine in `src/lib/` has no I/O, network, wall-clock, or random-ID dependencies in command inputs.

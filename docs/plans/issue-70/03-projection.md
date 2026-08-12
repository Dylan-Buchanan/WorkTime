# Task: Apply the cutoff to projected finishes

## Classification

Type: T2: moderate date-boundary logic
Reasoning: A pure helper and one UI integration handle local calendar rollover and DST. Blast Radius=1, Uncertainty=2, Behavior=3, Testing=2, Reversibility=1. Total=9.

## Goal

Pause projected elapsed work at the configured cutoff and continue at local midnight on subsequent days.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/lib/projection.ts` | create |
| `src/components/TimerPanel.tsx` | update |

## Step-by-Step Instructions

### 1. Add a pure cutoff-aware date helper

**File:** `src/lib/projection.ts`

Implement `addProjectedDuration(start: Date, durationMs: number, endOfDay: string): Date`. Consume only time up to each local cutoff, roll with `setDate`/`setHours`, treat starts at/after cutoff as next-day midnight, and treat `00:00` as the following midnight.

### 2. Use it in TimerPanel

**File:** `src/components/TimerPanel.tsx`

Replace `new Date(Date.now() + totalMs)` with the helper using one captured current date and `settings.end_of_day`; keep workload totals and labels unchanged.

## Edge Cases to Handle

- Exact cutoff and after-cutoff starts.
- Multiple calendar-day rollovers.
- DST-short and DST-long days.
- Zero duration and midnight cutoff.

## Related Files (read-only context)

- `src/lib/timer.ts` — local date-key formatting.

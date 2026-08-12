# Overview

> **Issue:** #70
> **Classification Type:** T3
> **Severity:** Low

## Goal

Add a globally configurable end-of-day cutoff and make projected finish dates pause at that cutoff and resume at local midnight on the next calendar day.

## Approach

Persist `Settings.end_of_day` as a validated local `HH:mm` string with a `22:00` default. Migrate staged records to schema v5, normalize legacy remote settings on pull, add a time input to Settings, and route the existing projection duration through a pure local-calendar cutoff helper.

## Key Files

| File | Purpose |
| --- | --- |
| `src/lib/settings.ts` | Shared settings validation/defaulting |
| `src/lib/data/staging/types.ts` | v5 local record migration |
| `src/lib/data/SupabaseDataAccess.ts` | Legacy remote-row normalization |
| `src/components/SettingsPanel.tsx` | Editable end-of-day input |
| `src/lib/projection.ts` | Pure day-boundary calculation |
| `src/components/TimerPanel.tsx` | Apply cutoff to projected finish |

## Dependencies / Prerequisites

- Existing settings remain whole-row JSONB and use the current staged sync path.
- Local midnight is the resume boundary because issue 70 defines no start-of-day setting.

## Risks / Open Questions

- Local DST transitions must be handled with calendar setters, not fixed 24-hour increments.
- `00:00` is treated as the end of the calendar day (the following midnight), avoiding a zero-capacity day.

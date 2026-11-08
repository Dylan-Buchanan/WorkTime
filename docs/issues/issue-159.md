# Title: Epic: Waiting state and mid-window task switching

## Summary

A pomodoro task can stall because it is waiting on an agent or a person. Today the only way to keep tracking is to stop the timer and start another task, which loses the window. This epic makes a Work pomodoro a wall-clock window that tasks occupy as tenants, adds an orthogonal "waiting" fact to PM tasks, and adds a switch/waiting sheet on the timer page that hands the running clock to a follow-up task in two clicks.

The original brainstorm treated this as a single feature. It is seven dependent changes: the window model, status advancement, the waiting fact, its presentation, ranking, the sheet, and per-window log identity.

## Dependency order

```
1 window model ──► 7 log identity
      │
      └──► 6 picker sheet ◄── 5 ranking ◄── 3 waiting flag
                                             │
                                             └──► 4 waiting UI

2 status on start ── independent, feeds 6
```

## Sub-issues

- [ ] #173 — Task-agnostic pomodoro window and retirement of `inProgressPomodoros` (base; blocks #178 and #179)
- [ ] #174 — Advance PM status to In Progress on every work-start path (independent; feeds #178)
- [ ] #175 — `PMTask.waiting` as an orthogonal task fact (blocks #176 and #177)
- [ ] #176 — Waiting presentation across timer and lists (needs #175)
- [ ] #177 — Pure "what's next" ranking with one-per-tier promotion (needs #175; **blocked on #172**)
- [ ] #178 — Switch/Waiting sheet with live-clock handoff (needs #173, #174, #175, #176, #177)
- [ ] #179 — Per-window identity on pomodoro logs (needs #173)

## Corrected assumptions

Four assumptions in the original brainstorm were checked against the code and are wrong; the sub-issues are shaped around the corrected facts.

1. `SyncSnapshot` never carried `inProgressPomodoros`. The map is owner-local only, so merge prunes it in one place (`src/lib/data/sync/merge.ts:1173`) plus the scoped-full-wipe reset (`:1097`). The retirement is smaller than described.
2. `StateSyncBridge` already auto-links unlinked PM tasks in a background effect (`src/state/StateSyncBridge.tsx:198-267`), so the picker awaits that reconciler rather than reimplementing create/link.
3. `collectEligibleProjectionTasks` deliberately drops no-estimate tasks and is the documented shared contract (`src/lib/timer.ts:75-79`), so the ranking module gets its own collector.
4. `work_window_id` on logs is a real column across ~6 RPC insert sites, not a free optional field.

## Motivation

The waiting flow is only coherent if the window survives a switch. Conservation — one window always equals `work_minutes` across all occupants — is the property every other sub-issue depends on.

## Open questions

- Should the Agent/Person waiting type do anything beyond labelling (notifications, reminders)? Out of scope for this epic.
- Should the sheet be reused for pomodoro-end, break-end and idle-Today selection? Deliberately out of scope, but nothing in these issues should block it.

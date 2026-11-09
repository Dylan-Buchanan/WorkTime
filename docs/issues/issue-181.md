# Title: Leave and enter event plumbing

Part of #160. Depends on #180.

## Tags

Complexity Classification: T3
Classification Reason: Touches the central async state funnel in `src/state/AppStateContext.tsx` and every path that can switch, pause, stop or start a Work timer (`startTaskWork`'s direct `data.setActiveTask`, `ProjectManagerContext` create-then-restore, `useWindowHandoff`, `runProgression`'s break→work auto-start). The event contract is consumed by two later issues and the silence rules have to survive race-loser adoption, revision refreshes and reconciliation.

Severity: High
Severity Reason: Spurious or missing emits propagate directly into the capture form (#182) and the resume card (#183). A wrong emit can prompt mid-pomodoro-completion or interrupt pause/switch/End focus, which is the core interaction the app exists for.

Needs research before implementation: Yes

### Research Needed

The emit contract and its ordering are under-specified in this issue and must be pinned down before code is written, because #182 and #183 consume it.

- Decide where the before-state lives. `adoptResult` (`AppStateContext.tsx:260-270`) retains nothing, so either `adoptResult`/`adoptTaskTransition` gain a capture parameter or the wrappers capture `stateRef.current` themselves before calling them. Pick one and use it consistently.
- Freeze the event payload. #182 needs the outgoing task id and the pause timestamp to compare against a memo's `savedAt`, so a bare `{ taskId, reason, at }` pair must be shown to be sufficient or extended now rather than in #182.
- Decide whether leave/enter emits happen before or after the React state commit, and whether a listener firing during `runProgression`'s loop can re-enter a command.
- Trace the silent paths: first mounted snapshot, revision-bumped `refresh()`, `fetchAndSetState` race-loser adoption, and `runProgression`'s reconciliation branch. Confirm none of them can emit.
- Confirm that log-growth gating via `AppStateData.logs` (`src/state/types.ts:178`) is sufficient when `setActiveTask` delegates to `completeTimer` for a spent window (`src/lib/engine/taskCommands.ts:29-38`), because that path writes a log for the outgoing task and then opens no new timer.
- Confirm the ordering of the break→work auto-start emit against the preceding Work completion, so the consumer never sees a `break-end` enter for a task it has not yet finished leaving.

## Summary

Add a single publish/subscribe surface, owned by `AppStateContext`, that reports explicit intent to leave and enter a Work task:

- Leaving: `{ taskId, reason: "pause" | "stop" | "switch", at }`
- Entering: `{ taskId, reason: "resume" | "start" | "switch" | "break-end", at }`

State inference cannot do this job. `workOccupantKey` (`src/lib/pm/workStart.ts:17`) is deliberately stable across pause (`src/lib/engine/engine.test.ts:579-594` asserts it), and `runProgression` passes through `timer = null` before starting a break, so any occupant diff would fire on pomodoro completion — the one transition that must stay silent. Only the call sites know whether a departure was a pause, a stop, or a completion.

No UI in this issue. #182 and #183 subscribe.

## Steps to Reproduce Context

1. Start a Work pomodoro, then pause it. `workOccupantKey(timer)` is unchanged, so `StateSyncBridge` (`src/state/StateSyncBridge.tsx:94-123`) observes nothing.
2. Switch tasks mid-window: `adoptTaskTransition` (`AppStateContext.tsx:284-297`) adopts the new state and, if the window was spent, starts a break, but exposes no signal about which task was left or why.
3. Let a pomodoro run out: `runProgression` (`AppStateContext.tsx:175-195`) clears the Work timer, starts a break, and later starts work again, all without any observable transition.
4. Consequently there is no consumer-facing way to distinguish "the user paused", "the user ended focus", "the user switched", and "the pomodoro completed".

## Requirements for completed issue

1. `AppStateContext` owns exactly one publisher and exposes a subscribe API (a listener `Set` in the style of `subscribeTaskCompletions`, `AppStateContext.tsx:354-357`) that later components can use.
2. Leaving events carry `taskId`, `reason` (`"pause" | "stop" | "switch"`) and an `at` timestamp; entering events carry `taskId`, `reason` (`"resume" | "start" | "switch" | "break-end"`) and an `at` timestamp. The contract is documented in code because #182 and #183 depend on it.
3. Switch detection lives only in `adoptTaskTransition`, which is the single funnel for every switch, including `startTaskWork`'s direct `data.setActiveTask` (`AppStateContext.tsx:337`), `ProjectManagerContext.tsx:631` and `useWindowHandoff`.
4. Pause and stop capture the before-state in their wrappers (`pauseTimer` at `AppStateContext.tsx:358`, `stopWork` at `AppStateContext.tsx:315`), because `adoptResult` retains nothing.
5. Enter events originate from `resumeTimer`, `startWork`/`startTaskWork`, `adoptTaskTransition`'s switch branch, and the break→work auto-start inside `runProgression` (`AppStateContext.tsx:188-194`).
6. The first loaded snapshot never emits. Reuse the `undefined`-sentinel baseline pattern from `StateSyncBridge.tsx:104-115` rather than inventing epoch logic.
7. `finalizeTask` passes through `adoptTaskTransition` but clears the timer, so it emits nothing by construction. A test asserts this so a future refactor cannot quietly start prompting on completion.
8. A switch emits a leave only when the outgoing task actually gained a log entry: compare `AppStateData.logs` before and after, because `setActiveTask` only appends a row when `elapsed > 0` and delegates to `completeTimer` when the window is spent (`src/lib/engine/taskCommands.ts:29-38`). Empty switches and depleted handovers stay silent.
9. Pause followed by switch must not produce two leaving events for one departure. The publisher exposes the `at` timestamp so #182 can suppress the second prompt.
10. If `data.pauseTimer` throws, no leave is emitted, because `adoptResult(..., true)` rethrows before the paused state exists.
11. No component renders, reads a memo, or opens a sheet in this issue.

## Expected Behavior

- Pause a running Work timer → one leaving event with `reason: "pause"`.
- End focus on a running Work timer → one leaving event with `reason: "stop"`.
- Switch from a live Work task to another task that already logged elapsed time → one leaving event with `reason: "switch"` plus one entering event with `reason: "switch"`.
- Resume a paused timer → one entering event with `reason: "resume"`.
- Start work from idle → one entering event with `reason: "start"`.
- Break ends and work auto-starts → one entering event with `reason: "break-end"` and no leaving event for the break.
- A pomodoro running out naturally produces no leaving event at all.
- Reloading the app, adopting a revision refresh, or losing a progression race produces no events.

## Actual Behavior

- No publisher or subscriber exists; consumers can only infer state from `state.timer` and `active_task`, which cannot distinguish pause from completion or stop from switch.
- `adoptResult` discards the previous state, so no wrapper today can report what was left.

### Testing

1. `pnpm test:unit` passes, including new cases in `src/state/AppStateContext.test.tsx`.
2. A mounted provider with a live timer and a subscribed listener: pause → exactly one event, `reason: "pause"`; resume → exactly one, `reason: "resume"`.
3. Stop ("End focus") → one `stop`; starting work afterwards → one `start`.
4. Switch between two tasks after 3 minutes of elapsed work → one `switch` leave and one `switch` enter, and the leave's `at` is comparable to the pause timestamp used by #182.
5. Switch at `elapsed = 0` → no leave event.
6. Switch when the window is already spent (delegates to `completeTimer`) → no `switch` leave from the switch path; the completion path stays silent.
7. `finalizeTask` on a live task → zero events, asserted explicitly.
8. Mount with a live timer already present in the snapshot → zero events.
9. `pauseTimer` where `data.pauseTimer` rejects → zero events and the existing `error` state still surfaces.
10. Pause then switch, and assert the publisher reports the pause `at` so a consumer can suppress the duplicate.
11. `pnpm run build` passes and no existing engine test changes, since timer semantics are untouched.

## Issue Context

### New Files

None required; the event types may live in `src/state/AppStateContext.tsx` or a small `src/state/timerTransitions.ts`. If a new module is added, export the types through it rather than duplicating them in consumers.

### Remove Files

None.

### Change Files

#### Transition adoption

Code Source: `src/state/AppStateContext.tsx`, `adoptTaskTransition` lines 284-297

Code Description: Runs a switch command, adopts the resulting state, and starts a break when a Work window was spent during the transition.

```ts
const adoptTaskTransition = async (run: () => Promise<EngineResult<unknown>>) => {
    const before = stateRef.current;
    const result = await run();
    stateRef.current = result.state;
    setState(result.state);
    if (before?.timer?.kind === "Work" && !result.state.timer &&
        result.state.current_cycle_pomodoros > before.current_cycle_pomodoros) {
        await runProgression(undefined, {
            timer: { kind: "Work", taskId: before.timer.task_id, applied: true, windowId: windowStartedAt(before.timer) },
            state: result.state,
        });
    }
    return { ...result, state: stateRef.current ?? result.state };
};
```

Code Change Description: This is where the switch leave/enter pair is derived, using `before` for the outgoing task and the log-growth comparison for gating. Keep the existing progression call untouched.

Files Using: `setActiveTask` (L298), `finalizeTask` (L318), `startTaskWork` (L329-353), `useWindowHandoff`, `ProjectManagerContext.tsx:631`.

#### Commands that must emit

Code Source: `src/state/AppStateContext.tsx`

```ts
const stopWork = () => adoptResult(() => data.stopWorkTimer());
const finalizeTask = (id: string) => adoptResult(() => adoptTaskTransition(() => data.finalizeTask(id)));
const pauseTimer = async () => { if (stateRef.current?.timer && !stateRef.current.timer.paused) await adoptResult(() => data.pauseTimer(), true); };
const resumeTimer = async () => { if (stateRef.current?.timer?.paused) await adoptResult(() => data.resumeTimer(), true); };
```

Code Change Description: `stopWork` and `pauseTimer` capture the outgoing task id from `stateRef.current.timer` before awaiting, and emit only after the command resolves. `resumeTimer` emits an enter after success. `finalizeTask` emits nothing.

Files Using: `src/components/TimerPanel.tsx` (Pause, Resume, End focus, Start Focus buttons at L619-688).

#### Break→work auto-start

Code Source: `src/state/AppStateContext.tsx`, `runProgression` lines 188-194

```ts
} else if (after.active_task) {
    try {
        const started = await data.startWorkTimer();
        stateRef.current = started.state;
        setState(started.state);
    } catch (err: any) { setError(err?.message || err?.toString?.() || "Failed to start work timer"); }
}
```

Code Change Description: Emit the `break-end` enter after this succeeds, and only when the timer started is a Work timer for `after.active_task`.

#### Baseline sentinel pattern

Code Source: `src/state/StateSyncBridge.tsx` lines 94-115

```ts
const lastObservedOccupantRef = useRef<string | null | undefined>(undefined);
...
if (lastObservedOccupantRef.current === undefined) {
    // The first loaded snapshot is a baseline, not a new occupancy.
    lastObservedOccupantRef.current = key;
    return;
}
```

Code Description: Establishes the "first snapshot is a baseline" idiom used by the existing bridge.

Code Change Description: Reuse this idiom in the transition publisher so a cold load never emits.

#### State types available to the publisher

Code Source: `src/state/types.ts` lines 176-183

```ts
export interface AppStateData {
    tasks: Record<string, Task>;
    logs: PomodoroLogEntry[];
    settings: Settings;
    active_task: string | null;
    current_cycle_pomodoros: number;
    timer: ActiveTimer | null;
}
```

Code Description: `logs` is the append-only pomodoro log list used for the switch gating comparison.

## Notes

- `workOccupantKey` must not be used as the trigger for pause. It is stable across pause by design; see `src/lib/engine/engine.test.ts:579-594`.
- `src/lib/pm/workStart.ts:17`:

```ts
export function workOccupantKey(timer: ActiveTimer | null): string | null {
    return timer?.kind === "Work" ? `${timer.task_id}|${windowStartedAt(timer)}` : null;
}
```

- Keep emits out of `fetchAndSetState`, `refresh` and `runProgression`'s reconciliation branch; those are adoption paths, not user intent.

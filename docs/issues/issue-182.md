# Title: Exit memo capture form

Part of #160. Depends on #180 and #181.

## Tags

Complexity Classification: T2
Classification Reason: One new dialog component plus a mount/consumer wiring point and the store API from #180, modelled on `src/components/SwitchSheet.tsx`. The open/suppress ordering is the only genuinely new logic; focus trap, Escape handling and invoker refocus already have a reference implementation and test.

Severity: High
Severity Reason: This is the primary data-entry surface for the feature. A regression either loses what the user typed or blocks pause, End focus and switch behind a modal, both of which are worse than showing no prompt.

Needs research before implementation: Yes

### Research Needed

- Confirm where the sheet is mounted: a provider-level listener in the authenticated shell versus a component inside `TimerPanel`. The switch and End focus events both originate in `AppStateContext`, so the mount point has to survive route changes.
- Confirm the End focus capture point. `finalizeTask` clears the timer before the memo could be captured, so the form must key off the `stop` event from #181, not off task state.
- Trace every place that can open the sheet during a single departure and confirm a pause→memo→switch sequence cannot open a second prompt for the same task.
- Decide the exact `savedAt`/pause-`at` comparison used by the suppression rule, using the `at` timestamp #181 exposes.
- Confirm how a write failure from the store's quota path is surfaced without closing the sheet and losing the typed value.

## Summary

Add a modal capture form for exit memos, opened by the leaving events added in #181. It asks three single-line questions, all capped at about 140 characters:

- Where I am
- Next action
- Open question or blocker (optional)

Submitting writes the memo through the `#180` store. Dismissing saves nothing. The form is prefilled from the task's existing memo so a second exit is an edit rather than a rewrite.

The switch variant is two-sided: the outgoing task's form and the incoming task's existing memo (or a "starting fresh" line) in one frame, worded as a memo about the past — "What were you doing in *A*?".

Mutation-first ordering (the timer command commits, then the form opens) is what makes a strongly-encouraged-but-not-guaranteed capture defensible: abandoning the form never leaves the timer in a wrong state.

## Steps to Reproduce Context

1. Pause a live Work timer, or press End focus, or switch tasks.
2. #181 publishes the leaving event; nothing subscribes to it today.
3. There is no way to record where the work stood, so the next resume depends on memory.

## Requirements for completed issue

1. A modal component built to the interaction rules of `src/components/SwitchSheet.tsx`: capture the invoker element, focus the dialog on mount, trap Tab between focusable controls, close on Escape, and restore focus to the invoker on unmount.
2. The dialog uses `role="dialog"`, `aria-modal`, an `aria-labelledby` heading from `useId`, and a labelled full-screen backdrop button, matching `SwitchSheet`.
3. Three single-line fields (`whereIAm`, `nextAction`, optional `blocker`), each capped at ~140 characters, with the cap reflected in the store contract from #180.
4. Fields are prefilled from that task's existing memo when one exists.
5. Submit writes through the store; dismiss writes nothing and closes.
6. The sheet opens after pause commits, after End focus commits, and after a switch commits, driven by the #181 events.
7. The switch variant renders the outgoing form and the incoming task's existing memo (or a "starting fresh" line) in one frame, and words the outgoing prompt about the past.
8. Enter submits and Escape abandons. Escape must not be interpreted as submit.
9. One non-empty field is enough to save; an entirely empty submit is treated as abandon (no write).
10. Suppression rule for Pause → memo → Switch: if the outgoing task's `savedAt` is later than the moment the timer was paused, the switch form opens prefilled and does not ask again.
11. If the outgoing task is finalized or archived while the form is open, skip the write, since the memo would be orphaned.
12. If the window expires or a break starts underneath the open form, the form stays open and its write is still valid — it belongs to the outgoing task.
13. Two open tabs writing the same task: last writer wins by `savedAt`. This is documented behaviour, not a conflict UI.

## Expected Behavior

- Pause → form appears with any previous memo prefilled; submit saves and the next visit shows the new value; dismiss saves nothing.
- End focus → form appears for the task that was left.
- Switch → one frame shows "What were you doing in A?" alongside A's previous memo and B's current memo (or "starting fresh").
- Pause, answer, then switch → the switch frame is already prefilled from the just-saved memo and does not re-ask the same questions.
- Enter saves, Escape discards, Tab cycles within the dialog, and focus returns to whatever opened it.
- The timer state after any of these flows is exactly what it would have been without the form.

## Actual Behavior

- No form exists. The leaving events published by #181 have no subscriber, and nothing writes `worktime:resume:v1`.

### Testing

1. `pnpm test:unit` passes with a new `src/components/ResumeMemoSheet.test.tsx` modelled on `src/components/SwitchSheet.test.tsx`.
2. Render with a prefilled memo → inputs contain the existing values; submit → store mock receives the new values with a fresh `savedAt`.
3. Dismiss → no store call.
4. Empty submit → no store call and the sheet closes.
5. Single non-empty field → store call with the other fields empty.
6. `keyDown` Enter submits; `keyDown` Escape closes without submitting.
7. Focus trap: Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last; invoker regains focus on unmount.
8. Pause-then-switch suppression: outgoing memo `savedAt` later than the pause `at` → no second prompt, form opens prefilled and submits straight through.
9. Switch variant renders both task names and the incoming memo or the "starting fresh" line.
10. Task archived while open → submit performs no write.
11. 160-character input is stored at the 140-character cap.
12. Manual check in `pnpm dev` that the sheet opens over the timer panel, is usable at mobile width, and does not trap the app when dismissed.

## Issue Context

### New Files

`src/components/ResumeMemoSheet.tsx` — the dialog. Suggested props:

```ts
export interface ResumeMemoSheetProps {
    mode: "leave" | "switch";
    outgoing: { taskId: string; taskName: string; memo: ResumeNote | null };
    incoming?: { taskId: string; taskName: string; memo: ResumeNote | null };
    onSave: (taskId: string, input: { whereIAm: string; nextAction: string; blocker?: string }) => Promise<void>;
    onDismiss: () => void;
    error?: string | null;
}
```

`src/components/ResumeMemoSheet.test.tsx` — the tests listed above.

### Remove Files

None.

### Change Files

#### Interaction rules to copy

Code Source: `src/components/SwitchSheet.tsx` lines 67-88

```ts
useEffect(() => {
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
        if (event.key !== "Tab" || !dialog) return;
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), [tabindex="0"]'));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
            event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
            event.preventDefault(); first?.focus();
        }
    };
    document.addEventListener("keydown", onKey);
    return () => {
        document.removeEventListener("keydown", onKey);
        if (invoker?.isConnected) invoker.focus();
    };
}, []);
```

Code Description: Focus trap, Escape-to-close and invoker refocus for a modal sheet.

Code Change Description: Reuse the same shape, adding `input:not(:disabled)` to the selector so text fields participate in the Tab cycle, and wiring Enter to submit from any field.

Files Using: new `ResumeMemoSheet` mounted where the #181 subscription lives.

#### Visible action buttons that trigger the flow

Code Source: `src/components/TimerPanel.tsx` lines 619-688

Code Description: Pause, Resume, End focus and Start Focus buttons that call `pauseTimer`, `resumeTimer`, `stopWork` and `startWork` before the leaving event fires.

Code Change Description: None required if the sheet subscribes at the provider/shell level per #181; if the sheet is TimerPanel-local, this is the mount point.

#### Store write surface

Code Source: `src/lib/resume/resumeNoteStore.ts` (from #180)

Code Description: `saveResumeNote(taskId, { whereIAm, nextAction, blocker?, savedAt })` and the dismiss helper.

Code Change Description: The sheet calls save on submit with a fresh `savedAt`; dismiss does not call the store at all.

## Notes

- A very first memo on a gnarly task will chafe at 140 characters. That is an accepted constraint, not a bug; do not add an expanding textarea in this issue.
- Escape must remain "abandon", matching `SwitchSheet`, even though it saves nothing.
- "One current note per task" is by design: a second memo replaces the first, with no history.

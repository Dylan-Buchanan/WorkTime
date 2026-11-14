# Title: Overlay ownership for the global switch sheet

## Tags

Complexity Classification: T2
Classification Reason: Layering and document-level Escape arbitration across `SwitchSheet`, the new global host from #211, and the existing `z-40` overlays (PM dialogs, agent panel, mobile tasks drawer), including focus restore. The classes and handlers are small, but the interaction is cross-component and the focus behaviour is fragile to test.

Severity: Medium
Severity Reason: A double-dismiss closes both the sheet and the overlay beneath it, aborting a switch mid-handoff and dropping keyboard focus. Nothing is deleted or persisted wrongly, but it is a real accessibility and workflow regression once the sheet is hosted globally.

Needs research before implementation: Yes

### Research Needed

The sheet only coexists with other overlays once #211 moves it out of `TimerPanel`, so the exact co-residency set needs to be established rather than assumed. Confirm these before implementing:

- Which overlays can be open at the same time as the sheet: the PM dialogs at `ProjectManagerPage.tsx:204` and `:220`, `AgentPanel` at `:582`, and the mobile tasks drawer at `App.tsx:270`.
- Current keydown listener registration order and phase, and whether the sheet's `preventDefault` alone can stop a nested handler from also acting on the same Escape.
- Whether an Escape-ownership token or capture-phase handler is needed, or whether a single document-level "topmost layer closes" contract is enough.
- Whether the invoker element survives the pause/commit/re-render that #211 and #213 introduce, since focus restore is gated on `invoker?.isConnected`.
- What jsdom and Testing Library already cover for focus restore, so the new behaviour is testable at all.

## Summary

`SwitchSheet` is currently mounted inside `TimerPanel` (`src/components/TimerPanel.tsx:786`), so it never coexists with a PM drawer. Its root is `fixed inset-0 z-50` (`src/components/SwitchSheet.tsx:136`), while the PM dialogs (`src/components/ProjectManager/ProjectManagerPage.tsx:204,220`), the agent panel (`src/components/ProjectManager/AgentPanel.tsx:578,582`) and the mobile tasks drawer (`src/App.tsx:270`) all sit at `z-40`. The sheet's Escape handler is a document listener that only calls `preventDefault()` (`src/components/SwitchSheet.tsx:74-86`), and focus restore is skipped entirely when `invoker?.isConnected` is false (`:89`).

Once #211 hosts the sheet globally, it can open over surfaces that own their own overlays and document-level key handlers. This issue settles the ownership rules: the sheet wins the stacking order by default, one Escape closes exactly one layer, and focus restore still works when the invoker has been unmounted by the very commit that opened the sheet.

This is issue 5 of 5 and requires #210. It can proceed in parallel with #211, #212 and #213, but is only observable once #211 hosts the sheet globally.

## Steps to Reproduce Context

1. Apply #211 so the single `SwitchSheet` is mounted above the route shell instead of inside `TimerPanel`.
2. Open a PM drawer or the agent panel (`z-40`) and then open the switch sheet (`z-50`).
3. Press Escape once.
4. Observe: the sheet's document handler calls `preventDefault()` but does not stop propagation, so a nested document-level handler can also react, and there is no defined rule for which layer closes.
5. Complete the occupant so the invoker unmounts while the sheet is open, then close the sheet.
6. Observe: nothing receives focus, because focus restore is skipped when `invoker?.isConnected` is false.

## Requirements for completed issue

1. The global switch sheet renders above the `z-40` overlays by default; the chosen stacking is explicit rather than two independent `z-50`/`z-40` literals that happen to differ.
2. One Escape closes exactly one layer: opening the sheet over an open overlay and pressing Escape once closes the sheet only, leaving the overlay open.
3. The sheet's Escape handling stops the event from also dismissing the layer beneath it.
4. Focus restore works when the invoker is still mounted (today's behaviour) and when it has been unmounted: focus returns to a defined, stable target instead of being dropped.
5. Two nested overlays each restoring focus do not fight; the layer that closes last is the one that restores.
6. The sheet can be opened from a route where the timer is not visible, and closes and restores focus correctly there.
7. PM drawer, agent panel, mobile tasks drawer and the `ProjectsSidebar` listbox Escape handling keep working as they do today when the sheet is not open.
8. The existing memo-hold release on unmount still happens exactly once regardless of how the sheet closes.

## Expected Behavior

- The switch sheet is always the visible top layer while it is open.
- One Escape press closes only the topmost layer.
- Closing the sheet returns focus to the control that opened it when it still exists, and to a sensible fallback otherwise.
- The mobile tasks drawer and PM overlays continue to behave as they do today.
- Closing the sheet by backdrop click, Close button or Escape all release the memo hold and restore focus consistently.

## Actual Behavior

- The sheet is `z-50` and the other overlays are `z-40`; nothing states that ordering as a rule, and the sheet has no notion of a layer beneath it.
- The Escape handler only calls `event.preventDefault()` (`src/components/SwitchSheet.tsx:75`), so propagation is not stopped.
- Focus restore is conditional on `invoker?.isConnected` (`src/components/SwitchSheet.tsx:89`), so an unmounted invoker silently loses focus.

### Testing

- `pnpm test:unit` with new cases in `src/components/SwitchSheet.test.tsx`:
  - Escape while the sheet is open closes the sheet and calls `preventDefault`/`stopPropagation` such that a document-level handler registered by an underlying overlay does not fire.
  - focus returns to the invoker when it is still connected.
  - focus returns to the documented fallback when the invoker is removed from the DOM before close.
  - closing by backdrop, Close button and Escape each release the memo hold exactly once.
  - the sheet renders correctly and closes when no timer is present in the surrounding state.
- Overlay co-residency tests where practical: sheet over the PM dialog / mobile drawer closes only the sheet; the underlying handler still works when the sheet is closed.
- Manual verification with the PM drawer and agent panel open, since jsdom does not model stacking contexts.
- `pnpm run build` passes.

## Issue Context

### Change Files

#### `src/components/SwitchSheet.tsx` — Escape ownership and focus restore

Code Source: `src/components/SwitchSheet.tsx:69-92`
Code Description: On mount the sheet takes a memo hold, stores `document.activeElement` as `invoker`, focuses the dialog, and registers a document `keydown` listener that handles Escape with `preventDefault()` and traps Tab. On cleanup it removes the listener, focuses the invoker only when `invoker?.isConnected`, and releases the memo hold.
Code Change Description: Make Escape close exactly one layer by stopping propagation (or by claiming ownership of the event for this layer), and add a fallback focus target for when the invoker has unmounted. Keep the memo-hold release on the single cleanup path.

```tsx
const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
    if (event.key !== "Tab" || !dialog) return;
    // ...focus trap
};
document.addEventListener("keydown", onKey);
return () => {
    document.removeEventListener("keydown", onKey);
    if (invoker?.isConnected) invoker.focus();
    releaseMemoPresentation?.();
};
```

#### `src/components/SwitchSheet.tsx` — stacking order

Code Source: `src/components/SwitchSheet.tsx:136`
Code Description: The sheet root is `fixed inset-0 z-50 flex items-center justify-center p-4` with `role="dialog"` and `aria-modal="true"`.
Code Change Description: State the sheet's stacking position explicitly relative to the `z-40` overlay tier, and keep the backdrop inside the sheet's own layer so it cannot visually cover the sheet.

```tsx
return <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={headingId}>
```

#### `src/components/ProjectManager/ProjectManagerPage.tsx`, `src/components/ProjectManager/AgentPanel.tsx`, `src/App.tsx` — the `z-40` tier

Code Source: `ProjectManagerPage.tsx:204,220` (`fixed inset-0 z-40` dialogs), `AgentPanel.tsx:578,582` (`z-40` launcher and panel), `App.tsx:270` (`fixed inset-0 z-40` tasks drawer)
Code Description: These are the overlays the sheet can now open above.
Code Change Description: Expected to need no change beyond confirming they stay in the lower tier; do not raise any of them above the sheet.

#### `src/components/ProjectManager/ProjectsSidebar.tsx` — unchanged local Escape

Code Source: `src/components/ProjectManager/ProjectsSidebar.tsx:58-62`
Code Description: A component-local `onKeyDown` on the listbox button that closes the listbox on Escape.
Code Change Description: None. Listed so the implementation verifies the local handler is unaffected and does not need to join a global stack.

## Notes

- Dependencies: #210. Only observable once #211 hosts the sheet globally; jsdom cannot validate stacking, so include a manual check.
- Two overlays restoring focus must not fight; the contract is that the layer closing last restores focus.
- Deliberately out of scope: a general overlay/layer-manager utility, adding Escape handling to the mobile tasks drawer, and any visual redesign of the sheet.

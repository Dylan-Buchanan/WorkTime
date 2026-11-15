# Title: Hide the Today / This week projections and the Today work view on the timer page

## Tags

Complexity Classification: T1
Classification Reason: An additive, self-contained UI preference that follows an already-documented pattern rather than inventing one. The change surface is a new pure storage preference module under `src/lib/` mirroring `src/lib/theme/themePreference.ts` and `src/lib/sound/soundPreference.ts` (injectable storage, frozen defaults, listeners, `create…Store`, and a matching hook), one unit test for that module, two conditional wraps plus a small toggle row in `src/components/TimerPanel.tsx`, additions to `src/components/TimerPanel.test.tsx`, and one allow-list entry in `AGENTS.md`. Both `TimerPanel` mount points in `src/App.tsx` stay consistent because the preference lives in a module-level store, so no other consumer is touched.

Severity: Low
Severity Reason: Purely cosmetic visibility preference on one page. It is off-path for timer/task semantics, the default preserves today's behavior exactly, and no synced data, auth, notification, or engine behavior is involved. A bug at worst hides or shows a card and is recoverable by toggling it or clearing the key.

Needs research before implementation: No

## Summary

The timer page (`/`) renders two large blocks below the timer ring and its action buttons, inside `src/components/TimerPanel.tsx`:

1. The projection card — `<ProjectionSwitcher projections={finishProjections} />` (line 896-898), which shows a "Today" / "This week" range switcher and a `ProjectionCard` with the projected finish time.
2. The Today work view — `<TodaySurface onSelectTask={selectTaskFromToday} />` (line 899), a collapsible `<section aria-label="Today">` in `src/components/TodaySurface.tsx` listing Tasks, To-dos, Done today, Habits and Pomodoros.

There is currently no way to hide either of them, so a user who only wants the timer has to scroll past both on every visit. This issue adds two independent controls on the timer page that hide each block, and stores the choice as a browser-specific (surface-local) preference so it survives reloads, restarts and app updates without ever being synced.

## Steps to Reproduce Context

1. Sign in and open the timer page (`/`).
2. In timer mode, scroll below the Focus progress strip: the "Today / This week" projected-finish card and the Today work view are always rendered.
3. Notice there is no control anywhere on the timer page (or in the sidebar Settings panel) that hides either block.

## Requirements for completed issue

1. Two independent controls on the timer page (timer mode) hide the "Today / This week" projected-finish card and the Today work view respectively; each can be hidden without hiding the other.
2. The choice is stored per browser / Tauri webview and survives reload, app restart, signing out and back in, and route changes. It is browser-global, not per-owner.
3. A browser with no stored choice shows both blocks, exactly as today.
4. The stored choice never reaches synced or shared persistence: not `Settings` / `settings.data`, not the `worktime:staging:v1:*` staging store, not Supabase, not `pm_state_v1`.
5. The persistence follows the existing surface-local preference conventions: a single versioned `worktime:*` key, guarded reads/writes that fall back to the default when storage is blocked or the payload is malformed, and an allow-list entry in `AGENTS.md`.
6. Toggling applies immediately without a reload and both timer page layouts (desktop `main` and the mobile layout, both in `src/App.tsx`) show the same state.
7. A hidden block is fully absent — no empty container, no leftover heading, no reserved gap — and the remaining timer page content keeps its current layout and ordering.
8. Only the two blocks above are hideable. The aging to-dos banner, timer ring, kind/waiting/project badges, task details toggle, resume card, energy chip, action buttons, Focus progress strip and the Timer / Quick add mode switch are unaffected.
9. Quick add mode is unchanged.
10. Existing behavior is unchanged: projection computation and the projection switcher's own Today/This week selection, and `TodaySurface`'s own expanded/collapsed and "Done today" state.

## Expected Behavior

- A user who hides the projection card and the Today work view sees only the mode switch, timer ring, badges, actions and Focus progress strip on the timer page.
- Reloading the page, restarting the app, or switching to another route and back keeps both blocks hidden.
- Re-enabling either control brings that block back immediately at its normal place on the page.
- A fresh browser profile shows both blocks.
- Nothing about the preference appears in synced settings, and a second device/browser keeps its own choice.

## Actual Behavior

- `ProjectionSwitcher` and `TodaySurface` are rendered unconditionally in `TimerPanel` (lines 896-899), so both are always visible on the timer page.
- No preference, store, or control exists for their visibility.

### Testing

1. Unit tests for the new preference module: default is "both visible"; setting one value round-trips and leaves the other untouched; setting both persists; malformed JSON and a missing key both fall back to the default; throwing/blocked storage still applies the change in memory and does not throw; subscribers are notified on change and stop being notified after unsubscribe; a reset/clear restores the default; and it writes only its own `worktime:*` key (mirror the `OTHER_KEYS` assertion style in `src/lib/todos/agingTodoDismissals.test.ts` and `src/lib/theme/themePreference.test.ts`).
2. `src/components/TimerPanel.test.tsx`: with both visible (default), the existing projection and Today assertions still pass. Hiding the projections removes the "Projection range" switcher and the projected-finish label while the `Today` region remains; hiding the Today view removes the `Today` region while the projection card remains; hiding both leaves neither; toggling back restores each.
3. A persistence test: hide both, unmount and re-render `TimerPanel` (with `localStorage` seeded by the earlier interaction), and confirm both stay hidden.
4. A regression test: hiding the two blocks leaves the aging to-dos banner, the Focus progress strip and the Timer / Quick add mode switch intact.
5. `pnpm test:unit` passes, plus `pnpm run build`.

## Issue Context

### New Files

A surface-local preference module for the two timer-page visibility flags, e.g. `src/lib/timerPage/timerPanelVisibility.ts` and `src/lib/timerPage/timerPanelVisibility.test.ts`, plus a hook such as `src/hooks/useTimerPanelVisibility.ts`. Exact location and naming are up to the implementer, but note that `src/lib/timer.ts` already exists as a file, so a `src/lib/timer/` directory would be confusing — pick a distinct folder name.

The module should mirror `src/lib/sound/soundPreference.ts` (JSON value with strict validation) or `src/lib/theme/themePreference.ts` (plain value), and needs at minimum:

- a storage key constant, e.g. `export const TIMER_PANEL_VISIBILITY_STORAGE_KEY = "worktime:timer-panels:v1";`
- a frozen default where both blocks are visible;
- a validated read that falls back to the default on missing/malformed data or blocked storage;
- `get…`, `set…`, `clear…`, `subscribeTo…(listener): () => void`;
- a `create…Store(storage)` factory taking an injectable `StorageLike` (`Pick<Storage, "getItem" | "setItem" | "removeItem">`) for tests.

Document on the module, as the theme and sound modules do, that the value is surface-local: it must not be synced, added to `Settings`, or written to the staging store.

### Remove Files

None.

### Change Files

#### Timer page hide controls and render guards

Code Source: `src/components/TimerPanel.tsx`

Code Description: The mode row is the natural anchor for the inline controls (timer mode is the only mode that renders the two blocks):

```tsx
<div className="flex w-full items-center justify-between gap-3">
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-neutral-900/80 p-0.5 ring-1 ring-inset ring-neutral-500/10" aria-label="Timer page mode">
        {/* Timer / Quick add buttons, lines ~694-714 */}
    </div>
    {timerPageMode === "quick-add" && timer && (
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-neutral-400" aria-label="Time remaining">
            {formatMs(ms)}
        </span>
    )}
</div>
```

and the two blocks render unconditionally at the end of timer mode:

```tsx
{finishProjections && (
    <ProjectionSwitcher projections={finishProjections} />
)}
<TodaySurface onSelectTask={selectTaskFromToday} />
```

Code Change Description: Read the preference through the new hook (or `useSyncExternalStore` over the store, matching how `timerPageMode` is already consumed at line 259), add two labelled toggle controls in the mode row or directly above the two blocks, and guard each render behind its flag. Keep the existing `finishProjections &&` guard wrapper. The controls must be keyboard reachable and clearly labelled (e.g. "Hide projections" / "Show projections", "Hide Today view" / "Show Today view"), must stay usable at mobile widths, and must reflect the stored state on mount.

`src/components/Switch.tsx` (`role="switch"`, `aria-checked`, label + description) already exists and is the pattern used by the Settings panel; a compact inline variant or an `aria-pressed` icon button next to the mode switch are both acceptable.

Files Using: `src/components/TimerPanel.test.tsx`, `src/App.tsx` (`MainLayout` renders `TimerPanel` at lines 264 and 282).

#### Shared state across timer page mount points

Code Source: `src/App.tsx` (`MainLayout`, lines 249-303)

Code Description: `TimerPanel` is rendered twice — desktop `<main>` (line 264) and the mobile layout (line 282).

Code Change Description: No structural change expected. Because the preference lives in a module-level store backed by `localStorage`, both layouts agree. Do not pass the visibility flags down as props and do not add per-instance state. Do not add an owner-change reset (unlike `resetQuickAddSession()` at line 160): theme and sound preferences are browser-global and are not reset on owner change, and this one should follow them.

#### Surface-local key documentation

Code Source: `AGENTS.md` (line 24) and `docs/FEATURES.md`

Code Description: `AGENTS.md` keeps an explicit allow-list of surface-local localStorage exceptions (`worktime:theme:v1`, `worktime:resume:v1`, `worktime:sound:v1`, `worktime:todo-banner:v1`, the agent snapshot/start-of-day keys, and the staging store).

Code Change Description: Add the new key to that allow-list sentence, stating that it is the scoped timer-page layout exception, implemented in the new module, and that it must not be synced, added to `Settings`, or written to the staging store. Optionally add a bullet to `docs/FEATURES.md` describing the timer-page visibility controls.

#### Reference pattern

Code Source: `src/lib/sound/soundPreference.ts`

Code Description: JSON-valued surface preference: `SOUND_PREFERENCE_STORAGE_KEY`, a frozen `DEFAULT_SOUND_PREFERENCE`, an `isSoundPreference` guard with exact-shape validation, `readPreference` wrapped in `try/catch`, `createSoundPreferenceStore(storage)` returning `{ get, set, clear, subscribe }`, a lazily created module singleton, and thin exported wrappers.

```ts
let surfaceStore: SoundPreferenceStore | undefined;

function getSurfaceStore(): SoundPreferenceStore {
    // Read once so a failed write cannot replace the active mix with stale storage.
    return surfaceStore ??= createSoundPreferenceStore(defaultStorage());
}
```

Code Change Description: Follow this shape for the new module. `src/hooks/useSoundPreference.ts` shows the matching hook (`useState`, subscribe in an effect, re-read after subscribing).

Files Using: `src/components/SettingsPanel.tsx` (consumer of the theme/sound equivalents).

## Notes

- The preference is a pair of booleans, so a single key holding a JSON object (e.g. `{ "projections": true, "today": true }`) is preferred over two keys; validation must reject unknown shapes and fall back to both-visible rather than partially applying.
- Nothing in `e2e/` asserts the projection card or the `Today` region, so no Playwright changes are expected; unit tests in `src/components/TimerPanel.test.tsx` are the primary coverage (see existing tests near lines 690-770 and 894-904).
- `ProjectionSwitcher`'s internal `scope` state and `TodaySurface`'s internal `expanded`/`doneOpen` state are unrelated to this preference and should keep their current behavior when the blocks are shown.

# Title: Add sound settings with a master mute and per-sound toggles

## Tags

Complexity Classification: T2
Classification Reason: Additive, cross-module feature. It adds a pure surface-local preference store modeled on `src/lib/theme/themePreference.ts`, a thin hook mirroring `src/hooks/useThemePreference.ts`, a generic `Switch` primitive, a new Settings section, and one gating check inside the shared `play()` entry point introduced by the prerequisite refactor, plus docs and tests. Blast radius reaches every sound consumer, but the gate lives in one place and there is no synced data model, schema, auth, or infra change.

Severity: Low
Severity Reason: Net-new user-facing capability rather than a defect. Defaults preserve today's audible behavior, the preference is device-local with no data-loss or security surface, and storage failures degrade to an in-memory preference. Worst case is a sound that is silent until the user re-enables it.

Needs research before implementation: No

## Summary

Every sound in WorkTime is currently unconditional. `src/hooks/useSounds.ts` exposes `play(key)` with no gating, and `useSounds()` is instantiated in eight places. Hover audio fires on nearly every nav link and sidebar item (`src/App.tsx` L214–222), so a user who finds it irritating has no recourse short of muting the operating system.

Add a collapsible **Sound** section to the Settings panel with one master on/off toggle and one toggle per sound effect: Hover, Button press, Pomodoro start, Pomodoro finished, Break over, Task complete. The preference is stored only on this surface (`worktime:sound:v1`) and gates playback centrally so every current and future sound inherits it.

This issue depends on the prerequisite refactor that extracts the shared audio pool; it does not re-implement that pool.

## Steps to Reproduce Context

1. Open the app and expand Settings (`src/components/SettingsPanel.tsx`). Sections are Appearance (`L58–90`), Base settings (`L91–117`), Day hour settings (`L118–143`), and Agent API key (`L144+`).
2. There is no section that controls audio.
3. Hover a top-nav link (`src/App.tsx` L214–222) or a sidebar item — `hover` plays unconditionally. Press a nav link or sidebar button — `pressSide` plays. Complete a pomodoro or a break — `pomodoroFinish` / `breakOver` play from `src/state/AppStateContext.tsx` L226.
4. No control anywhere disables a single sound or all sounds.

## Requirements for completed issue

1. A surface-local preference keyed `worktime:sound:v1` is implemented in `src/lib/sound/` and shaped like `src/lib/theme/themePreference.ts`: get, set, clear, subscribe, an isolated store factory for tests, and an explicit default of everything on.
2. Invalid or corrupt stored values fall back to all-on, `set` rejects unsupported shapes, and storage read/write errors are swallowed so the in-memory value still applies for the session.
3. The preference is device-scoped: it never reaches `settings.data`, is never added to `Settings`, and is never written to the staging store. `AGENTS.md` L23 documents `worktime:sound:v1` as a surface-local exception using the same wording as `worktime:theme:v1` and `worktime:resume:v1`.
4. The shared pool's `play()` reads the preference synchronously at call time and returns without playing when the master is off or that sound is off. All eight call sites inherit the gate with no per-site changes.
5. `useSounds()` keeps its public API (`{ play }`), and a new `src/hooks/useSoundPreference.ts` mirrors `useThemePreference`: initialize state from the getter, subscribe on mount, expose a setter callback.
6. A generic `src/components/Switch.tsx` exposes `role="switch"`, `aria-checked`, an accessible label, an optional description slot, and a disabled state. It is used only by the Sound section; existing checkboxes and theme radios are left as they are.
7. A fifth collapsible section named `Sound` sits after Appearance in `SettingsPanel.tsx`, using the existing `<section>` + `<button aria-expanded aria-controls>` + `<div id hidden>` pattern and `expandedSections.sound`. The header stays a single plain button.
8. The master toggle is the first row inside the section body, not in the collapsed header. The six per-sound rows follow in this order and map to these `SoundKey` values: Hover → `hover`, Button press → `pressSide`, Pomodoro start → `startPomodoro`, Pomodoro finished → `pomodoroFinish`, Break over → `breakOver`, Task complete → `completeTask`.
9. Soft master behavior: turning the master off mutes every sound and visually dims the six rows, but leaves the rows editable and preserves each row's value. Turning the master back on restores the exact mix the user had configured.
10. Previews: enabling an individual row previews that sound once; turning the master on previews `pressSide` once; changing a row while the master is off stores silently with no preview.
11. Instant apply: no Save button and no draft/Save flow for this section, and no descriptive copy text. No volume control, no new sounds, no removal of `hover` / `pressSide`, and no cross-tab `storage` listener.
12. "Reset All Data" (`resetAll` in `src/components/SettingsPanel.tsx` L22) leaves the sound preference untouched, exactly as it leaves the theme preference untouched.
13. Unit tests cover the store (default, round-trip, corrupt values, clear, subscribe, isolated store), the hook, the Switch primitive, and SettingsPanel behavior (mute silences playback, per-sound off silences only that sound, rows remain editable while muted, previews fire only on the specified transitions).

## Expected Behavior

- The Settings panel shows a `Sound` section after Appearance and starts collapsed, consistent with the other sections.
- Turning the master off silences every app sound immediately; turning it on restores the previous per-sound mix.
- Disabling an individual sound silences only that sound everywhere it is fired, including nav hover, nav/sidebar press, pomodoro start, pomodoro finish, break over, and task complete.
- The mix persists across reloads on the same browser or Tauri webview, and a different machine or browser keeps its own mix.
- Rows stay editable while muted, show their stored state, and produce no sound until the master is back on.
- Enabling a row previews that sound once so the user can identify it; any other change while unmuted has no preview.
- Reset All Data does not change the sound mix.
- Desktop notification sounds are unaffected — they belong to the operating system.

## Actual Behavior

- No sound preference exists; `play()` in `src/hooks/useSounds.ts` L40–47 always plays.
- Hover audio fires on every nav link and sidebar item with no way to disable it short of muting the OS.
- The Settings panel has no audio section at all.

### Testing

- `pnpm test:unit` — new `src/lib/sound/soundPreference.test.ts` using the `createFakeStorage` helper pattern from `src/lib/theme/themePreference.test.ts`; new `src/components/Switch.test.tsx`; new hook tests; updated `src/components/SettingsPanel.test.tsx` covering the mute and per-sound behavior.
- Update `src/components/SettingsPanel.test.tsx` L208–231: the collapsed-section name list `["Appearance", "Base settings", "Day hour settings", "Agent API key"]` must include `Sound`.
- Manual check that `localStorage` contains only `worktime:sound:v1` for this feature and that no synced settings payload gains a sound field.
- Manual check across two browser profiles or a browser plus the Tauri webview: each surface keeps its own mix.
- Manual check that Reset All Data leaves the mix intact.

## Issue Context

### New Files

#### `src/lib/sound/soundPreference.ts`

Pure surface-local store, modeled on `src/lib/theme/themePreference.ts`. Suggested public surface:

```ts
import type { SoundKey } from "../../hooks/useSounds";

export const SOUND_PREFERENCE_STORAGE_KEY = "worktime:sound:v1";
export const SOUND_KEYS = [
    "hover",
    "pressSide",
    "startPomodoro",
    "pomodoroFinish",
    "breakOver",
    "completeTask",
] as const satisfies readonly SoundKey[];

export interface SoundPreference {
    master: boolean;
    enabled: Record<SoundKey, boolean>;
}

export const DEFAULT_SOUND_PREFERENCE: SoundPreference; // master: true, all six: true

export function getSoundPreference(storage?: StorageLike): SoundPreference;
export function setSoundPreference(next: SoundPreference, storage?: StorageLike): SoundPreference;
export function clearSoundPreference(storage?: StorageLike): SoundPreference;
export function subscribeToSoundPreference(listener: (preference: SoundPreference) => void): () => void;
export function isSoundEnabled(key: SoundKey, preference?: SoundPreference): boolean;
export function createSoundPreferenceStore(storage: StorageLike): SoundPreferenceStore;
```

Mirror the theme module's details: module-level in-memory value plus a `Set` of listeners, `defaultStorage()` guarded by `try`, a validity check applied on read, `set` throwing on unsupported input, and `try/catch` around `getItem`/`setItem`/`removeItem` so storage failures never break the session.

#### `src/lib/sound/index.ts`

Barrel re-exporting the module's public API and types, matching `src/lib/theme/index.ts` and `src/lib/resume/index.ts`.

#### `src/lib/sound/soundPreference.test.ts`

Cover default (everything on), round-trip of a master-off and per-sound-off mix, corrupt/invalid stored values falling back to all-on, clear, subscribe/unsubscribe, and the isolated store factory.

#### `src/hooks/useSoundPreference.ts`

```ts
export interface SoundPreferenceState {
    preference: SoundPreference;
    setPreference: (next: SoundPreference) => void;
}
```

Mirror `src/hooks/useThemePreference.ts`: `useState(() => getSoundPreference())`, `useEffect(() => subscribeToSoundPreference(setState), [])`, and a stable setter callback.

#### `src/components/Switch.tsx`

```tsx
interface SwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    description?: string;
    disabled?: boolean;
}
```

Render a `role="switch"` control with `aria-checked`, the label wired to the control, and the optional description. No other consumer yet.

### Remove Files

None.

### Change Files

#### Playback gate

Code Source: `src/hooks/useSounds.ts` (current) and the shared pool module from the prerequisite issue
Code Description: `play(key, { interrupt = true } = {})` currently resets `currentTime` and calls `a.play().catch(() => {})` with no gating.
Code Change Description: Read `getSoundPreference()` synchronously inside the pool's `play` and return early unless `master` is on and `enabled[key]` is true. Keep `interrupt` and the swallowed rejection behavior. No call site changes.

#### Settings panel

Code Source: `src/components/SettingsPanel.tsx` L22–23, L33–34, L59–90, L91–117, L118–143, L144+
Code Description: The component destructures `{ state, updateSettings, resetAll }` and `{ play }`, keeps `expandedSections` as `Record<string, boolean>` with `toggleSection`, and renders each section as a `<section>` with a single header `<button aria-expanded aria-controls>` plus a `<div id="settings-<name>-content" hidden={...}>`. Appearance (`L58–90`) is the structural reference for a preferences section, showing the header button markup:

```tsx
<section className="rounded-md border border-neutral-800 bg-neutral-900/30">
    <button type="button" aria-expanded={Boolean(expandedSections.appearance)} aria-controls="settings-appearance-content" onClick={() => toggleSection("appearance")} className="flex w-full items-center gap-2 px-2 py-2 text-left text-[11px] font-medium text-neutral-300 hover:bg-neutral-800/40">
        {expandedSections.appearance ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span>Appearance</span>
    </button>
    <div id="settings-appearance-content" hidden={!expandedSections.appearance} className="space-y-2 p-2">...</div>
</section>
```

Code Change Description: Insert a `sound` section between Appearance and Base settings with the same markup shape, wire it to `useSoundPreference()`, and use `play` for the previews. Dim the six rows when the master is off (for example `opacity`/muted text) without setting `disabled`. Do not touch `local` draft state, the Save button, or `resetAll`.

#### Section test

Code Source: `src/components/SettingsPanel.test.tsx` L208–231
Code Description: Asserts `const names = ["Appearance", "Base settings", "Day hour settings", "Agent API key"]` all start collapsed, toggle independently, and reset on remount.
Code Change Description: Add `Sound` to that list and add assertions for the new behavior. The suite mocks `../hooks/useSounds` with `{ play: () => {} }` (`L18–19`), so playback assertions need their own seam (for example a spy on the mocked `play` or a mocked preference module).

#### Repository guidance

Code Source: `AGENTS.md` L23
Code Description: Enumerates surface-local exceptions — the staging store, agent snapshot/handoff keys, `worktime:theme:v1` (`src/lib/theme/`), and `worktime:resume:v1` (`src/lib/resume/`), each with "must not be synced, added to `Settings`, or written to the staging store."
Code Change Description: Add `worktime:sound:v1` (`src/lib/sound/`) to that sentence with the same constraint wording.

### Files Using

Sound consumers that inherit the gate without edits: `src/App.tsx` L195, `src/components/SettingsPanel.tsx` L23, `src/components/TaskPanel.tsx` L38, `src/components/TimerPanel.tsx` L243, `src/components/TodaySurface.tsx` L113, `src/components/TodosPage.tsx` L163, `src/components/ProjectManager/ProjectsSidebar.tsx` L134, `src/state/AppStateContext.tsx` L124–125.

Assets (unchanged): `src/assets/audio/{hover-sound,press-sidepanel-button,start-pomodoro,pomodoro-finished,break-over,complete-task}.mp3`.

## Notes

- Depends on the prerequisite issue that extracts the shared audio pool from `useSounds`. Land that first; this issue adds storage, gating, and UI on top of it.
- Out of scope: volume control, new sounds, removing `hover` or `pressSide`, a hover throttle, a quick-mute control outside Settings, a cross-tab `storage` listener, and any explanation of desktop notification sounds.
- Desktop notifications (`notifyNow` / the notification setup in `src/state/AppStateContext.tsx`) are an OS-level system with their own sound; the six toggles do not affect them, and the section deliberately carries no explanatory copy.
- Sound is a device preference, so it is deliberately excluded from the synced `Settings` object and from Reset All Data, matching `worktime:theme:v1`.

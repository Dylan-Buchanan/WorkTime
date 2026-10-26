# Title: Number inputs show unstyled native up/down spinner boxes

## Tags

Complexity Classification: T1
Classification Reason: Styling-only change over a fully enumerated surface — `src/index.css` plus the six components that render `type="number"` inputs. No state, engine, data, or auth logic is touched, and the change is instantly reversible.

Severity: Low
Severity Reason: Cosmetic polish only. The spinner boxes are functional but visually clash with the app's dark theme; no data, timer, or auth paths are involved.

Needs research before implementation: No

## Summary

Every `type="number"` input in the app renders the browser's default native spinner buttons. In the dark theme those arrows appear as light/white boxes with no styling, which looks broken and inconsistent with the app's neutral/indigo input styling. This affects several places, including the pomodoro estimate input in the timer's task panel.

The issue is to locate every one of these instances and give them a UI style proper to the app by hiding the native spinner chrome through one shared utility in `src/index.css`, so the fix applies app-wide and future number inputs inherit it.

## Steps to Reproduce Context

1. Open the timer view and look at the task panel on the left (`src/components/TaskPanel.tsx`), next to "Task name".
2. Hover the pomodoro estimate input.
3. The native up/down spinner appears as light/white boxes that do not match the dark input styling.
4. Repeat for the project manager task inspector estimate field, settings numeric fields, the to-do estimate field, the to-do yearly schedule day field, and the pet training duration field.

## Expected Behavior

- No unstyled native spinner boxes appear on any number input, whether idle, hovered, or focused.
- Number inputs keep the app's dark styling: `bg-neutral-800/60`/`bg-neutral-950` background, `border-neutral-700`/`border-neutral-800` border, `rounded` corners, and the indigo focus ring where already present.
- Typing, selection, existing `min`/`step` constraints, and arrow-key increments continue to work exactly as they do today.
- The styling comes from a single shared rule so any new number input matches automatically.

## Actual Behavior

- Hovering or focusing a number input reveals the browser's default spinner arrows, rendered as white/light boxes.
- These arrows ignore the app's colour scheme and border styling, so they read as broken UI.
- No spinner-related CSS exists for them today.

## Requirements for completed issue

1. A single shared style is added in `src/index.css` that suppresses the native spinner chrome for `type="number"` inputs in all supported engines (Chromium/WebView2 `::-webkit-inner-spin-button` and `::-webkit-outer-spin-button`, plus Firefox `-moz-appearance: textfield` / `appearance: textfield`).
2. All six number-input sites are covered and verified, with no per-file ad hoc duplication of the spinner-hiding classes:
   - `src/components/TaskPanel.tsx` — pomodoro target input in the add-task form
   - `src/components/ProjectManager/TaskInspector.tsx` — "Est … p" field in "Estimate & Time"
   - `src/components/SettingsPanel.tsx` — base settings numeric fields
   - `src/components/TodosPage.tsx` — "Estimate (pomodoros)"
   - `src/components/TodoSchedulePicker.tsx` — yearly day-of-month input
   - `src/components/pets/PetTrainingTab.tsx` — "Training duration (minutes)"
3. If a shared class is applied per element rather than a global element selector, every one of the six sites is updated (edit `className` in place; do not otherwise change input markup, handlers, or validation).
4. Number-input behavior is unchanged: typing, `min`/`step` clamping, blur/commit handlers, and Enter-to-commit still work; arrow keys still increment/decrement the value.
5. `inputMode="numeric"` text fields (`src/components/TimeOfDayInput.tsx`, `src/components/pets/PetScheduleItemForm.tsx`) are left untouched — they are out of scope.

### Testing

1. Visually confirm in the running app (`pnpm dev`) that no input in the six sites above shows spinner arrows when idle, hovered, or focused.
2. Confirm existing numeric behavior still works: type a value, use Up/Down arrow keys, blur to commit, and confirm the value saves.
   - Task panel: add a task with a pomodoro target.
   - Task inspector: change the estimate, confirm it persists.
   - Todos: create/edit a to-do with an estimate; set a yearly schedule day.
   - Settings: change a base settings duration and confirm it saves.
   - Pets: log a training session with a duration.
3. Confirm inputs remain legible and correctly styled in both the browser and the Tauri webview.
4. Run `pnpm test:unit` to confirm no existing component tests regress.
5. Run `pnpm run build` to confirm the CSS change compiles.

## Context

The app builds all input styling inline with Tailwind classes; there is no shared UI component directory, so the natural home for a global input rule is the existing global stylesheet.

### Global stylesheet

Code Source: `src/index.css`
Code Description: Tailwind import, `@apply`-based body theme, custom scrollbar utilities (`.app-scrollbar`, `.habit-scroll`), and keyframes. This is where the shared spinner rule belongs; there are no spinner rules today.

```css
@import "tailwindcss";

body {
    @apply bg-neutral-900 text-neutral-200 text-sm;
    font-family: system-ui, sans-serif;
}
```

### Example affected input — TaskPanel pomodoro target

Code Source: `src/components/TaskPanel.tsx`
Code Description: The add-task form's numeric estimate input shown in the timer view's task panel. This is the "pomodoro estimate input box" from the report.

```tsx
<input
    type="number"
    min={1}
    value={targetInput}
    onChange={(e) => setTargetInput(e.target.value)}
    onBlur={(e) => {
        commitTargetInput(e.target.value);
    }}
    className="w-14 bg-neutral-800/60 border border-neutral-700 rounded px-1 py-1.5 sm:py-1 text-[11px] text-center focus:outline-none focus:ring-1 focus:ring-indigo-500"
/>
```

### Other affected inputs

- `src/components/ProjectManager/TaskInspector.tsx:179` — `className="w-16 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 outline-none focus:border-neutral-600"` (commits via `commitEstimateDraft`).
- `src/components/SettingsPanel.tsx:67` — `className="bg-neutral-800/60 border border-neutral-700 rounded px-2 py-1.5 sm:py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500"`, rendered once per entry of `fields`.
- `src/components/TodosPage.tsx:300` — `#todo-estimate`, `className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs"`.
- `src/components/TodoSchedulePicker.tsx:119` — yearly day input, `className="mt-0.5 w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1.5 text-xs"`.
- `src/components/pets/PetTrainingTab.tsx:349` — `aria-label="Training duration (minutes)"`, `className="w-36 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"`.

## Notes

- Enumeration was done with a repo-wide search for `type="number"`; these six sites are the complete set of native number inputs. No spinner styling exists anywhere (`appearance-none`, `::-webkit-inner-spin-button`, `::-webkit-outer-spin-button`, `-moz-appearance: textfield` all return no matches).
- The Tauri app uses WebView2 (Chromium), so the `::-webkit-*` rules are the primary path, but the Firefox rule should be included for the browser PWA.

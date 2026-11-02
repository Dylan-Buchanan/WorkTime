# Theming (Light / Dark / System)

WorkTime is themed with a **theme-relative palette**, not with per-class `dark:`
variants and not by renaming every color utility to a semantic token. This note
records the decision and the conventions so future components stay correct.

## Why this mechanism

- The app already used the stock Tailwind scales consistently: `neutral-950` is
  the furthest canvas, `900`/`800` are surfaces and raised surfaces, `400`/`500`
  are secondary text, `100`/`50` are inverted surfaces. Inverting the ramp keeps
  every contrast relationship the dark palette already had.
- Tailwind v4 emits color utilities as `var(--color-*)`, so a theme switch is a
  variable swap. That is a one-file change instead of ~1,600 class edits across
  64 components, and new components get theming for free.
- Per-class `dark:` variants would have required touching every color usage and
  every future one. A rename to semantic tokens (`bg-surface-1`, …) is the
  cleaner long-term name, but it is a very large mechanical diff; the variable
  layer makes that migration possible later without changing behavior.

## How it works

1. `index.html` sets `<html data-theme="dark">` and runs a tiny inline script
   before first paint. It reads the surface-local preference and writes the
   **resolved** theme (`light` | `dark`) to `data-theme`, plus the
   `meta[name="theme-color"]` content. A stored Light or System preference
   therefore never flashes the Dark default.
2. `src/index.css` declares `@custom-variant dark (&:where([data-theme="dark"],
   [data-theme="dark"] *))`, so `dark:` utilities follow the resolved theme
   rather than the OS. It also sets `color-scheme` per theme so native controls
   and scrollbars match.
3. `[data-theme="light"]` mirrors the neutral ramp and the accent extremes.
   `:root` / `[data-theme="dark"]` keep Tailwind's default values.
4. `src/hooks/useThemePreference.ts` is mounted at the app root (`App.tsx`) and in
   the Settings panel. It subscribes to the preference store and to
   `prefers-color-scheme` (through `useMediaQuery`) and re-applies the resolved
   theme whenever either changes. `System` therefore updates live without a
   reload.

## Palette conventions

- **Neutral is a surface ramp, not a literal gray.** Light mode mirrors it
  (`950 ↔ 50`, `900 ↔ 100`, `800 ↔ 200`, `700 ↔ 300`, `600 ↔ 400`; `500` is
  unchanged). Write neutral classes by role: `bg-neutral-950` for the canvas,
  `bg-neutral-900` for a surface, `border-neutral-800` for a border,
  `text-neutral-200` for primary text, `text-neutral-400/500` for secondary
  text.
- **Accent scales mirror only at the extremes.** Tints (`100`–`400`) and deep
  chips (`900`/`950`) mirror, so `bg-emerald-950 text-emerald-200` becomes a
  pale chip with dark text. Solid fills (`500`–`800`, e.g.
  `bg-indigo-600 text-white`) stay absolute, so buttons look the same in both
  themes.
- **Absolute-color scopes.** Content that must mirror an exported artifact — the
  goals deck slide canvas — carries `.theme-static`, which restores the original
  palette. Use it on the smallest possible element.
- **Don't use raw `white`/`black` for UI chrome.** `text-white` is fine on a
  solid accent fill or an inline project/habit color. Subtle overlays use
  theme-relative neutrals (`border-neutral-500/15`, `bg-neutral-500/[0.08]`,
  `hover:bg-neutral-500/10`) instead of `border-white/5`, `bg-white/[0.03]`, and
  `hover:bg-white/5`. Modal scrims stay `bg-black/NN`.
- **Inline SVG/chart colors** use the theme variables
  (`var(--color-neutral-800)`, `var(--color-neutral-950)`) rather than hex
  literals. Chart series colors are intentionally absolute.
- **Buttons need an explicit foreground.** A solid accent background must carry
  `text-white` (or `text-black` on light accents such as amber). Relying on the
  inherited body color breaks one of the two themes.

## Preference storage

`src/lib/theme/themePreference.ts` mirrors the surface-local Agent API key
pattern: a versioned key (`worktime:theme:v1`), injectable storage, safe
`defaultStorage()`, get/set/clear, subscribe, and an isolated store factory.
Storage failures fall back to the in-memory preference instead of failing the
selection.

The preference is **per surface** and deliberately outside `Settings`,
`settings.data`, the staging store, and every synced key. `AGENTS.md` records the
key as the scoped theming exception. The default when nothing is stored is
**Dark**, so existing users see no change.

## Browser / PWA chrome

The manifest keeps the dark `theme_color` / `background_color` because Dark is
the default install experience. Only the live `meta[name="theme-color"]` follows
the resolved theme (`#0a0a0a` / `#fafafa`). `scripts/verify-pwa-build.mjs`
asserts the static default attribute and the bootstrap script are present in the
built HTML.

## Accepted limits

- `color-mix()` opacity modifiers have a hardcoded dark fallback in the compiled
  CSS. Every current browser and Tauri's WebView2 support `color-mix()`; only
  very old engines would see the dark fallback for translucent surfaces.
- OS-drawn UI (native `<select>` popups, scrollbars) follows `color-scheme` but
  its exact rendering is platform-controlled. `PetTimePicker` still documents
  that limit.
- The exported `.pptx` deck keeps its own palette; only the preview chrome
  follows the app theme.

## Tests

- `src/lib/theme/themePreference.test.ts` — defaults, round-trip, corrupt values,
  storage-throw resilience, subscribe, System resolution, document application.
- `src/hooks/useThemePreference.test.tsx` — startup application, stored Light,
  immediate flip, live System changes, listener cleanup.
- `src/components/SettingsPanel.test.tsx` — Appearance section, three options,
  Dark default, apply-on-select, System announcement.
- `src/index.css.test.ts` — dark variant wiring, `color-scheme`, full neutral and
  accent mirroring, `.theme-static` restoration, and the `index.html` bootstrap.

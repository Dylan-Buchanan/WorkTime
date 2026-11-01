# Title: Light mode as a theme setting (Light / Dark / System)

## Tags

Complexity Classification: T3
Classification Reason: A whole-app theming conversion rather than an isolated settings toggle. Verified: there are zero `dark:` variants in `src/`, and surfaces are hardcoded dark across ~126 `.tsx` files (~962 `neutral-<n>` occurrences, plus `text-white` and `bg-black/60` overlays), including auth/public pages. The Tailwind v4 plumbing is not wired (`src/index.css` has no `@config`/`@custom-variant`, so the `darkMode: "class"` in `tailwind.config.js` is inert), so class-based theming has to be established first. The change also reaches `src/index.css` global surfaces, PWA/build metadata (`index.html`, `vite.config.ts`, `scripts/verify-pwa-build.mjs`), the settings panel, a new surface-local preference module, and the existing unit/PWA/e2e suites.

Severity: Medium
Severity Reason: No data loss or functional breakage, but every screen in the app is affected and a partially themed app is visibly broken (light text on light surfaces, unreadable overlays). Accessibility and long-session readability are real user-facing concerns.

Needs research before implementation: Yes

### Research Needed

The storage decision is settled (surface-local, no Supabase/staging-store change), but the theming mechanism and the non-mechanical color cases must be resolved before work starts.

- **Mechanism:** decide between a semantic token layer (CSS custom properties defined in `src/index.css`, consumed by components) and per-class `dark:` variants across ~126 files. Either way, confirm how it coexists with Tailwind v4 — `src/index.css` currently has no `@config "./tailwind.config.js"` and no `@custom-variant dark (...)`, so today's `darkMode: "class"` in `tailwind.config.js` has no effect and `dark:` defaults to `prefers-color-scheme`.
- **Non-invertible colors:** audit places that assume a dark backdrop and cannot be mechanically flipped — status/accent hues (emerald/amber/red/indigo), gradients, `bg-black/NN` modal overlays (e.g. `src/App.tsx` `MainLayout` mobile drawer), toasts, timeline/analytics chart colors, pet visuals, and the goals deck preview.
- **Where the root theme class goes:** `index.html` vs the app root, so auth/public routes (`AuthPageLayout`, login/signup/reset) are themed before the authenticated providers mount and without a flash of the wrong theme.
- **Native metadata:** whether `theme-color` meta, the PWA manifest `theme_color`/`background_color`, and Tauri window chrome become static or follow the active theme, and the matching update to `scripts/verify-pwa-build.mjs` (which pins `#0a0a0a` / `#171717`).
- **Known limits:** native `<select>` popups and OS-drawn scrollbars ignore app theming (`src/components/pets/PetTimePicker.tsx` already documents this); record what is accepted as out of reach.
- **Test coupling:** find unit and e2e assertions that are color-coupled or coupled to the settings section names used by `expandSection` in `SettingsPanel.test.tsx`.

## Summary

Add a theme setting to the Settings panel offering **Light**, **Dark**, and **System**, defaulting to Dark so the current look is preserved for every existing user. The preference is stored per surface (browser or Tauri webview), following the existing `src/lib/agent/apiKey.ts` pattern — it is not account-synced and does not touch the `Settings` type, Supabase `settings.data`, or the staging store. Selecting System follows the OS `prefers-color-scheme` and updates live. Every screen — the authenticated app and the auth/public pages — must render correctly in light mode.

## Steps to Reproduce Context

1. Sign in and open the app shell — `src/index.css` paints `html` with `bg-neutral-950` and `body` with `bg-neutral-900 text-neutral-200`.
2. Expand the Settings panel (`src/components/SettingsPanel.tsx`) — the collapsible sections are "Base settings", "Day hour settings", and "Agent API key". There is no appearance/theme section.
3. Search the frontend for `dark:` — zero matches. Surfaces are hardcoded (`bg-neutral-900/30`, `border-neutral-800`, `text-neutral-400`, etc.), so there is no existing switch for a light palette.
4. Open an auth page (e.g. login) — it is hardcoded dark too and renders before the authenticated providers mount.

## Expected Behavior

- The Settings panel contains a theme section alongside the existing sections, offering Light, Dark, and System, and it takes effect immediately on selection (no separate Save step, matching the surface-local Agent API key section rather than the staged Base/Day sections).
- Dark is the default when no preference is stored, so existing users see no visual change.
- System resolves live from the OS preference and switches when the OS changes, without a reload.
- The choice persists per surface across app restarts and reloads, and stays off the sync layer (it must not appear in `settings.data`, the staging store, or any `worktime:staging:v1:*` payload).
- Every route renders legibly in light mode — timer shell, task panel, settings panel, project manager, analytics, habits, todos, goals/deck, week overview, integrations, pets, and login/signup/reset-password — with no dark-on-light or light-on-light text, and readable modal overlays and borders.
- Scrolling surfaces, the app background behind the fixed-height shell, and the browser/Tauri window chrome do not show a mismatched dark canvas in light mode.
- `pnpm run build`, `pnpm test:unit`, `pnpm test:pwa`, and `pnpm test:platform` pass; anything that pinned dark-specific colors is updated rather than bypassed.

## Actual Behavior

- The app is dark-only. There is no appearance or theme setting anywhere in `SettingsPanel`.
- Global surfaces are hardcoded (`html`/`body` in `src/index.css`), with ~962 hardcoded `neutral-*` class usages across 126 files and no `dark:` variants to piggyback on.
- The only OS-preference handling in the app is a leftover `@media (prefers-color-scheme: dark)` block in `src/App.css` that only affects `a:hover`.

## Requirements for completed issue

1. Research above is resolved and the chosen theming mechanism is documented in the PR (token layer vs per-class variants, plus the Tailwind v4 `@custom-variant`/`@config` decision).
2. A surface-local theme preference module exists following the `src/lib/agent/apiKey.ts` shape (key constant, injectable storage, safe `defaultStorage()`, get/set/clear, subscribe), with colocated tests; `AGENTS.md`'s localStorage exception list is updated with the new key.
3. The Settings panel exposes a theme control with Light / Dark / System, applying on selection, with accessible labeling and an announced current state, and Dark selected when nothing is stored.
4. System mode follows `prefers-color-scheme` live (the existing `src/hooks/useMediaQuery.ts` already subscribes to media-query changes).
5. The active theme is applied at the document root so it is in effect before any route renders, including auth/public pages, with no flash of the wrong theme on load.
6. Every authenticated route and every auth/public page renders correctly in light mode, and in dark mode with no visual regression.
7. Global surfaces and non-component chrome in `src/index.css` (html/body canvas, `.habit-scroll`/`.app-scrollbar` colors) respond to the active theme.
8. Browser/PWA metadata that is visibly dark (`index.html` `theme-color`, manifest `theme_color`/`background_color` in `vite.config.ts`) is consistent with the chosen theme behavior, and `scripts/verify-pwa-build.mjs` matches.
9. The preference is not written to `settings.data`, the staging store, or any synced key, and the `Settings` type / `parsePersistedSettings` are unchanged.

### Testing

- Unit tests for the preference module: default is Dark when unset, set/get round-trip, invalid/corrupt stored values fall back to Dark, storage-throw resilience, subscribe fires on change.
- `SettingsPanel` tests: the theme section expands via the existing section-button pattern, all three options render, selecting one updates the stored preference and the applied theme, and Dark is selected by default.
- A test that the theme class/attribute is applied at the document root on startup and flips when the preference changes, including the System → resolved-theme path.
- Manual pass over every route in light mode and dark mode (both desktop and the narrow/mobile drawer layout in `src/App.tsx` `MainLayout`), checking contrast on text, borders, overlays, and inputs.
- `pnpm test:unit`, `pnpm run build`, `pnpm test:pwa`, `pnpm test:platform`, and `pnpm test:e2e` pass.

## Context

Code Source: `src/components/SettingsPanel.tsx` (~L31–32, L54–58, L107–168)
Code Description: Where the theme section is added. Sections are `expandedSections` + `toggleSection(...)` with `aria-expanded`/`aria-controls` on the header button and `hidden` on the content div. Note the two persistence styles in one panel: Base/Day edit a local draft `local` and commit through the single Save button (`updateSettings(local)`), while the Agent API key section reads/writes a surface-local store immediately and subscribes to it — the theme control should follow the latter.

```tsx
const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
const toggleSection = (section: string) => setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
...
<button type="button" aria-expanded={Boolean(expandedSections.agent)} aria-controls="settings-agent-content" onClick={() => toggleSection("agent")} ...>
    {expandedSections.agent ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
    <span>Agent API key</span>
</button>
```

Code Source: `src/lib/agent/apiKey.ts` (L1, L13–47, L64–112)
Code Description: The surface-local preference pattern to mirror — versioned key constant, injected `StorageLike`, safe storage access, in-memory cache with reconcile, and a listener set for subscribe.

```ts
export const AGENT_API_KEY_STORAGE_KEY = "worktime:agent:apiKey";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
```

Code Source: `src/index.css` (L1, L11–18, L34–70)
Code Description: Global surfaces and scrollbar styling that must become theme-aware. `@import "tailwindcss";` with no `@config`/`@custom-variant` is why class-based dark variants currently do nothing.

```css
html { @apply bg-neutral-950; }
body { @apply bg-neutral-900 text-neutral-200 text-sm; }
.app-scrollbar { scrollbar-color: color-mix(in oklab, var(--color-neutral-600) 65%, transparent) color-mix(in oklab, var(--color-neutral-950) 45%, transparent); }
```

Code Source: `tailwind.config.js`
Code Description: Declares `darkMode: "class"`, but the file is not loaded by Tailwind v4 (no `@config` directive in `src/index.css`, `postcss.config.*` registers only `@tailwindcss/postcss`). Either wire it up or replace it with a CSS-level variant declaration.

Code Source: `src/hooks/useMediaQuery.ts` (L3–15)
Code Description: Existing `matchMedia` + `change` listener hook — the building block for the System option's live OS-preference tracking.

Code Source: `src/App.tsx` (~L220–275)
Code Description: `MainLayout` shell: desktop `aside` with `border-neutral-800 bg-neutral-900/30 backdrop-blur-sm`, mobile drawer with `border-neutral-800 bg-neutral-950 shadow-2xl`, and a `bg-black/60` overlay — the modal-overlay class of colors that needs explicit light values.

Code Source: `index.html` (L9), `vite.config.ts` (PWA `manifest`), `scripts/verify-pwa-build.mjs` (L16)
Code Description: Hardcoded dark browser/PWA chrome (`#0a0a0a` / `#171717`) and the build check that pins those exact values.

Code Source: `src/lib/settings.ts` (L29–49), `supabase/migrations/20260801000000_foundation.sql` (L28–31)
Code Description: The synced `Settings` shape and its `public.settings.data` jsonb storage. Both are deliberately left untouched by this issue.

Code Source: `src/components/pets/PetTimePicker.tsx` (~L32)
Code Description: Existing note that the native `<select>` popup and OS scrollbars ignore app theming — the documented limits for the light-mode audit.

## Notes

- Verified counts at time of writing: 0 `dark:` matches in `src/`; 126 `.tsx` files with ~962 `neutral-<n>` usages (452 `bg-neutral-*`, 688 `text-neutral-*`, 329 `border-neutral-*` matches); 45 `text-white` and 11 `bg-black` matches.
- `src/App.css` retains a template-era `@media (prefers-color-scheme: dark) { a:hover { ... } }` block that only affects link hover — decide whether it is subsumed by the new theming or left alone.
- `AGENTS.md` enumerates the allowed localStorage exceptions; the new theme key must be added there, following the same approval path issue #143 used for its integration key.

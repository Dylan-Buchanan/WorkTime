# Research: Render the deck to .pptx and deliver it — editable text, chart images, Tauri-verified download, period close

> **Superseded in part (post-research).** The #133 model was decided after this research and is
> binding: see `docs/plans/issue-133-decisions.md`. Periods are an anchored `LocalDateKey` grid
> (not `periodStart = lastDeckBuiltAt ?? createdAt`), `periodEnd` is derived and not stored, and
> `lastDeckBuiltAt` became `lastBuiltPeriodStart`, holding the built period's date key rather than
> an export timestamp. Where this document says the stamp rolls the next `periodStart` forward, read
> "records which period was built; the next grid period becomes the target." The field is also no
> longer plain domain data: it is **monotonic** and guarded in both the merge and the staged writer.
> The Tauri download question below is still open and is now a merge-blocking task in Phase 11.

## Overview

WorkTime is a React/Vite PWA that also runs inside a slim Tauri v2 Windows shell, with application data flowing through a per-owner localStorage staging store into a pull → merge → push sync pipeline. Issue #140 is the final v1 Goals-epic step: turn the edited `DeckPlan` from #139 into a real `.pptx`, deliver it to disk, and only then stamp `lastDeckBuiltAt` on the tracker to close the period. The decisive research finding is that **none of the Goals or deck code exists in this working tree** — #133–#139 are untracked planning docs, not implemented modules — so this document records the surrounding build, Tauri, charting, persistence, and test surfaces that #140 will attach to, plus the spike questions that remain genuinely unresolved.

## Issue Context

- User/requested outcome: render the edited `DeckPlan` to a light, minimal, 16:9 `.pptx` with editable text boxes/bullets, chart images, speaker notes and suggested seconds on every slide; deliver it via a browser blob download; verify the Tauri shell path and use the approved fallback if needed; stamp `lastDeckBuiltAt` only after successful delivery so the next period opens at the stamp; load the pptx library dynamically so it never enters the entry chunk.
- Current pain or bug: no export, download, file-save, chart-rasterization, or pptx capability exists anywhere in the app (`docs/issues/issue-140.md:28`, `:42`). The issue's “handler seam exists” assumption (`:27`) is also not true of this tree because #139 is not implemented.
- Scope classification, if known: **T4** — new heavy dependency, first-of-its-kind file delivery, WebView2 verification with possible slim-shell policy change, and the period-close side effect (`docs/issues/issue-140.md:5-9`).
- Dependency context: #140 depends on #138 (`DeckPlan`/`DeckSlide`) and #139 (preview/export seam). In this tree neither exists, and the shared contract file the epic plan expects (`docs/goals/contract.md`) also does not exist.

## Current Behavior

### Goals, deck, and export code are absent

- There is no `src/lib/goals/` directory, no `src/components/goals/` directory, and no `src/state/GoalContext.tsx`. The dependencies named by #140 — `src/lib/goals/deck/plan.ts`, `types.ts`, `DeckPreview.tsx` — do not exist.
- `git log -1` is `9ddb8e7 v0.11.0`. The only Goals artifacts are the untracked issue/plan docs under `docs/issues/` and `docs/plans/`; `src/lib/goals/deck/render.ts` has no precedent to copy.
- `DataAccess` has no `loadGoals`/`saveGoals`; its current domain saves end at the pet collections (`src/lib/data/DataAccess.ts:112-162`). The staging record is schema version 8 with no goals slice (`src/lib/data/staging/types.ts:113`, `:195`).
- No tracker, goal, check-in, `lastDeckBuiltAt`, period, slip, or sparkline type or function exists in `src/`.

### No file generation or download path exists

- `package.json` has no pptx/zip/xlsx/docx/file-saver dependency (`package.json:34-49`); `pnpm-lock.yaml` has no such package.
- Repo-wide search of `src/` for `Blob`, `createObjectURL`, `download`, `saveAs`, `showSaveFilePicker`, `toBlob`, `toDataURL`, `getContext(`, `html-to-image`, and `pptxgenjs` returns no application code. The only “download” reference is the lazy-route comment in `src/App.tsx:37`.
- There is no Tauri `invoke` or file-write path. The only frontend `@tauri-apps` usages are `isTauri()` guards and the notification/window adapters (`src/lib/platform/tauriClose.ts:1-52`, `src/state/AppStateContext.tsx:21-31`, `src/pwa/registerServiceWorker.ts:21-24`).
- There is no `download` attribute on any external `<a>`; existing external links are ordinary `target="_blank"` links (for example `src/components/GithubIntegrationCard.tsx:805`).
- The delivery helper is a shared seam: #141 expects to reuse #140’s download path for the goal-set JSON file (`docs/issues/issue-141.md:38-39`, `:54-55`), so the Tauri fallback decision also affects that later export.

### Build and chunking today

- Build is `tsc && vite build` (`package.json:9`). Vite is 8.x with rolldown; the only chunk configuration is two first-match-wins groups under `build.rolldownOptions.output.codeSplitting.groups`: `supabase` and `react-vendor` (`vite.config.ts:14-28`). There is no `manualChunks`, `chunkSizeWarningLimit`, `define`, or Node-polyfill plugin.
- Heavy routes are `React.lazy` imports (`src/App.tsx:36-58`) wrapped in one `Suspense` at `src/App.tsx:70`. The authenticated provider graph and shell are statically imported (`src/App.tsx:10-32`, `:137-175`), so they live in the entry graph.
- The current local `dist` (gitignored, built 2026-10-30) has `dist/index.html` loading `assets/index-BtXPtOFZ.js` (183,734 B) and modulepreloading 16 chunks including `supabase`, `SyncContext`, `AppStateContext`, `ProjectManagerContext`, and `HabitContext`. Largest chunks are `AnalyticsPage-CIKboevp.js` (407,722 B, recharts), `supabase-smfxDXm8.js` (206,946 B), `react-vendor-d2MtpFVx.js` (189,573 B), and the entry (183,734 B).
- The only non-route dynamic imports are function-local `await import()` calls in `src/state/AppStateContext.tsx:21` (notification plugin) and `src/lib/platform/tauriClose.ts:32` (`@tauri-apps/api/window`). These are the existing precedent for loading the pptx library inside the export handler.
- The PWA Workbox config precaches **every emitted JS chunk** via `globPatterns: ["**/*.{html,js,css,png,svg,ico,mp3}"]` (`vite.config.ts:45-47`); `dist/sw.js` currently contains `AnalyticsPage`, `ProjectManagerPage`, `IntegrationsPage`, and `HabitsPage`. Therefore a dynamically imported pptx chunk would still be downloaded by the service worker on install/update in the browser PWA, even though it stays out of the entry chunk. Workbox's default 2 MiB `maximumFileSizeToCacheInBytes` is not configured; a larger chunk would be skipped with a warning. [Inference: this is the main hidden coupling between “lazy” and “not paid for until export” in the browser surface.]
- Tauri disables the service worker (`src/pwa/registerServiceWorker.ts:21-24`), so only the web PWA pays the precache cost.
- No build step or script inspects `dist/assets` names or sizes. `scripts/verify-pwa-build.mjs:34-45` only checks PWA artifacts and service-worker registration; `test:all` invokes it without building first (`package.json:25`).

### Tauri shell today

- The native shell initializes exactly `tauri_plugin_opener::init()` and `tauri_plugin_notification::init()` (`src-tauri/src/lib.rs:22-23`), with no `#[tauri::command]`, no `invoke_handler`, no webview builder, and no download hook.
- `src-tauri/Cargo.toml:20-23` declares only `tauri`, `tauri-plugin-opener`, and `tauri-plugin-notification`. `package.json` has `@tauri-apps/api` and `@tauri-apps/plugin-notification`, but not `plugin-dialog`, `plugin-fs`, or `plugin-opener` on the frontend.
- The main window is declared in `src-tauri/tauri.conf.json:12-19` (`title`, `width`, `height`); `security.csp` is `null` (`:20-22`), and `frontendDist` is `../dist` (`:10`). The production origin for the packaged Windows app is `http://tauri.localhost` (`supabase/README.md:164`, `:172`).
- Capabilities grant only `core:default`, `opener:default`, `notification:default`, and `notification:allow-request-permission` (`src-tauri/capabilities/default.json:6-11`). The generated schemas contain no `dialog:` or `fs:` permissions.
- Because the window is created declaratively from config and `lib.rs` builds no webview, no Tauri download handler is attached. Framework source inspection (installed `wry 0.55.1`, `src/webview2/mod.rs:792-861`) shows the WebView2 `DownloadStarting` event is only registered when a download handler is configured; otherwise the default WebView2 download behavior is left in place. Tauri 2.11.1 does expose `WebviewBuilder::on_download` (`tauri-2.11.1/src/webview/mod.rs:602-649`), but this app never calls it.
- Whether an anchor + `blob:` download actually saves a file, where it lands, whether a Save dialog appears, and whether completion is observable are **not verified anywhere in the repo**. No spike document exists and no Tauri automation harness exists.
- `pnpm test:platform` reads `lib.rs`, `Cargo.toml`, `package.json`, `AGENTS.md`, `tauri.conf.json`, and the capability file (`scripts/verify-platform-cleanup.mjs:8-13`). It requires the two existing plugin initializers and forbids commands/`invoke_handler` (`:15-16`), checks the close-handshake strings and ordering (`:21-45`), runs a real `cargo check` (`:49-58`), forbids four direct Cargo deps (`:60`), requires the three existing deps (`:61`), forbids `e2e/mock-ipc.js` and the strings `test:rust`/`mock-ipc` in `package.json`/`AGENTS.md` (`:62-63`), requires the local `dist` build contract (`:64`), and requires three capability strings (`:65`). The capability check is a subset check, so extra permissions do not fail it; the script does **not** enforce plugin exclusivity, does not read `Cargo.lock`, and does not validate the “only opener and notification” wording in AGENTS.md. Adding a third plugin would therefore be caught by policy review and `cargo check`, not by an automated slim-shell assertion.
- `AGENTS.md:3` describes the backend as containing “only the opener and notification plugins”; `:9` says `src-tauri/` is only the native startup shell; `:14` forbids Tauri `invoke` data paths; `:16` makes the staging store the only general application-data persistence exception and says it must not be replaced by Tauri `invoke`/file paths; `:36` describes `test:platform`; `:42` protects the notification entry point and authenticated provider placement.

### Charting and slide-rendering precedent today

- Recharts 3.10.1 is a dependency (`package.json:48`) and is imported only by the lazy `AnalyticsPage` (`src/components/AnalyticsPage.tsx:10-19`), which renders one stacked `BarChart` inside a fixed-height `ResponsiveContainer` (`:401-437`). Series are plain arrays such as `{ date, focusMins, breakMins, todoCompletions }` (`:112-134`).
- There is no standalone chart component, no sparkline component, and no use of recharts anywhere outside AnalyticsPage.
- There is no canvas, `getContext`, `toDataURL`, `toBlob`, `new Image`, `XMLSerializer`, or SVG-to-image code in `src/`. jsdom’s optional `canvas` peer is the only `canvas` reference in the lockfile.
- The only hand-written SVG precedent is a small inline status ring (`src/components/pets/PetHeroStatus.tsx:84-99`), which is never serialized.
- There is no html-to-image/html2canvas/dom-to-image dependency.
- The app is dark-themed (`src/index.css:8-11`, `src/App.tsx:159`); Tailwind has no custom theme (`tailwind.config.js:1-9`). There is no 16:9 frame, light slide surface, print stylesheet, or TV type scale anywhere in `src/`. Chart colors are dark-surface hex values (`src/components/AnalyticsPage.tsx:425-434`), so no light-slide chart styling precedent exists.
- The deck chart series contract exists only in prose: #138 requires per-goal “this period’s movement plus the sparkline” and says a first-period goal yields no series (`docs/issues/issue-138.md:30`, `:44`); the epic plan says that if hand-SVG rasterization is chosen, #138 must emit plain numbers, not React elements (`docs/plans/goals-epic-parallel-workflow.md:415`). None of that is implemented.

### Persistence and sync behavior the stamp would inherit

- All domain saves are local staging writes; the only network path is `sync()` (`src/lib/data/StagedDataAccess.ts:147-153`, `:511-513`). Contexts update React state optimistically, then a save effect writes the domain slice (`src/state/HabitContext.tsx:230-250`).
- `saveHabits` is the canonical full-desired-set writer: new/deep-changed rows get one fresh LWW stamp, unchanged rows keep theirs, and omitted rows are tombstoned (`src/lib/data/StagedDataAccess.ts:438-501`). `savePMState` replaces a whole singleton and bumps `pmUpdatedAt` (`:425-431`). There is no field-level patch API.
- The one existing “read latest, patch one record” precedent is `StateSyncBridge` using `loadPMState()` then `savePMState({ ...latest, tasks: { ...latest.tasks, [id]: { ...task, appTaskId } } })` (`src/state/StateSyncBridge.tsx:234-247`). That is two separate store reads/writes, not an atomic read-modify-write; the store’s owner-scoped lock only covers each `update()` call.
- A context save effect that fails clears its pending marker and `console.warn`s, without rolling back React state or advancing the “last serialized” marker (`src/state/HabitContext.tsx:246-249`, `:257-272`; ProjectManager equivalent at `src/state/ProjectManagerContext.tsx:288-315`). The Todo command path is the exception that can rethrow to its caller (`src/state/TodoContext.tsx:99-115`).
- A failed staging write throws `StagingStorageError` before the store notifies listeners (`src/lib/data/staging/LocalStagingStore.ts:400-411`). The persisted record and revision are unchanged.
- Sync is trigger-driven, not write-triggered: bootstrap on mount, window focus, visible `visibilitychange`, web-only `pagehide`, the Tauri close handshake, and manual controls (`src/state/SyncContext.tsx:49-86`, `:94-149`). A local stamp is therefore visible immediately on this device but reaches another device only on a later sync trigger. Cross-device conflicts are resolved by row-level LWW `updated_at`, with remote winning exact ties (`src/lib/data/sync/merge.ts:1019-1142`, `:1353-1579`; `supabase/migrations/20260802010000_staged_sync_rpc.sql:377`).
- The staging schema is currently version 8; #133 plans version 9 with goal fields, `lastDeckBuiltAt: string | null` on the tracker, migration-ladder support, and `saveGoals` (`docs/issues/issue-133.md:49-56`, `:92`). None of that exists yet.

### External library facts relevant to the pending spike (not repo behavior)

- Checked on 2026-10-31 against the npm registry/unpkg: `pptxgenjs` latest is 4.0.1, with dependencies `jszip`, `image-size`, `https`, and `@types/node`; it publishes CJS and ESM builds and a `browser` field that stubs Node builtins. Its type surface includes `LAYOUT_WIDE` (13.33" × 7.5"), bullet-capable `slide.addText`, `slide.addNotes(string)`, `slide.addImage({ data | path })`, `slide.addChart`, and `write({ outputType: "blob" })`. These facts are not exercised anywhere in this repo.
- No repo decision exists for the pptx library, chart rasterization approach, or Tauri delivery fallback. The epic plan requires those decisions in `docs/research/issue-140.md` before implementation (`docs/plans/goals-epic-parallel-workflow.md:61-94`), but that file does not exist.

## Relevant Files And Entry Points

- `docs/issues/issue-140.md:17-19` — the three unresolved spike questions (library, chart rasterization, Tauri download).
- `docs/issues/issue-140.md:23-38` — intended output, delivery, and period-close semantics.
- `docs/issues/issue-140.md:46-58` — renderer module, chart path, delivery, stamp, dynamic import, rebuild, and test requirements.
- `docs/issues/issue-138.md:26-31`, `:40-47` — the `DeckPlan`/`DeckSlide` shapes, chart series expectation, notes/seconds, determinism.
- `docs/issues/issue-139.md:26-30`, `:43-44` — preview edits are in-memory; Export is the seam to #140.
- `docs/issues/issue-133.md:48-56`, `:92` — planned goal types, `lastDeckBuiltAt`, staging v9, `saveGoals`, periodStart derivation.
- `docs/issues/issue-135.md:27-31` — current-period window, due badge, sparkline, inclusion rules.
- `docs/issues/issue-136.md:17`, `:30-31` — period pinning and the stale-period guard.
- `docs/plans/goals-epic-parallel-workflow.md:61-94` — Phase 0 decision gate and Tauri spike instructions.
- `docs/plans/goals-epic-parallel-workflow.md:506-556` — #140 implementation lane, chunk check, Tauri verification, and policy-warning notes.
- `docs/plans/goals-epic-parallel-workflow.md:415` — chart decision constrains #138 to plain numbers if hand-SVG is chosen.
- `package.json:9`, `:18-25`, `:34-49` — build/test scripts, no pptx/file-save dependency.
- `vite.config.ts:14-28` — rolldown chunk groups (only supabase/react-vendor).
- `vite.config.ts:31-48` — PWA precache globs that sweep every JS chunk.
- `src/App.tsx:36-58` — route-level lazy import precedent.
- `src/App.tsx:137-175` — provider nesting where a future `GoalProvider` must sit inside `SyncProvider`.
- `src/App.tsx:70` — the single `Suspense` boundary; no per-action Suspense exists.
- `src/state/AppStateContext.tsx:21` and `src/lib/platform/tauriClose.ts:32` — function-local dynamic import precedent.
- `src-tauri/src/lib.rs:20-23`, `:44-59` — only two plugins and the close handshake; no commands or download hook.
- `src-tauri/Cargo.toml:20-23` — native dependency list.
- `src-tauri/tauri.conf.json:12-22` — config-declared window, `csp: null`.
- `src-tauri/capabilities/default.json:6-11` — current permission set.
- `scripts/verify-platform-cleanup.mjs:15-16`, `:49-58`, `:60-65` — what `test:platform` does and does not assert.
- `scripts/verify-pwa-build.mjs:34-45` — no `dist/assets` inspection.
- `src/lib/data/DataAccess.ts:112-162` — current domain save/load contract; no goals methods.
- `src/lib/data/staging/types.ts:53-71`, `:112-195` — schema 8 snapshot/record shape that #133 will extend.
- `src/lib/data/StagedDataAccess.ts:438-501` — full-desired-set writer semantics the `lastDeckBuiltAt` stamp must respect.
- `src/state/HabitContext.tsx:230-250`, `:257-277` — the hydrate/save/revision-reload lifecycle `GoalProvider` is meant to copy.
- `src/state/StateSyncBridge.tsx:234-247` — existing read-latest-then-patch precedent, with its two-write race.
- `src/state/SyncContext.tsx:49-86`, `:94-149`, `:174-180` — sync triggers and revision notifications.
- `src/lib/data/sync/merge.ts:1019-1142`, `:1353-1579` — pull merge and push-plan assembly points a goals slice must extend.
- `src/components/AnalyticsPage.tsx:10-19`, `:401-437` — the only recharts usage and its dark-surface styling.
- `src/components/pets/PetHeroStatus.tsx:84-99` — the only hand-written SVG precedent.
- `src/test/setup.ts:9-21`, `:36-39` — jsdom polyfills (matchMedia, Audio) and localStorage clearing; no canvas polyfill.
- `playwright.config.ts:16-36` — browser-only Chromium harness, no download configuration.

## Data Flow Or Control Flow

### Current state: no export flow exists

There is no code path from a deck preview to a file. The issue's described flow is a design intention, not current behavior. Everything below that references #138/#139/#133 is sourced from planning docs and must be treated as a contract to be created, not an existing one.

### Documented intended #140 flow (not implemented)

1. A user finishes editing the `DeckPlan` in `DeckPreview` (#139) and presses Export; #139 is supposed to hand the edited in-memory plan to a handler (`docs/issues/issue-139.md:29`, `:43`).
2. The export handler dynamically imports the renderer, which dynamically imports the chosen pptx library, keeping the library out of the entry chunk (`docs/issues/issue-140.md:38`; pattern precedent at `src/App.tsx:36-58`).
3. The renderer maps each `DeckSlide` type to pptx constructs: title, per-goal recaps with slip badge, misses/reasons, next plans, progress charts as images, closing commitments, appendix roster; every slide gets speaker notes and suggested seconds (`docs/issues/issue-140.md:47`, `docs/issues/issue-138.md:40-46`).
4. The library produces a Blob; delivery uses an anchor + `URL.createObjectURL` in the browser, with a Tauri path to be verified.
5. Only after successful delivery does the handler stamp `lastDeckBuiltAt` on the tracker through a normal `saveGoals` staged write (`docs/issues/issue-140.md:36`, `:50`, `:72`).
6. Stamping closes the current period: the next `periodStart` becomes the stamp, and the next check-in opens against the new window (`docs/issues/issue-135.md:27`, `docs/issues/issue-136.md:30-31`).
7. No file, render, or snapshot is persisted; the stamp is the only durable effect (`docs/issues/issue-140.md:76-78`).

### Current save/reload path that the stamp would use

1. A context mutator updates React state immediately; a save effect gated on `hydrated && initialized` serializes the domain slice and calls the corresponding `data.save*` method (`src/state/HabitContext.tsx:230-250`).
2. `StagedDataAccess` reads the latest record inside `LocalStagingStore.update`, stamps changed rows, writes one localStorage record, increments `revision`, and notifies subscribers (`src/lib/data/staging/LocalStagingStore.ts:376-413`).
3. The revision bump causes `SyncContext` to expose a new `revision`; contexts reload staged data unless their in-memory value is ahead of the last successful save (`src/state/HabitContext.tsx:257-277`, `src/state/SyncContext.tsx:174-180`).
4. A later focus/visibility/manual/close trigger calls `sync()`; the coordinator pulls, merges, and only then pushes pending rows (`src/lib/data/sync/SyncCoordinator.ts:246-305`). The stamp is not remotely durable until that happens.
5. If the local write throws, the mutation is lost from storage, the in-memory UI can still show the change, and the context’s save effect warns rather than rolls back (`src/lib/data/staging/LocalStagingStore.ts:400-411`, `src/state/HabitContext.tsx:246-249`).

### Failure paths relevant to #140

- Renderer throws: no Blob, no download, no stamp — straightforward as long as stamping happens after rendering.
- Blob creation succeeds but the anchor click is blocked or the user cancels the download: the browser exposes no completion signal, so “success” as currently worded (`download initiated successfully`) is not the same as “file landed on disk.” The issue’s Expected Behavior also says “only after the file is successfully delivered” (`docs/issues/issue-140.md:23`, `:36`), which is stronger than what the browser API can prove.
- Local stamp write fails after a successful download: the file exists but the period does not roll unless the handler awaits and surfaces the failure.
- Stamp write succeeds but remote push later fails: the period rolls locally; another device can see the old `lastDeckBuiltAt` until a successful pull/merge.

## Important Contracts And Constraints

- **No deck archive, ever.** The preview plan is in-memory only, closing discards edits, and the generated file/snapshot/render must not be persisted (`docs/issues/issue-139.md:30`, `docs/issues/issue-140.md:76-78`). The only durable export effect is `lastDeckBuiltAt`.
- **The `DeckPlan` contract does not exist yet.** #138’s `DeckPlan`/`DeckSlide` and #139’s edited-plan handoff are planning text only. The renderer cannot be written against a real type until those land; chart series are expected to be plain numbers if hand-SVG rasterization is chosen (`docs/plans/goals-epic-parallel-workflow.md:415`).
- **The staging writer takes the full desired set.** Any `saveGoals` implementation modeled on `saveHabits` will tombstone omitted trackers/goals/check-ins (`src/lib/data/StagedDataAccess.ts:438-501`; #133 plans the same pattern at `docs/issues/issue-133.md:54`). A one-tracker stamp must therefore pass the complete goal-domain set or use a carefully scoped read-modify-write path.
- **Local-first, eventual remote.** `saveGoals` will write localStorage only; `sync()` is the only network call (`src/lib/data/StagedDataAccess.ts:147-153`, `:511-513`). Stamping closes the period immediately on this device, not necessarily on another device.
- **Context saves are optimistic and swallow errors.** The Habit/PM save effects update UI first and only warn on failure (`src/state/HabitContext.tsx:230-250`; `src/state/ProjectManagerContext.tsx:288-315`). A stamp that must be confirmed needs an awaited save path or explicit failure handling, not a fire-and-forget effect.
- **`lastDeckBuiltAt` is a normal tracker field, not a transport stamp.** #133 defines it as `string | null` on `GoalTracker` (`docs/issues/issue-133.md:49`). LWW transport stamps are separate per-row `updatedAt` maps; `lastDeckBuiltAt` itself is just domain data and is not special-cased by merge logic. **Superseded:** it is now `lastBuiltPeriodStart`, holds a `LocalDateKey`, and is monotonic — guarded in the merge and the staged writer (see the note at the top of this document).
- **Period semantics are derived, not stored.** `periodStart = lastDeckBuiltAt ?? createdAt`, `periodEnd` is open, and the due badge uses cadence since `lastDeckBuiltAt` (`docs/issues/issue-135.md:27-31`). There is no period table or period ID.
- **Slim Tauri shell policy.** AGENTS.md says only opener and notification plugins (`AGENTS.md:3`, `:9`), forbids Tauri `invoke` data paths (`:14`), and makes the staging store the only general app-data persistence exception (`:16`). A dialog/fs fallback is a save path rather than an app-data store, but changing the plugin surface still requires an explicit AGENTS.md policy update and the coordinated `Cargo.toml`/`lib.rs`/capabilities/package changes described in `docs/issues/issue-140.md:19`, `:68-69`.
- **`test:platform` is a real compile gate but not a policy gate.** It runs `cargo check` and checks presence of expected strings, but permits extra plugins/permissions (`scripts/verify-platform-cleanup.mjs:15-16`, `:49-65`).
- **Entry-chunk contract.** Anything statically imported by `App.tsx`, the provider graph, `DeckPreview`, or the Goals page’s static imports is not in the export-only tier. Only a function-local `import()` inside the export handler satisfies “loaded inside the export flow only,” matching `src/state/AppStateContext.tsx:21` and `src/lib/platform/tauriClose.ts:32`.
- **PWA precache coupling.** A lazy chunk is still precached by Workbox in the browser PWA (`vite.config.ts:45-47`; `dist/sw.js` includes every route chunk). The Tauri shell skips the service worker (`src/pwa/registerServiceWorker.ts:21-24`).
- **Build environment.** Production build requires `VITE_PUBLIC_APP_URL` (`vite.config.ts:7-10`); `tsconfig` targets ES2020 with `moduleResolution: bundler` and `skipLibCheck` (`tsconfig.json:3-21`); no Node polyfill/`define` configuration exists. `tsconfig.node.json:2-10` also type-checks `src/lib/**/*.ts`.
- **No CSP.** `tauri.conf.json:20-22` leaves CSP `null`, so no CSP directive currently blocks `blob:` navigation, but nothing guarantees future behavior.

## Existing Tests And Validation

- Unit tests run under Vitest + jsdom with `src/**/*.test.{ts,tsx}` and the setup file `src/test/setup.ts` (`vitest.config.ts:13-17`). Pure-module conventions use fixed dates and fixture builders (`src/lib/engine/weekOverview.test.ts:1-42`); context tests inject `InMemoryDataAccess` (for example `src/state/DataContext.test.tsx:1-18`; `src/lib/data/InMemoryDataAccess.ts:100`, `:287-297`).
- There are **no** `src/lib/goals` tests, no deck/render tests, no pptx tests, and no tests that touch downloading. There is no goal fixture module (`src/lib/goals/testFixtures.ts` is planned in the epic workflow but absent).
- jsdom does not implement canvas; `src/test/setup.ts:9-21` only polyfills `matchMedia` and `Audio`. Any rasterization unit test would need its own canvas/`toBlob`/`toDataURL` mock.
- `scripts/verify-platform-cleanup.mjs` is the only native validation: static string checks plus `cargo check` (`:15-65`). It does not launch the Tauri app and cannot observe a download.
- `scripts/verify-pwa-build.mjs` validates only PWA artifacts and service-worker registration (`:10-45`). No script or test inspects `dist/assets` chunk names or sizes, and no chunk-size baseline exists.
- Playwright runs against the browser app on `http://localhost:3000` with Chromium only (`playwright.config.ts:16-36`). It has no `acceptDownloads`/`downloadsPath`, no `waitForEvent("download")`, and no Tauri project. `e2e/helpers.ts` seeds backend tables and injects a Supabase session; there are no goal-specific seed helpers yet.
- Integration tests under `integration/` cover the existing domains and sync transport (`integration/localFirstSync.integration.test.ts:116`, `integration/SupabaseDataAccess.integration.test.ts:105`). No goals integration tests exist because the schema/migrations are not present.
- `test:all` runs unit → `verify-pwa-build.mjs` (against existing `dist`) → `test:platform` → `test:integration` → `test:e2e` (`package.json:25`). `test:pwa` is the only script that builds before verifying (`package.json:23`). There is no CI workflow that runs these; `.github/workflows/` contains only the Supabase migration deployment.
- Manual validation in the issue/plan is a PR checklist only: browser download opens in PowerPoint with editable text, Tauri download verified on Windows, failed download leaves `lastDeckBuiltAt` unchanged, period label rolls forward (`docs/issues/issue-140.md:54-58`, `docs/plans/goals-epic-parallel-workflow.md:543-548`).
- Missing coverage relative to #140: renderer mapping per slide type, notes/seconds presence, chart-image generation, dynamic-import/chunk assertion, download helper behavior, Tauri delivery, failed-delivery stamp behavior, and period-roll behavior all have no automated test today.

## Risks, Edge Cases, And Unknowns

- **The dependency chain is not present.** #133–#139 are unimplemented and even the issue/plan docs are untracked on `main`. #140 cannot be implemented or meaningfully tested in this tree until the foundation, provider, plan, and preview exist.
- **Tauri download behavior is unverified.** There is no handler and no test; WebView2’s default download pipeline may prompt, auto-save, or silently fail for `blob:` URLs from `http://tauri.localhost`. The issue requires this to be verified in the real shell, and no harness exists to do so automatically.
- **“Successful delivery” is not observable in the browser.** An anchor click on a blob URL has no completion/error callback. The issue alternates between “download initiated successfully” (`:50`) and “successfully delivered” (`:23`), and says a failed download must leave the period open (`:36`). Requirements need a precise, implementable definition (for example, no-throw after initiating the download vs. a native save path that resolves only after a write).
- **The fallback changes platform policy.** `plugin-dialog` + `plugin-fs` would add Cargo crates, frontend packages, permissions, generated schemas, and AGENTS.md policy text. `test:platform` would permit this statically but runs `cargo check`, which needs the new crates available; the policy is currently textual, not automated. This is explicitly an escalated, reviewed decision (`docs/issues/issue-140.md:19`; `docs/plans/goals-epic-parallel-workflow.md:91-92`, `:553`).
- **Stamping through the full-set writer is dangerous if the set is stale.** The export handler may hold an edited `DeckPlan` and an older goals snapshot. Passing only that tracker or a stale full set to `saveGoals` can tombstone newer trackers/goals/check-ins. The read-latest-then-patch precedent (`StateSyncBridge`) is itself two writes and not atomic against concurrent tabs/devices.
- **Save failure can leave UI and storage divergent.** The provider pattern updates React state first and swallows save errors. If the stamp uses a fire-and-forget effect, the period can appear rolled while localStorage still has the old stamp. Conversely, an awaited `data.saveGoals` call can update storage/revision without the provider’s in-memory state being the source of truth until a reload.
- **Requirement 7 conflicts with period rolling.** “Building again with no new check-ins produces the same deck from the same data” (`docs/issues/issue-140.md:52`) is true for retries before a stamp, but after a successful stamp `periodStart` becomes the stamp, so a rebuild targets the next (likely empty) period. Requirements should state whether “rebuild” means pre-stamp retry only or a historical rebuild of the closed period (which the data model does not currently support).
- **Multi-device LWW can overwrite the stamp.** Tracker rows use whole-row LWW via `updatedAt`; a remote edit with a later stamp wins, and exact ties go to remote. Two devices exporting near-simultaneously can roll the period twice or lose one stamp. No revision/CAS guard exists for domain saves.
- **PWA precache silently changes the cost model.** The pptx chunk will be fetched by the service worker even if never used for export, unless Workbox config changes. If the chunk exceeds the default 2 MiB, Workbox skips precaching it and offline export may fail.
- **Chart rasterization has no precedent and no test environment.** Recharts is a 407 kB lazy dependency styled for a dark surface; there is no offscreen render, no SVG serialization, and no canvas support in jsdom. Hand-SVG + canvas and html-to-image both introduce untested code; native pptx charts would change editability/visual control and are not currently represented in #138’s series contract.
- **PowerPoint fidelity is unverified.** Editable text boxes, bullet formatting, notes, image sizing, font substitution, and light-slide readability on a TV have no existing artifact or test to compare against.
- **Determinism at the byte level is unspecified.** #138 is deterministic in data, but a ZIP-based pptx may embed creation timestamps and library metadata; “same deck” should be defined as same content, not identical bytes.
- **Bundle/runtime compatibility is unverified.** The repo has no Node polyfills/`define`, uses Vite 8/rolldown, and type-checks with ES2020. A pptx library that expects Node globals or a CommonJS/`Buffer` runtime may need configuration; the external `browser` field is not proof that this app’s bundle works.
- **No chunk-size regression gate.** The issue’s “entry chunk unaffected” check is manual (`docs/issues/issue-140.md:57`); `test:all` does not build, and no test reads `dist/assets`.
- **No CI.** Any new test or manual Tauri check is not enforced remotely; the only workflow deploys Supabase migrations.

## Downstream Guidance

- Requirements should account for: the missing #133–#139 prerequisites as a hard sequencing constraint; a precise definition of “delivery succeeded” that the chosen API can actually observe; the rule that the stamp is the only durable export artifact; full-desired-set save semantics; local-only save plus later sync; and the period-roll meaning of `lastDeckBuiltAt`, including what “rebuild” means after a stamp.
- Requirements should also preserve the explicit non-goals: no deck archive/snapshot/file persistence, no batch building of multiple trackers, no LLM involvement (that is #142), and no Tauri `invoke` application-data path.
- Planning should consider: the dependency order (#133 → #134/#138 → #139 → #140) before any renderer work; the renderer boundary against #138’s not-yet-frozen `DeckSlide` contract; the chart-data shape decision’s impact on #138; the export handler’s dynamic-import boundary and PWA precache side effect; and the Tauri fallback as an explicit policy gate that touches four native/policy files plus package dependencies.
- Planning should also consider: a unit-test strategy for mapping/notes without a real PowerPoint renderer; jsdom’s missing canvas; the absence of any `dist/assets` assertion infrastructure; the browser-only Playwright harness; and the need for a manual Windows Tauri verification step because `test:platform` only compiles and string-checks.
- Validation should distinguish the three delivery outcomes the current code cannot observe: render failure, download-initiation failure, and post-initiation cancellation/save failure. The last one is the edge case most likely to produce a closed period with no file.
- Do not include: a deck archive or persisted render, a second native data path, a quiet plugin addition without the AGENTS.md policy update, a build/chunk assertion that runs against a stale `dist`, assumptions that #139’s export seam or `GoalProvider` already exist, or any implementation choice presented as decided while the Phase 0 spike questions remain open.

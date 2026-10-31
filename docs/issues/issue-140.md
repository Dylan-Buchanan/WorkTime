# Title: Render the deck to .pptx and deliver it — editable text, chart images, Tauri-verified download, period close

## Tags

Complexity Classification: T4
Classification Reason: New heavy dependency (a pptx generation library) that must stay off the entry chunk, chart rasterization with no existing precedent in the repo, a first-of-its-kind file-download path that must be verified in the Tauri WebView2 shell (with a fallback that may require a new plugin and an AGENTS.md policy change), and the period-close side effect (`lastBuiltPeriodStart`). Highest-uncertainty issue in the epic.

Severity: Medium
Severity Reason: Enhancement, but it is the payoff step of the whole epic (#129) and carries the platform-policy risk (slim Tauri shell) plus the only destructive-ish state transition (rolling the period).

Needs research before implementation: Partly — see `docs/research/issue-140-research.md`.

### Research Needed

The library and chart questions are researched in `docs/research/issue-140-research.md`; read it before starting. One question **cannot** be answered from the codebase:

- **Tauri download behavior:** whether an anchor + blob-URL download actually saves a file in the Tauri WebView2 shell has no verified answer in the repo and must be settled **in this issue, in the real installed app**. If it does not work, the approved fallback must be decided — likely `@tauri-apps/plugin-dialog` + `plugin-fs`, which requires a dependency, a capability in `src-tauri/capabilities/default.json`, and an explicit AGENTS.md slim-shell policy update (currently opener + notification only). This is a merge-blocking gate, not a "pending" checklist item; escalate the decision rather than shipping it silently.

## Summary

Convert the edited `DeckPlan` from #139 into a real `.pptx` and get it onto disk: light, minimal, 16:9, readable on a TV, ~6–8 slides typical, **real editable text boxes and bullets** (wording stays editable in PowerPoint), charts as images, speaker notes plus suggested seconds on every slide. Delivery uses a browser blob download, verified in the Tauri webview with a fallback if needed. **Only after the file is successfully delivered** does the tracker stamp `lastBuiltPeriodStart` with the period key it just built, which closes that period and makes the next grid period the target. No deck is ever stored — the app's job ends when the file lands on disk.

## Steps to Reproduce Context

1. Complete the preview (#139) and press Export — the handler seam exists but writes no file.
2. Search the repo for `Blob` / `createObjectURL` / `plugin-dialog` / `plugin-fs` — there is **no download or file-save code anywhere**; `src-tauri` has only the opener and notification plugins.
3. Observe `src-tauri/Cargo.toml` and `src-tauri/capabilities/default.json` — the slim-shell policy in AGENTS.md pins the native surface to exactly those two plugins.

## Expected Behavior

- Export produces a `.pptx` with the exact edited plan from #139: title slide (tracker name + purpose + period label), recaps, misses, next plans, charts, closing commitments, appendix.
- Text and bullets are real editable text boxes; charts are embedded images; every slide has speaker notes and a suggested-seconds note.
- The file downloads in the browser (anchor + blob). In the Tauri shell, the download is **verified by actually running it**; if the webview refuses, the researched fallback path is implemented (and the policy change is made explicitly).
- `lastBuiltPeriodStart` is stamped with the built period's `LocalDateKey` only after successful delivery. A failed download leaves the period open — nothing is lost, rebuild is always available.
- Stamping closes that period: the deck is considered built for it (per #135), the due badge clears, and the next grid period becomes the target. The field never moves backwards, so a retry cannot reopen a period that was already built.
- The pptx library is loaded via dynamic `import()` inside the export flow only — never in the entry chunk (route-level lazy loading precedent in `src/App.tsx`).

## Actual Behavior

No export, download, or file-write capability exists anywhere in the app.

## Requirements for completed issue

1. Renderer and delivery built on `docs/research/issue-140-research.md`, **plus a verified answer to the Tauri download question in the real installed app** (recorded as yes/no in the PR body).
2. Renderer module (suggested `src/lib/goals/deck/render.ts`) mapping each `DeckSlide` type to pptx constructs: 16:9 layout, light minimal styling, TV-readable font sizes, editable text/bullets, notes + suggested seconds.
3. Chart rendering per the researched rasterization approach, fed by the #138 series data.
4. Download delivery: browser blob download by default; verified Tauri behavior with the approved fallback if required.
5. `lastBuiltPeriodStart` set to the built period's `LocalDateKey` only on confirmed delivery (download initiated successfully), via the GoalProvider save path; the write is a normal staged-sync `saveGoals` call and is guarded so it cannot move backwards.
6. Dynamic import of the pptx library; `pnpm run build` keeps it out of the entry chunk (compare chunk output before/after).
7. Rebuild is always available — building again with no new check-ins produces the same deck from the same data (deterministic per #138).

### Testing

- Unit: renderer mapping tests per slide type (title, recap with badge, misses, plans, charts, closing, appendix) against a fixture `DeckPlan`; text/notes present on every slide.
- Build check: entry chunk size unaffected (assert via build output inspection; the repo already uses rolldown code-splitting groups in `vite.config.ts`).
- Manual verification checklist in the PR: browser download opens in PowerPoint with editable text; **Tauri app download verified on Windows in the installed app**; failed-download path leaves `lastBuiltPeriodStart` unchanged; after a successful export the period shows as built and a second export targets the next period.

## Context

Code Source: `src/lib/goals/deck/plan.ts`, `types.ts` (#138), `src/components/goals/DeckPreview.tsx` (#139)
Code Description: The plan this issue renders; the export handler seam defined in #139.

Code Source: `vite.config.ts` (~L14–27), `src/App.tsx` (~L36–58)
Code Description: Existing code-splitting: route-level `lazy()` plus rolldown vendor groups — the pptx library must join the lazy tier, not the vendor/entry tier.

Code Source: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`
Code Description: The slim native shell (opener + notification only). Any fallback that adds a plugin changes these three files **and** requires an AGENTS.md policy update — treat that as an explicit, reviewed decision.

Code Source: `src/state/GoalContext.tsx` (#134)
Code Description: The save path for the `lastBuiltPeriodStart` write; remember the staging writer takes the full desired set, so the stamp rides a normal `saveGoals` call and must never be sent alongside a filtered list.

## Notes

- Depends on #138 and #139. The heaviest-risk issue in the epic — the Tauri download result is a merge gate, not a follow-up.
- **No deck archive, ever**: do not persist the generated file, a snapshot, or a render anywhere. The only durable effect of export is `lastBuiltPeriodStart`.
- Batch building two due trackers in one action was explicitly dropped — each tracker is built independently; the Goals page due-badges (#135) make multiple due decks visible.

# Goals Epic — Parallel Work Instructions

Step-by-step operating instructions for delivering issues **#133–#143** (Goals feature) with two parallel worktrees, an `epic/goals` integration branch, and a single dedicated test lane.

Follow the phases in order. Every phase has an exit gate; do not start the next phase until the gate passes.

- **Integrator = ORCH**, working in the main worktree (`C:\Users\dylan\Desktop\Coding\VSCode\WorkTime`) on `epic/goals`.
- **Lane agents = IMPL / IMPL+**, working in `WorkTime-ui` and `WorkTime-engine`.
- The main worktree is the **only** place that starts Supabase, binds port 3000, runs integration/E2E, or runs a Tauri build.

---

## Agent and model assignments (read first)

Every phase below names the agent that does the work. Use exactly this roster; do not re-route work silently.

| Code         | Role                               | Model               | Effort | Runs in                       |
| ------------ | ---------------------------------- | ------------------- | ------ | ----------------------------- |
| **ORCH**     | Orchestrator + integrator          | GPT-6.1 Sol         | medium | opencode, main worktree       |
| **IMPL**     | Routine code implementation        | DeepSeek V4.1 Flash | high   | opencode, lane worktree       |
| **IMPL+**    | Complex/difficult implementation   | GPT-6.1 Sol         | high   | Codex, lane or main worktree  |
| **RESEARCH** | Research documents + verification  | DeepSeek V4.1 Flash | high   | opencode, any worktree        |

Model references, for launching a session explicitly:

| Code         | Reference                                       |
| ------------ | ----------------------------------------------- |
| ORCH         | `opencode/gpt-6.1-sol#medium`                   |
| IMPL         | `opencode-go/deepseek-v4.1-flash#high`          |
| IMPL+        | Codex + GPT-6.1 Sol (high)                      |
| RESEARCH     | opencode `Codebase-Research` agent, `opencode-go/deepseek-v4.1-flash#high` |

How each role is started:

- **ORCH** is the main session in `C:\Users\dylan\Desktop\Coding\VSCode\WorkTime`. It is the only agent that merges branches, edits shared docs, bumps versions, or resolves conflicts.
- **IMPL** is a lane session in `WorkTime-ui` or `WorkTime-engine` (`tools.opencode.session_move`, or spawn with `model: "opencode-go/deepseek-v4.1-flash#high"`). Give it the phase text below, the worktree path, and Section 2's hard rules in the prompt.
- **IMPL+** is the same brief run in Codex with GPT-6.1 Sol at high reasoning. Use it only where this doc says IMPL+ or where an escalation trigger fires.
- **RESEARCH** is the opencode `Codebase-Research` agent at `opencode-go/deepseek-v4.1-flash#high`. It writes `docs/research/**`, drafts `docs/plans/issue-*-decisions.md`, and reports test results — it never edits production code.

### Dispatching the research agent

A Codex-based ORCH cannot spawn an opencode agent as a **subagent**, but it **can** invoke one through
the opencode CLI. Either way the research session is a separate agent: it must not share a worktree
with a live lane session, and ORCH still re-runs any gate it relies on.

**From an opencode ORCH (preferred).** Dispatch with the subagent tool: agent `codebase-research`,
model `opencode-go/deepseek-v4.1-flash#high`, with the worktree path and the research brief in the
prompt. Fully automatic, no shell involvement.

**From a Codex ORCH (shell out to the CLI).** `opencode run` takes the message positionally and has
**no directory flag**, so the working directory is what selects the worktree. Set it first, then pass
agent, model, and brief:

```powershell
Set-Location C:\Users\dylan\Desktop\Coding\VSCode\WorkTime
opencode run --agent codebase-research `
  --model "opencode-go/deepseek-v4.1-flash#high" `
  --auto `
  --title "research: issue-140 export" `
  "Read docs/research/_brief-140.md and write docs/research/issue-140.md. Do not edit production code."
```

Flags that matter:

- `--agent <id>` — the exact agent id from your opencode config; the display name may be
  `Codebase-Research` while the id is lowercase-hyphenated. Do not guess it.
- `--model provider/model#variant` — pin it, so a change to the default model cannot silently move
  research onto a different model.
- `--auto` — auto-approves permissions that are not explicitly denied. Required for an unattended
  run, which would otherwise block on a prompt; it also means the run *can* write, so verify after.
- `--format json` — structured output when ORCH wants to parse the result instead of reading prose.
- `-s/--session <id>` or `-c/--continue` — continue an existing research session rather than opening
  a fresh one.
- `-f/--file <path>` — attach the brief to the message.

The same mechanism reaches any configured opencode agent, not just research. The independent diff
read that RESEARCH owes at Phase 7 and Phase 12 can be run the same way:

```powershell
opencode run --agent review --model "opencode-go/deepseek-v4.1-flash#high" "Review the changes in this worktree against docs/goals/contract.md and report findings only."
```

Two constraints that follow from the flags:

- **Worktree targeting is the caller's job.** Codex should `Set-Location` into the target worktree or
  invoke its shell tool with that `workdir`. Pointing a shelled-out research run at a lane worktree
  while that lane's IMPL session is live breaks Rule 5, so use the main worktree or a scratch
  worktree.
- **A shelled-out run is untrusted until checked.** RESEARCH is allowed to write only docs, so after
  the run:

```powershell
git status --short              # only docs/ should be dirty
git diff --stat -- src          # must be empty
```

**Manual fallback.** If the CLI is unavailable in a given session, write the brief to
`docs/research/_brief-<issue>.md`, run the research session yourself, and hand ORCH the resulting
path. The handoff is a file, so nothing is lost if the session restarts.

Whichever path is used, **ORCH re-runs any gate whose result it relies on.** RESEARCH results are
advisory input, never a gate.

Rules:

1. ORCH does every merge, every conflict resolution, every `docs/goals/contract.md` edit, and the Phase 13 version bump. No other agent pushes `epic/goals` or `main`.
2. IMPL implements the frozen contract. It does not decide architecture; if the contract is wrong it reports and stops.
3. IMPL+ is mandatory for the phases marked **IMPL+** in the routing table, and for anything that hits an escalation trigger.
4. RESEARCH never commits production code and never runs a gate whose result ORCH relies on without ORCH re-running it.
5. One agent per branch at a time. Two agents must never share a worktree — a shelled-out `opencode run` session counts as an agent for this rule.
6. Every lane handoff uses the Section 2 report format (branch, SHA, files, tests, contract deviations).

### Lane brief template

Paste this as the prompt when starting an IMPL session (swap the bracketed values):

```text
You are the IMPL agent for one issue in the WorkTime Goals epic.

Worktree: C:\Users\dylan\Desktop\Coding\VSCode\WorkTime-[ui|engine]
Branch: [issue/<n>-<slug>]
Issue: [#<n> — <title>]
Read first: docs/plans/goals-epic-parallel-workflow.md (phase [N]),
            docs/goals/contract.md

Scope: implement only the phase [N] files. Follow the contract signatures
exactly. Do not redesign, do not add features, do not touch other owners' files.

Gate: pnpm lint:app ; pnpm test:unit [narrow path] ; pnpm test:unit ; pnpm build
Commit message: [exact message from the phase]

Never run: supabase, pnpm dev on 3000, test:e2e, test:integration, tauri build.
Never edit: migrations, shared docs, package.json, pnpm-lock.yaml, src-tauri/**,
            src/state/types.ts, src/lib/data/**, src/lib/goals/cadence.ts.
Never add a hard delete for trackers, goals, or check-ins; v1 is archive/lifecycle only.

If the contract is wrong, or you hit an escalation trigger (two identical gate
failures, a needed signature change, or a file outside your ownership), stop
and report instead of improvising.

Report back: branch, commit SHA, files touched, tests added, contract deviations.
```

### Escalation triggers

Stop the IMPL lane, hand the branch to IMPL+, when any of these is true:

- the same gate fails twice for the same reason, or the agent starts guessing at fixes;
- the fix must touch `src/lib/data/**`, `supabase/migrations/**`, or `src/state/types.ts`;
- the work needs a signature change in `docs/goals/contract.md`;
- the change spans more than one lane's ownership;
- webview/Tauri runtime behavior or pptx output must be diagnosed;
- a data-merge or migration correctness question is open (LWW behavior, tombstones, v8→v9);
- a cadence-rule or period-boundary question is not settled by `docs/goals/contract.md` (for example, what a boundary resolves to in a month where the 1st is a Monday).

Escalating is cheaper than thrashing. A Flash lane that "sort of works" but leaves a design choice open is not done: ORCH either decides it in the contract or escalates it.

### Phase routing at a glance

| Phase | Issue / work                                   | Implementing agent                     | Gate & merge owner               |
| ----- | ---------------------------------------------- | -------------------------------------- | -------------------------------- |
| 1     | #133 foundation (migrations, staging v9, sync) | **IMPL+**                              | ORCH                             |
| 2     | Contract + fixtures                            | ORCH (contract), IMPL (fixtures)       | ORCH                             |
| 3     | Worktrees + bootstrap                          | ORCH                                   | ORCH                             |
| 4     | #134 page, provider, CRUD                      | IMPL                                   | ORCH                             |
| 5     | #135 pure (periods, slips)                     | IMPL                                   | ORCH                             |
| 6     | #135 mount (badge, nudge)                      | IMPL                                   | ORCH                             |
| 7     | #136 wizard ∥ #138 deck plan                   | IMPL (both)                            | ORCH; RESEARCH independent check |
| 8     | Milestone merge to `main`                      | —                                      | ORCH; RESEARCH smoke checklist   |
| 9     | Dogfood period                                 | user + RESEARCH notes                  | ORCH records findings            |
| 10    | #139 preview                                   | IMPL                                   | ORCH                             |
| 11    | #140 pptx + delivery                           | **IMPL+** (main worktree)              | ORCH                             |
| 12    | #137 evidence ∥ #141 goal-set file             | IMPL (both)                            | ORCH; RESEARCH independent check |
| 13    | Final merge + version bump                     | ORCH                                   | ORCH                             |
| 14    | #143, then #142                                | **IMPL+**                              | ORCH                             |

---

## Topology at a glance

```
main ──● #133 ────────────────────────────────────────────────┐
        └── epic/goals ──● contract + fixtures              │
                      ├── lane A (WorkTime-ui)     #134 → #135-mount → #136 → #137
                      └── lane B (WorkTime-engine) #135-pure → #138 → #139 → #141
              main worktree (ORCH): integrator + test lane + #140
```

| Path              | Branch                                                     | Role                    | Agent                                             | Allowed to run    |
| ----------------- | ---------------------------------------------------------- | ----------------------- | ------------------------------------------------- | ----------------- |
| `WorkTime`        | `main`, `epic/goals`, `issue/140-…`                        | Integration + test lane | **ORCH** (`opencode/gpt-6.1-sol#medium`)          | everything        |
| `WorkTime-ui`     | `issue/134-…`, `issue/135-…`, `issue/136-…`, `issue/137-…` | Lane A                  | **IMPL** (`opencode-go/deepseek-v4.1-flash#high`) | lint, unit, build |
| `WorkTime-engine` | `issue/135-…`, `issue/138-…`, `issue/139-…`, `issue/141-…` | Lane B                  | **IMPL** (`opencode-go/deepseek-v4.1-flash#high`) | lint, unit, build |

File ownership (violations are the #1 source of merge failures):

| Owned by                          | Files                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#133 only** (never anyone else) | `src/state/types.ts`, `src/lib/goals/cadence.ts`, `src/lib/data/**`, `src/lib/data/sync/**`, `supabase/migrations/*`                                                       |
| **Lane A**                        | `src/components/GoalsPage.tsx`, `src/state/GoalContext.tsx`, `src/App.tsx`, `src/components/goals/CheckInWizard.tsx`, `src/components/goals/DeckPreview.tsx` (mount only) |
| **Lane B**                        | `src/lib/goals/{periods,slips,evidence,goalSetFile}.ts`, `src/lib/goals/deck/**`                                                                                          |
| **ORCH only**                     | `AGENTS.md`, `docs/FEATURES.md`, `package.json`, `pnpm-lock.yaml`, `src-tauri/**`, `docs/goals/contract.md`                                                               |

`cadence.ts` is #133's because the tracker factory must validate a rule at creation time; **it does
not compute boundaries.** Boundary resolution lives in lane B's `periods.ts` (Phase 5). Do not have
two modules that both know how a period starts.

---

## 1. Prerequisites (once)

- Docker Desktop running (local Supabase).
- Node + `pnpm`, Rust toolchain (`cargo`, required by `pnpm test:platform`), Playwright Chromium installed.
- Three Vite variables known: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_APP_URL`.
- `.env.development.local`, `.env.production.local`, and `supabase/.env.local` exist in the main worktree. All are gitignored — only `.env.example` is tracked.

```powershell
pnpm install
pnpm supabase:start
pnpm supabase:status
```

Notes:

- `pnpm test:integration` begins with `supabase db reset` — **destructive** to the shared local database. Only ever run it from the main worktree.
- `pnpm build` runs `vite build` in production mode and **requires** `VITE_PUBLIC_APP_URL`. A worktree without env files cannot pass the build gate.
- `pnpm test:all` runs `verify-pwa-build.mjs`, which inspects `dist/`. Run `pnpm build` first, or use `pnpm branch:check` (which builds first).
- **Prior work is complete.** The binding #133 decisions live in `docs/plans/issue-133-decisions.md`, `docs/issues/issue-133.md` reflects them, and the export/integration research is in `docs/research/issue-140-research.md` and `docs/research/issue-143-research.md`. Read the decisions doc before Phase 1; it is the reason several issue texts differ from the original brainstorm.
- One research question was **not** closed: whether an anchor + blob URL actually saves a file in the WebView2 shell. It could not be settled without a real Tauri build, so it is a **blocking task in Phase 11**, not a prerequisite here. Do not assume a yes.

---

## Phase 1 — Land #133 on `main` (alone)

**Agent: IMPL+ (GPT-6.1 Sol, high).** Do not assign #133 to Flash — it owns migrations, the staging schema ladder, and sync semantics. **ORCH** runs the merge, push, and v8→v9 verification.

Only #133 is in flight. It owns migrations and the staging schema bump.

```powershell
git switch main
git pull
git switch -c issue/133-goals-foundation
```

Implement, then run the full foundation gate in the main worktree:

```powershell
pnpm lint:app
pnpm test:unit
pnpm supabase:start
pnpm test:integration
pnpm build
pnpm test:platform
```

Merge to `main`:

```powershell
git switch main
git merge --no-ff issue/133-goals-foundation
pnpm build
pnpm test:unit
pnpm test:integration
git push origin main
git branch -d issue/133-goals-foundation
```

Notes:

- **Read `docs/plans/issue-133-decisions.md` first.** It is binding, and #133 is the one issue where deviating from it silently corrupts the whole epic. In particular: whole-row LWW only (plus the check-in natural-key dedupe), no cascade provenance, nine flat staging fields, and `lastBuiltPeriodStart` as a period key that never moves backwards.
- Layer-2 through layer-4 issues depend on the **v8→v9 ladder** being correct, so test the upgrade path against a real v8 record: open the app on `main` before the change (creates a v8 staging record), then after the change confirm `schemaVersion: 9` and preserved data. Do not clear localStorage in between.
- The nine new staging fields (`goalTrackers`, `goals`, `goalCheckIns` plus their `*UpdatedAt` and `*Tombstones` maps) must be added to the record **and** to `lastSynced` in the same ladder step. A field added to one and not the other fails the first pull.
- `src/lib/goals/cadence.ts` is part of this issue (rule validation for the tracker factory) but **boundary math is not** — that is #135's `periods.ts`. Do not implement period windows here.
- Two migrations expected: `20261030000000_goals.sql` and `20261031000000_goal_staged_sync_rpc.sql`. The RPC grows six positional arguments (36 → 42) through the pet private/public wrapper pattern. Nothing after `20261027000000` currently exists, so ordering is safe — keep it that way.
- No other branch may touch `supabase/migrations` for the rest of this epic.
- #133 is dark (no route, no nav, no provider), so merging it to `main` early is safe and gives both lanes a stable, already-migrated base.

**Gate 1:** `main` is green, schema v9 is live, `main` is pushed.

---

## Phase 2 — Cut `epic/goals` and land the contract

**Agent: ORCH** writes, freezes, and commits `docs/goals/contract.md`. **IMPL (Flash high)** may generate `src/lib/goals/testFixtures.ts` from the frozen contract, but ORCH reviews and commits it. Signature authority stays with ORCH.

```powershell
git switch -c epic/goals main
git push -u origin epic/goals
```

Create and commit the shared contract **before** any lane opens:

1. `docs/goals/contract.md`
    - Types from #133 (including `GoalCadence`, `cadenceAnchorAt`, `lastBuiltPeriodStart`, and `periodStart: LocalDateKey` with no `periodEnd`) and the exported signatures of `cadence.ts`, `periods.ts`, `slips.ts`, `evidence.ts`, `deck/types.ts`, `deck/plan.ts`, `goalSetFile.ts`.
    - The cadence boundary function's exact semantics, including the Mon/Tue snap-backward rule and what a period label is derived from (the period's month, not the `periodStart` string's month).
    - Module ownership table (who may create which file), with `cadence.ts` under #133 and boundary/period computation under #135.
    - Page mount-point names #134 will leave for the badge, check-in entry, and deck entry.
    - The `saveGoals` completeness rule: the full desired set, including archived trackers and achieved/dropped goals; filtering is a derivation concern only.
    - Worktree bootstrap + gate commands (sections 3 and 4 of this doc).
    - The #133 decisions from `docs/plans/issue-133-decisions.md`, restated as binding contract rules (do not link-only; lanes must not have to read a second document to implement a signature).
    - Agent ownership: which of ORCH / IMPL / IMPL+ / RESEARCH may touch each area, and which agent owns each gate.
2. `src/lib/goals/testFixtures.ts` — shared goal/tracker/check-in fixture builders, owned by the integrator.

```powershell
pnpm lint:app
pnpm test:unit
pnpm build
git add docs/goals/contract.md src/lib/goals/testFixtures.ts docs/plans docs/research docs/issues
git commit -m "docs(goals): contract, shared fixtures, decisions, research, parallel workflow"
git push
```

Notes:

- Freeze signatures here. Changing a signature later means rebasing both lanes.
- Fixtures are owned by the integrator; lanes import, never edit.
- Commit the workflow doc, the decisions doc, and the issue/research docs in this same commit. Worktrees are created from the branch, so **untracked** planning files in the main worktree do not exist in `WorkTime-ui`/`WorkTime-engine` — a lane can only read what has been committed. This is also why the issue texts had to be amended before this point.

**Gate 2:** `epic/goals` exists on origin, contract + fixtures are committed, unit + build pass.

---

## Phase 3 — Create the two lane worktrees

**Agent: ORCH** creates worktrees, copies env files, and runs `pnpm install`. Lane sessions start as **IMPL (Flash high)**; start them only after Gate 3 passes.

```powershell
git worktree add ..\WorkTime-ui -b issue/134-goals-page epic/goals
git worktree add ..\WorkTime-engine -b issue/135-goals-periods epic/goals
git worktree list
```

Bootstrap each worktree (run in each):

```powershell
Copy-Item .env.development.local ..\WorkTime-ui\
Copy-Item .env.production.local ..\WorkTime-ui\
pnpm install
```

```powershell
Copy-Item .env.development.local ..\WorkTime-engine\
Copy-Item .env.production.local ..\WorkTime-engine\
pnpm install
```

Verify the lane gate works before any feature work (run in each lane):

```powershell
pnpm lint:app
pnpm test:unit
pnpm build
```

Notes:

- Do **not** run `pnpm supabase:start`, `pnpm supabase:reset`, `pnpm test:integration`, `pnpm test:e2e`, or `pnpm tauri build` in a lane worktree. `supabase db reset` applies _that worktree's_ migrations and deletes the other branches' schema mid-session.
- If a lane must run `pnpm dev` to eyeball UI, use a distinct port so localStorage origins differ: `pnpm dev --port 3100`. Never use that server for Playwright — `playwright.config.ts` hardcodes `baseURL: http://localhost:3000` with `reuseExistingServer` when `CI` is unset, so it would silently test another worktree's app.
- `supabase/.env.local` is only needed for `pnpm supabase:serve`; lanes never serve functions, so it can be omitted.
- Start each lane as its own **IMPL (Flash high)** session in that worktree, with the lane brief template below as the prompt. Never reuse the ORCH session as a lane session.
- Lane agents must be told explicitly: no Supabase, no dev server, no E2E, no Tauri builds, no shared-doc edits.

**Gate 3:** both lanes are clean and their local gate passes on an untouched tree.

---

## Phase 4 — Lane A: #134 (goals page, provider, CRUD)

**Agent: IMPL (Flash high)** in `WorkTime-ui`. **ORCH** merges and runs the epic gate. This is well-specified UI/provider work — do not burn Sol on it.

In `WorkTime-ui`:

```powershell
git fetch origin
git rebase origin/epic/goals
```

Implement #134. Lane gate:

```powershell
pnpm lint:app
pnpm test:unit src/components/GoalsPage.test.tsx src/state/GoalContext.test.tsx src/App.test.tsx
pnpm test:unit
pnpm build
```

Commit, then hand off:

```powershell
git add -A
git commit -m "feat(goals): goals page, provider, tracker and goal CRUD (#134)"
git log --oneline -1
```

Integrator (ORCH) merges into `epic/goals` from the main worktree:

```powershell
git switch epic/goals
git merge --no-ff issue/134-goals-page
pnpm lint:app
pnpm test:unit
pnpm build
```

Notes:

- #134 must leave explicit mount points for #135's badge, #136's check-in entry, and #139's deck entry, with the mount-point names recorded in the contract. Later issues attach there instead of restructuring the page.
- `GoalProvider` goes inside `AuthenticatedShell` next to `HabitProvider`, inside `SyncProvider`. Public auth pages must never trigger goal reads.
- The tracker form builds a **cadence rule**, not an enum: "every N weeks on <weekday>" or "the first <weekday> of each month". Validate with #133's `cadence.ts` before saving, and set `cadenceAnchorAt` to the resolved boundary (reset it whenever the rule changes).
- **Trackers are archive-only.** There is no hard delete in v1, and adding one re-opens the tombstone-cascade work that #133 deliberately skipped. Do not ship a delete affordance.
- The provider's save payload is derived from the **full** `loadGoals()` result, never from the currently visible tracker or the non-archived list. A filtered save looks like a mass delete to the staging writer.
- A fresh tracker has **no open period** until its first boundary. The page needs copy for that state, and the check-in entry must be unavailable rather than opening a wizard with no period.
- `goals_state_v1` is UI-only device state: never synced, never in the staging store.

---

## Phase 5 — Lane B: #135 pure half (periods, slips, fixtures-driven)

**Agent: IMPL (Flash high)** in `WorkTime-engine`. **ORCH** merges. Escalate to IMPL+ only if the period/slip semantics cannot be settled from the contract.

In `WorkTime-engine`:

```powershell
git fetch origin
git rebase origin/epic/goals
```

Implement only `src/lib/goals/periods.ts`, `src/lib/goals/slips.ts`, and their tests. No component, no page, no `GoalsPage.tsx`.

```powershell
pnpm lint:app
pnpm test:unit src/lib/goals
pnpm test:unit
pnpm build
git add -A
git commit -m "feat(goals): period windows and consecutive-slip derivation (#135)"
```

Integrator (ORCH) merges:

```powershell
git switch epic/goals
git merge --no-ff issue/135-goals-periods
pnpm lint:app
pnpm test:unit
pnpm build
```

Notes:

- This merge is what unblocks #136. Do it before #136 starts, even if the badge/nudge work is unfinished.
- Signatures were frozen in the contract; if implementation forced a change, update `docs/goals/contract.md` in the same merge and note it for lane A.
- **Periods are an anchored local-date grid**, not a rolling window from `lastBuiltPeriodStart`. Derive boundaries from `cadenceAnchorAt` + the cadence rule, and derive `periodEnd` as the next boundary (it is not stored).
- Period length is **variable**: a `monthly-weekday` period is roughly 27–35 days because of the Mon/Tue snap-backward rule. Never add a fixed duration.
- Use `LocalDateKey` fixtures and the helpers in `src/lib/todos/calendar.ts`; express expectations as date keys rather than `Date` objects so assertions cannot drift with the runner's timezone. No `new Date()` in assertions, and no reliance on the host's local time.
- Period labels are derived from the period's **month**, not from the `periodStart` string's month — a snapped-backward October period starts in September.
- Archived trackers are excluded from period and due derivation, but they are still persisted. Exclusion is a derivation rule, never a reason to omit them from a save.
- Slip counting walks stored check-ins in period order and must tolerate historical keys that no longer align to the current grid after a cadence change.

**Gate 5 (phase gate):** `epic/goals` now has #133 + #134 + #135-pure, and `test:unit` + `build` pass. Run the heavy gate once here:

```powershell
pnpm supabase:start
pnpm supabase:serve   # separate terminal, needed for E2E
pnpm test:all
```

---

## Phase 6 — Lane A: #135 mount (badge + nudge)

**Agent: IMPL (Flash high)** in `WorkTime-ui`. **ORCH** merges.

Lane A owns the page, so the mount happens there, after a rebase onto lane B's modules.

In `WorkTime-ui`:

```powershell
git switch -c issue/135-deck-due-mount epic/goals
git fetch origin
git rebase origin/epic/goals
```

Implement the due badge on tracker cards, the slip counter on goal rows, and the foreground nudge (session-scoped dedupe, baseline on mount, `notifyNow` directly — not `maybeNotifyTimerEnd`).

```powershell
pnpm lint:app
pnpm test:unit src/components/GoalsPage.test.tsx
pnpm test:unit
pnpm build
git add -A
git commit -m "feat(goals): due badge and deck-due nudge (#135)"
```

Merge in the main worktree:

```powershell
git switch epic/goals
git merge --no-ff issue/135-deck-due-mount
pnpm lint:app
pnpm test:unit
pnpm build
```

Notes:

- Do not re-derive period math in the component; import from lane B's `periods.ts`/`slips.ts`.
- "Due" means **the most recent completed grid period starts later than `lastBuiltPeriodStart`** — not "cadence elapsed since the stamp". Those differ the moment a cadence changes or a build is skipped, and the grid version is the one that stays consistent with the deck.
- A tracker with no open period yet (before its first boundary) shows **no badge and fires no nudge**. Same for archived trackers.
- The nudge must not replay crossings that happened while the app was closed — baseline the due state on mount, mirroring `PetReminderContext`.
- `lastBuiltPeriodStart` never moves backwards (it is guarded in #133's merge and writer), so the badge cannot re-fire for a period that was already built.

---

## Phase 7 — Lane A: #136 ∥ Lane B: #138

**Agent: IMPL (Flash high)** on both lanes, one session each. **ORCH** merges in the stated order and runs `test:all`. **RESEARCH (Codebase-Research, Flash high)** does an independent read of the merged diff against the contract before Gate 7.

Both lanes run at the same time. Lane A stays on the page and wizard; lane B stays in `src/lib/goals/deck/`.

### Lane A (#136 wizard)

**Agent: IMPL (Flash high).**

```powershell
git switch -c issue/136-checkin-wizard epic/goals
git fetch origin
git rebase origin/epic/goals
```

Implement `src/components/goals/CheckInWizard.tsx` + the minimal past-period editor.

```powershell
pnpm lint:app
pnpm test:unit src/components/goals src/state/GoalContext.test.tsx
pnpm test:unit
pnpm build
git add -A
git commit -m "feat(goals): goal-by-goal check-in wizard (#136)"
```

Notes:

- Upsert identity is `(goalId, periodStart)` where `periodStart` is a `LocalDateKey`; always pass the complete check-in set to the staging writer (it diffs the full desired set).
- Pin the period at open from the **anchored grid**; on a `revision` reload that advances `lastBuiltPeriodStart`, warn and offer reload/continue instead of silently retargeting.
- This guard is **test-verifiable only** until #140 stamps `lastBuiltPeriodStart`. Record that in the PR/commit body — do not claim real-world verification.
- If the tracker has no open period yet (before its first boundary), the wizard refuses to open and explains when the first period starts. There is no backfill and no partial first period.
- When two devices create the same period offline, the merge keeps the server row and drops the local duplicate (natural-key dedupe in #133). Do not build a UI that assumes the id the wizard generated survives sync.
- No project prefill here; that is #137.

### Lane B (#138 deck plan)

**Agent: IMPL (Flash high).** Escalate to IMPL+ only if the `DeckPlan` shape still has to change; a shape change is a contract change and ORCH must sign it off.

```powershell
git switch -c issue/138-deck-plan epic/goals
git fetch origin
git rebase origin/epic/goals
```

Implement `src/lib/goals/deck/types.ts` + `plan.ts` + tests. Pure only: injected `now`, no I/O, no clock, no random IDs, no persistence.

```powershell
pnpm lint:app
pnpm test:unit src/lib/goals/deck
pnpm test:unit
pnpm build
git add -A
git commit -m "feat(goals): deterministic deck plan builder (#138)"
```

### Merge order (narrowest first)

```powershell
git switch epic/goals
git merge --no-ff issue/138-deck-plan
git merge --no-ff issue/136-checkin-wizard
pnpm lint:app
pnpm test:unit
pnpm build
pnpm test:all
```

Notes:

- Merge the pure module (#138) before the page work (#136) so the page owner rebases onto a stable base.
- If lane B's `DeckPlan` shape had to change during implementation, update `docs/goals/contract.md` and tell lane A before #139 starts.
- The chart decision recorded in `docs/research/issue-140-research.md` constrains what series data #138 emits. If the research chose hand-SVG rasterization, #138 must emit plain numbers, not React elements.

**Gate 7:** `test:all` passes on `epic/goals`.

---

## Phase 8 — Milestone: merge the check-in loop to `main`

**Agent: ORCH.** **RESEARCH (Codebase-Research, Flash high)** runs the browser + Tauri smoke checklist and reports results; ORCH must not merge until that report is in.

```powershell
git switch epic/goals
pnpm build
pnpm test:all
git switch main
git merge --no-ff epic/goals
pnpm build
pnpm test:unit
git push origin main
git switch epic/goals
git merge main
git push
```

Notes:

- This is the first user-visible milestone: create tracker → create goal → check in → see slip badge.
- No version bump here — the version bump happens once, at the final merge (Chunk 13).
- After merging, `main` and `epic/goals` diverge by one merge commit; merging `main` back into `epic/goals` keeps the next lane rebase trivial.
- Ship this before the deck lane. The next phase is dogfooding.

**Gate 8:** the loop works end-to-end in the real app (browser and Tauri), with data surviving a remount and a second device pull.

---

## Phase 9 — Dogfood one real period

**Agent: you drive the app; RESEARCH (Codebase-Research, Flash high) records and synthesizes** into `docs/research/goals-dogfood-1.md`. **ORCH** turns findings into fixture/copy changes (integrator-owned files) before #139.

Run from `main` in the main worktree.

```powershell
pnpm dev        # browser surface
pnpm app        # Tauri surface
```

Collect friction in `docs/research/goals-dogfood-1.md`:

- How much text does a real check-in contain? (feeds #138 recap slides)
- Are miss reasons actually written? (feeds the thin-item pass in #139)
- Do planned items get due dates? (feeds the "next plans" slide)
- Do slip counts feel right at 2 consecutive periods?
- Does the chosen cadence rule (every-N-weeks or first-weekday-of-month) match the work tracker's review rhythm?

Notes:

- **Plan the window before you create the trackers.** The first period starts at the first boundary after `createdAt`, so a tracker created just after a boundary has no open period for almost a full cycle. Create the dogfood trackers timed so a real period begins inside the window, or the pause costs you a full cadence instead of a period.
- Do not clear localStorage during this window; the staging record is the sample.
- Do not run `pnpm test:integration` mid-dogfood unless you accept a database reset.
- Feed the findings into #138's fixtures and copy **before** #139 starts, and into #142's brief later.
- Timebox the pause, or it becomes the end of the epic.

---

## Phase 10 — Lane B: #139 preview

**Agent: IMPL (Flash high)** in `WorkTime-engine`. Do not use lane B for this if it would touch `GoalsPage.tsx` beyond the agreed mount — that file is lane A's, so hand the mount hunk to ORCH or lane A. **ORCH** merges.

```powershell
git switch -c issue/139-deck-preview epic/goals
git fetch origin
git rebase origin/epic/goals
```

Implement `src/components/goals/DeckPreview.tsx` + the GoalsPage mount. Wire Export to a clearly defined handler that currently does nothing (`#140` fills it).

```powershell
pnpm lint:app
pnpm test:unit src/components/goals
pnpm test:unit
pnpm build
git add -A
git commit -m "feat(goals): deck preview with reorder, hide, and appendix promotion (#139)"
```

Merge:

```powershell
git switch epic/goals
git merge --no-ff issue/139-deck-preview
pnpm lint:app
pnpm test:unit
pnpm build
```

Notes:

- Plan edits are in-memory only. Closing the preview discards them; Build always regenerates. Do not cache a plan anywhere, and do not add a deck archive.
- Keep any pptx-adjacent import out of the entry chunk — dynamic `import()` only, and only inside the export flow.
- The talk-length estimate is the only pressure mechanism. No slide caps, no "too many goals" warnings.

---

## Phase 11 — #140 in the main worktree (pptx + delivery)

**Agent: IMPL+ (GPT-6.1 Sol, high)** — this is the highest-risk issue in the epic (pptx generation, chart rasterization, WebView2 delivery, native policy). **ORCH** runs the merge. **RESEARCH (Codebase-Research, Flash high)** independently runs `pnpm test:platform`, the chunk check, and the browser-download half of the manual checklist; Sol verifies the Tauri half.

#140 runs in `epic/goals` in the main worktree — not in a lane. It needs a real `pnpm tauri build` and manual Windows verification, and only one Tauri build may run at a time.

```powershell
git switch epic/goals
git switch -c issue/140-deck-export
```

Add the renderer, the chart path recorded in `docs/research/issue-140-research.md`, and delivery:

```powershell
pnpm add pptxgenjs          # or the library chosen in the research
pnpm lint:app
pnpm test:unit src/lib/goals/deck
pnpm build
```

Chunk check — confirm the library is not in the entry chunk:

```powershell
Get-ChildItem dist\assets | Sort-Object Length -Descending | Select-Object -First 10 Name, Length
```

Tauri verification — **this is the open research question, and it blocks the merge**:

```powershell
pnpm tauri build
Get-ChildItem src-tauri\target\release\bundle\msi
pnpm test:platform
```

Decision required before merge: does an anchor + blob URL **actually save a file** in the real WebView2 shell? Build the MSI, run the installed app, export a deck, and record a yes/no in the PR body. If it fails, implement the researched fallback (dialog + fs plugin) and document the policy change — do not ship an untested download path and call the manual checklist "pending".

Manual checklist recorded in the PR/commit body:

- Browser download produces a `.pptx` that opens in PowerPoint with **editable text**.
- Tauri app download saves a file, verified in the real installed app (or the researched fallback is implemented and the policy change is explicit).
- A failed download leaves `lastBuiltPeriodStart` unchanged.
- After a successful export, the deck shows as built for that period and the next grid period is the new target.

Notes:

- `lastBuiltPeriodStart` stores the **period key** of the built deck (a `LocalDateKey`), not an export timestamp, and is written only after the download is initiated successfully, via the normal `saveGoals` staged write. The writer refuses a value earlier than the one already staged, so a retry or a stale provider cannot reopen a closed period.
- If the fallback adds `plugin-dialog`/`plugin-fs`, all of these change together: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, package dependencies, and `AGENTS.md`. Re-run `pnpm test:platform` after each edit — it runs `cargo check` and asserts the slim-shell invariants.
- In `AGENTS.md` and `package.json`, never write the literal strings `test:rust` or `mock-ipc`; `verify-platform-cleanup.mjs` fails on them.
- No deck archive, ever. The only durable effect of export is `lastBuiltPeriodStart`.
- Lanes must not run `pnpm tauri build` while this is in flight (shared `target/` and Cargo lock).

Merge:

```powershell
git switch epic/goals
git merge --no-ff issue/140-deck-export
pnpm lint:app
pnpm test:unit
pnpm build
```

---

## Phase 12 — Lane A: #137 ∥ Lane B: #141

**Agent: IMPL (Flash high)** in both lanes, one session each. **ORCH** makes the `evidence.ts` ownership amendment below, merges, and runs `test:all`. **RESEARCH (Codebase-Research, Flash high)** reviews the merged diff against the contract before Gate 12. Escalate #137 to IMPL+ if the prefill/freeze logic forces provider or state changes.

### Lane A (#137 evidence)

```powershell
git switch epic/goals
git switch -c issue/137-goal-evidence
```

Ownership note: the contract assigns `src/lib/goals/evidence.ts` to lane B, but #137's mount lives in lane A's wizard. Amend `docs/goals/contract.md` before starting so lane A owns both the selector and its mount — splitting them across lanes buys nothing here and costs a rebase.

Then mount the checkbox suggestions, hours rollup, In Progress prefill, and the evidence IDs write into the wizard.

```powershell
pnpm lint:app
pnpm test:unit src/lib/goals/evidence.test.ts src/components/goals
pnpm test:unit
pnpm build
```

### Lane B (#141 goal-set file)

```powershell
git switch epic/goals
git switch -c issue/141-goal-set-file
```

Implement `src/lib/goals/goalSetFile.ts` (versioned, human-diffable, strict validation, no I/O) + the export/import UI reusing #140's download helper.

```powershell
pnpm lint:app
pnpm test:unit src/lib/goals/goalSetFile.test.ts
pnpm test:unit
pnpm build
```

Merge (pure/lib first, then the mounted UI):

```powershell
git switch epic/goals
git merge --no-ff issue/141-goal-set-file
git merge --no-ff issue/137-goal-evidence
pnpm lint:app
pnpm test:unit
pnpm build
pnpm test:all
```

Notes:

- #141's export must exclude metric `current`, `overridePinned`, check-ins, `lastBuiltPeriodStart`, `cadenceAnchorAt`, and timestamps. It **includes** the cadence rule itself (the union serializes as plain data).
- #141 always imports as a **new** tracker with fresh IDs; never merge or replace.
- #137 is a best-effort join: never-finished Done tasks and deleted backend rows are invisible. Say so in the UI copy or docs rather than hiding it.
- Freeze prefill on first manual edit; only an explicit refresh re-syncs.

**Gate 12:** `test:all` green on `epic/goals`; #133–#141 complete except follow-ups.

---

## Phase 13 — Final epic → `main` (single version bump)

**Agent: ORCH only.** ORCH does the shared-doc pass, the version bump, the final gate, and the merge. **RESEARCH (Codebase-Research, Flash high)** audits the outputs afterwards: MSI artifact exists, `dist/` entry chunk excludes pptx, docs diff matches the shipped surface. RESEARCH does not merge or edit the bump.

```powershell
git switch epic/goals
git fetch origin
git merge origin/main
pnpm install
```

Shared-doc pass (integrator only):

- `AGENTS.md` — any policy change from #140 (native shell surface) and #143 (later, if it lands before this merge).
- `docs/FEATURES.md` — Goals surface, cadence rules and the period grid, staging schema v9, deck export, goal-set file.
- `docs/goals/contract.md` — mark as shipped, note any signature drift.

Version bump, once, across the three files `sync-version.mjs` rewrites:

```powershell
pnpm run version minor
```

The script bumps `package.json`, rewrites `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, then runs `pnpm tauri build`. Verify:

```powershell
pnpm test:version
Get-ChildItem src-tauri\target\release\bundle\msi
```

Final gate:

```powershell
pnpm build
pnpm test:unit
pnpm test:pwa
pnpm test:platform
pnpm supabase:start
pnpm supabase:serve   # separate terminal
pnpm test:integration
pnpm test:e2e
```

Merge:

```powershell
git switch main
git merge --no-ff epic/goals
git push origin main
git push origin epic/goals
```

Notes:

- No lane bumps a version. Three files move together, once.
- `pnpm run version` needs all three Vite vars and Rust available; it stops after the bump if the Tauri build fails, leaving the version changes in place for inspection.
- Keep `epic/goals` after the merge until `main` has run in production once; then delete it.

---

## Phase 14 — Follow-ups (#143, then #142)

**Agent: IMPL+ (GPT-6.1 Sol, high)** for both. #143 is an external-API/CORS + new storage-exception decision; #142 changes deck output quality. **ORCH** reviews, updates shared docs, and merges. Neither starts until v1 is in real use.

Only start these after the v1 epic is in real use.

```powershell
git switch main
git switch -c issue/143-liftingtracker
```

- Re-read `docs/research/issue-143.md` first; confirm the CORS conclusion still holds.
- Update `AGENTS.md` with the `worktime:liftingtracker:*` browser-local key exception **in the same change** as the key module.
- Registry entry + `IntegrationsPage` branch + `AuthenticatedIntegrationsRoute` wiring; `pnpm test:unit src/lib/integrations`.

`#142` follows the same shape: new workflow module, new output schema, preview integration, graceful no-key path. It must never make the deterministic deck worse.

Before writing any `#143` code, read `docs/plans/issue-133-decisions.md` (forward hazards). `metric.current` is written by the integration, not the goal editor, so under whole-row LWW a concurrent goal edit and an integration refresh will clobber each other the same way `lastBuiltPeriodStart` would have. Apply the same guarded treatment, or record explicitly why not.

---

## 2. Lane work loop (repeat per issue)

**Agent: IMPL (Flash high)** unless the phase header says IMPL+. If you hit an escalation trigger, stop and report to ORCH. Do not switch models mid-branch, do not spawn your own subagents, and do not pull in a second agent to "help".

For every issue a lane picks up:

```powershell
git fetch origin
git rebase origin/epic/goals
```

Implement → gate → commit → report.

```powershell
pnpm lint:app
pnpm test:unit src/lib/goals          # narrow first, fast feedback
pnpm test:unit                        # full unit suite
pnpm build
git add -A
git commit -m "<type>(<scope>): <summary> (#<issue>)"
```

Report format back to the integrator: branch name, commit SHA, files touched, tests added, anything that contradicted `docs/goals/contract.md`.

Hard rules:

1. Never rebase a branch that has already been merged into `epic/goals`.
2. Never edit another lane's files. If the contract is wrong, report it — do not silently fork a module.
3. Never create a file that the contract assigns to someone else (`periods.ts`, `slips.ts`, fixtures).
4. Never touch migrations, shared docs, `package.json`, the lockfile, or `src-tauri/**`.
5. Never run Supabase, `pnpm dev` on port 3000, E2E, or Tauri builds.
6. Never run `git push --force` on `epic/goals` or `main`.
7. Never add a hard-delete affordance for trackers, goals, or check-ins. v1 is archive/lifecycle only, and a delete would re-open the tombstone-cascade work #133 deliberately left out.
8. Never pass a filtered or partial list to `saveGoals`. It takes the full desired set; omitting a row is how the writer tombstones it.

---

## 3. Integration procedure (main worktree)

**Agent: ORCH only.** Never delegate a merge, a gate run, or a fix-forward to a lane agent; that is how ownership and branch state drift.

For each lane handoff:

```powershell
git switch epic/goals
git fetch origin
git merge --no-ff issue/<n>-<slug>
pnpm lint:app
pnpm test:unit
pnpm build
```

Then, once per phase (not once per merge):

```powershell
pnpm supabase:start
pnpm supabase:serve      # separate terminal
pnpm test:all
```

On failure:

- Fix forward on `epic/goals`. Never send a fix back into a lane — the lane drifts and you re-live the conflict.
- If the merge is broken beyond quick repair: `git merge --abort`, or revert the merge commit (`git revert -m 1 <sha>`) and re-land later. Do not force-push.

---

## 4. Conflict playbook

**Agent: ORCH only.** Conflicts are architecture decisions in disguise. If one needs runtime diagnosis (WebView2, pptx, sync), ORCH may ask IMPL+ for a read-only opinion, but ORCH writes the resolution.

Enable rerere once — it replays resolutions for recurring conflicts:

```powershell
git config rerere.enabled true
```

When a rebase or merge conflicts:

```powershell
git status
git diff --name-only --diff-filter=U
```

Decide by category:

| Conflict                                              | Meaning                                | Action                                                                                                       |
| ----------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/components/GoalsPage.tsx` in a **lane B** branch | Ownership violated                     | Stop. Move the change into a component/prop and let lane A mount it                                          |
| Same hunk in `GoalsPage.tsx`, two lane A branches     | Sequential lane A work                 | Resolve manually, keep both mount points, keep the contract's prop names                                     |
| `pnpm-lock.yaml`                                      | Dependency drift                       | Take `epic/goals`'s lockfile, then `pnpm install`, then verify `git diff --stat` shows only intended changes |
| `package.json` / `Cargo.toml` / `tauri.conf.json`     | Someone bumped a version               | Revert the lane's version change; versioning is integrator-only at Phase 13                                  |
| `supabase/migrations/*`                               | Someone outside #133 added a migration | Stop. Reassign it to the integrator; migrations are single-owner                                             |
| `docs/goals/contract.md`                              | Signature drift                        | ORCH resolves; then notify both lanes                                                                        |

After resolving:

```powershell
pnpm lint:app
pnpm test:unit
pnpm build
git rebase --continue          # or: git commit
```

Notes:

- Re-run the tests for the files you actually touched before continuing the rebase; a clean merge is not a correct merge.
- After a lockfile resolution, always `pnpm install` before running tests.
- Never resolve a semantic conflict by deleting the other side's test. If two tests disagree, the contract is wrong — fix the contract first.

---

## 5. Worktree lifecycle

```powershell
git worktree list
git worktree remove ..\WorkTime-engine
git worktree prune
```

Notes:

- Remove a lane worktree only after its branch is merged and you no longer need the branch for rebases.
- `git worktree remove` refuses when the worktree is dirty; add `--force` only after confirming nothing uncommitted matters.
- Each worktree has its own `node_modules`, `dist`, and `src-tauri/target`. Disk usage grows quickly — delete stale worktrees rather than hoarding them.
- Worktrees share one `.git`, so a bad force-push in one affects all. There is no such thing as an isolated branch here.

---

## 6. Gate reference

| Command                 | Needs                                                        | Never run in a lane |
| ----------------------- | ------------------------------------------------------------ | ------------------- |
| `pnpm lint:app`         | nothing (`tsc --noEmit`)                                     | —                   |
| `pnpm test:unit`        | nothing (jsdom)                                              | —                   |
| `pnpm build`            | `.env.*` with all three Vite vars                            | —                   |
| `pnpm test:pwa`         | build + public env                                           | yes                 |
| `pnpm test:platform`    | Rust toolchain; runs `cargo check`                           | yes                 |
| `pnpm test:integration` | Docker + local Supabase; **resets the DB**                   | **yes**             |
| `pnpm test:e2e`         | local Supabase + `pnpm supabase:serve` + Chromium; port 3000 | **yes**             |
| `pnpm test:all`         | all of the above, `dist/` must exist                         | **yes**             |
| `pnpm branch:check`     | `lint` + `build` + `test:all`                                | **yes**             |
| `pnpm tauri build`      | all three Vite vars + Rust; writes `src-tauri/target`        | **yes**             |
| `pnpm run version`      | as above; bumps three files                                  | **yes**             |

Gate tiers:

- **Lane:** `lint:app` → `test:unit` (narrow, then full) → `build`. Run by IMPL/IMPL+ in the lane.
- **Epic merge:** `lint:app` → `test:unit` → `build`. Run by ORCH in the main worktree.
- **Epic phase:** `test:all` (+ `test:platform` when `src-tauri` or `AGENTS.md` changed). Run by ORCH.
- **Final:** everything + `test:pwa` + `pnpm run version` + MSI artifact. Run by ORCH.

Runner rule: only ORCH runs the epic-merge, epic-phase, and final tiers. RESEARCH may pre-run a tier as a check, but ORCH re-runs it before treating the gate as passed.

---

## 7. Failure rules (short version)

1. Fix forward on `epic/goals`; never retro-fix a merged lane.
2. Never force-push `main` or `epic/goals`.
3. A red gate blocks the next phase, not the next lane.
4. If two branches both invented the same helper, delete one — do not "merge" them.
5. If a lane needs a shared-doc change, it writes a note; the integrator makes the edit.
6. If a lane needs a migration, stop and re-scope: v1 needs none outside #133.
7. If the Tauri download fallback lands, it is a reviewed policy decision, not a quiet workaround.
8. Only ORCH merges, edits shared docs, resolves conflicts, or bumps versions. Lane agents that need those changes ask; they do not do it.
9. Escalate to IMPL+ on a trigger instead of retrying. Two identical gate failures is a stop signal, not a prompt to keep editing.
10. Never run two agents on one worktree or one branch. Kill the old session before opening a new one — a shelled-out `opencode run` is an agent too.

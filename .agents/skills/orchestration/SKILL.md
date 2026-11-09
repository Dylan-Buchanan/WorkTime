---
name: orchestration
description: Run a multi-issue feature epic as a read-only orchestrator (ORCH) that delegates every code and doc change to IMPL/IMPL+/RESEARCH children in separate worktrees, supervises each child under a watchdog, verifies and merges their branches, gates each phase, and pauses for human verification only where it is genuinely required.
---

# Orchestration

Use this skill when a request spans many issues or features and you want one
integrator agent to coordinate specialists instead of editing the codebase
yourself. The process is repo-agnostic; the scripts target Windows PowerShell
5.1. Repo-specific commands live in the profile at the end.

## 1. The contract

**You are ORCH.** You coordinate, verify, merge, push, and run acceptance gates.
You do **not** author repository content: no code edits, no docs edits, no
config edits, no scratch files inside the repo, no hand-written commits.

**Children own content.** Every change, including contract corrections,
conflict resolution, shared docs, and version bumps, is delegated to an
authorized child. Children never push (the supervisor blocks it).

**ORCH's only write exceptions:**

| Allowed git write                                                 | Purpose                                             |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| `switch`, `fetch`, `branch`, `worktree add/remove/prune`          | organize lanes via `New-Lane.ps1`/`Remove-Lane.ps1` |
| `Commit-Lane.ps1`                                                 | commit a sandboxed child's verified work (§3)       |
| `merge --no-ff`, `merge --abort`                                  | integrate verified branches                         |
| push **only through** `Invoke-Gate.ps1 -PushRef`                  | publish `epic/*` and `main` after a green gate      |
| `revert -m 1`                                                     | undo a bad merge                                    |
| `rerere` config, lockfile/version-only `checkout --ours/--theirs` | resolve mechanical conflicts                        |
| `add -A && commit --no-edit`                                      | only to conclude an agent-resolved merge            |

Non-git writes you may do: run builds/tests, start/stop local services, create
run directories **outside** the repo, inspect artifacts. Never use file-edit
tools or shell redirection to change repository content.

**Truth source order:** git state > frozen contract/decision docs > issue text >
chat history > a child's report > a child's exit code (worthless; see §2).
Re-derive state at the start of every session.

**Product decisions belong to the user.** ORCH may clarify scope, surface
tradeoffs, and recommend an option, but must not choose new user-visible
behavior, requirements, or priority on the user's behalf. Carry forward
decisions already recorded in authoritative docs or explicitly made in chat.
When a material feature decision is still open, pause dependent implementation
and ask the user a focused question with the options and consequences. Keep
progressing on independent, already-decided work.

## 2. Roles and tool facts

| Code     | Role                                         | Launch (always through `Invoke-Child.ps1`, §3)                               |
| -------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| IMPL     | routine implementation (T1/T2 Recommended)   | `-Agent opencode` (default model `opencode-go/deepseek-v4.1-flash#high`)     |
| IMPL+    | complex/native/high-risk (T3/T4 Recommended) | `-Agent codex` (default `gpt-6.1-sol`, `-CodexEffort high`, workspace-write) |
| RESEARCH | independent review/research                  | `-Agent opencode -OpencodeAgent codebase-research`                           |

Rules:

- **One agent per worktree at a time.** The supervisor refuses a second child
  on a busy worktree.
- **Fresh child per issue.** Do not reuse a child that already committed.
- **Escalate to IMPL+** on: two identical gate failures, a needed contract or
  signature change, data/migration correctness, cross-cutting state/data files,
  or platform/native diagnosis.

**Tool facts (epic #159 retrospective plus tests on 2026-11-09 with codex-cli
0.167.0 and the opencode 2.2.26 CLI):**

- **Codex `workspace-write` can never write `.git`**, whether it's a worktree or a
  full clone, even with `--add-dir`. Codex lanes therefore do not run
  `git add`/`commit`. They leave changes uncommitted and print a COMMIT MESSAGE
  block, and ORCH commits with `Commit-Lane.ps1`. Never "fix" this by switching
  to `danger-full-access`.
- **Codex exits 0 even when its commands fail.** No child's exit code means
  anything; the supervisor's outcome plus git state does.
- **Codex `read-only` cannot run vitest** (temp-file permission errors). A
  reviewer that must run tests uses `workspace-write` in its own detached lane.
- **`opencode run` without `--standalone` hands the run to the desktop app's
  shared background service** (a different version). In every startup hang in
  epic #159, the service's log shows it never opened the lane's directory
  until the client was killed. The fault inside the service is unconfirmed.
  The supervisor always passes `--standalone` (a private server per run, which
  started and exited cleanly in 5-15 s in tests). The watchdog stays in place
  in case hangs have another cause.
- **Briefs go in on stdin from a file**, not as an argument. That avoids
  Windows quoting and command-line length limits and gives the child a closed
  stdin.
- **PowerShell blocks `pnpm.ps1`.** Children must call `pnpm.cmd` (or run
  through `cmd.exe`). The scripts already run steps through `cmd.exe`.
- **PowerShell 5.1 pitfalls:** `;` runs the next command even when the previous
  one failed (there is no `&&`). `-match`/`-notmatch` ignore case, so a filter
  on `OpenCode.exe` also hides the `opencode.exe` CLI; use `-cmatch` or,
  better, PIDs from `status.json`. Inner double quotes in native-exe arguments
  get stripped; use TOML single quotes for `codex -c` values.
- The desktop app's `opencode-cli.exe serve --service` is not a child. Never
  kill it.

## 3. The toolkit

All scripts live in `.claude/skills/orchestration/scripts/`. Run them as
`powershell -NoProfile -ExecutionPolicy Bypass -File <script> ...`. Run
directories go to `%TEMP%\orch-runs` (outside the repo). Each script's header
documents its parameters.

| Script             | Use it to                                                                                                                            | Replaces the failure                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `New-Lane.ps1`     | create worktree + branch (or `-Detach` for reviewers), copy gitignored `.env*` files, `pnpm install --frozen-lockfile`, verify clean | copying `node_modules`; missing `supabase/.env.local`                      |
| `Invoke-Child.ps1` | run one child: brief on stdin, log to file, watchdog, tree kill, push blocked, report extracted                                      | silent hangs, `tail` hiding output, bogus exit 0, buried reports           |
| `Commit-Lane.ps1`  | commit a Codex lane after checking branch, base, and that changed files equal the allowed list                                       | the extra commit-only child round trip                                     |
| `Invoke-Gate.ps1`  | run gate steps (`;;`-separated), stop at first red, record counts and failing test names, flag side effects, push only when green    | pushing after a red gate; unrecorded flakes; hidden build side effects     |
| `Remove-Lane.ps1`  | delete a lane (`-MergedInto <ref>` or `-Discard`), prune, optionally `-DeleteBranch`; refuses while a child holds it                 | `git worktree remove` failing on pnpm `node_modules` ("Filename too long") |

**Launching a child.** Run `Invoke-Child.ps1` with the harness's background mode
(`run_in_background`) in the same step as the dispatch, so the watchdog is
armed from the first second and the harness wakes you when it ends. Do not
poll. Never pipe it through `tail`/`Select-Object`. Its run directory holds
`brief.md`, `output.log`, `status.json` (heartbeat every 15 s, then final),
`report.md`, and `commit-message.txt` when the report has one. Read
`status.json` if you need a progress check.

**Watchdog outcomes and what to do:**

| Outcome               | Meaning                                                 | ORCH action                                                                                    |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `finished`            | exited and printed a report                             | verify (§7)                                                                                    |
| `killed-after-report` | reported, then failed to exit within 3 min; tree killed | treat as finished; verify (§7)                                                                 |
| `exited-no-report`    | exited without the report block                         | read `report.md` (log tail), verify git; rerun the gate yourself if the work looks complete    |
| `startup-stall`       | no activity within 4 min                                | relaunch once (the lane is untouched); on a second stall switch agent family and tell the user |
| `stalled`             | no log growth, file change, or HEAD move for 15 min     | inspect log + git; `Remove-Lane.ps1 -Discard -DeleteBranch`, then a fresh lane and child       |
| `timeout`             | 60 min wall clock                                       | same as `stalled`; split the issue if it is simply too big                                     |

Tune with `-TimeoutMin`, `-StartupStallMin`, `-StallMin`, `-ExitGraceMin`. The
supervisor also kills orphaned descendants (vitest workers, private servers) and
lists any it could not kill.

## 4. Shape the work before dispatching

1. **Read the authoritative docs** (workflow plan, binding decisions, frozen
   contract, the issues). If they disagree with the code, git wins.
2. **Split into lanes by file ownership.** Two lanes may run in parallel only if
   their file sets are disjoint.
3. **Freeze agreed interfaces first** in a contract file: types, signatures,
   formats, semantics. Record only decisions the user or the authoritative docs
   already made; ask the user about anything new and hold dependent lanes.
4. **Declare the gates per tier** with exact commands (§9) and put them in every
   brief.
5. **Find the human pauses** (§10).

**Pre-dispatch checklist.** Every item here caused rework in a previous epic:

- [ ] **Who else reads these files?** For every file on a lane's list, and every
      exported symbol whose behavior changes, `git grep` its importers and the
      tests that assert on it. Each one is either on the list or named under
      FORBIDDEN with the reason. Write the final list to `<brief>.allowed.txt`;
      verification and `Commit-Lane.ps1` use the same file.
- [ ] **Numeric rules have worked examples.** For each formula give inputs and
      expected outputs, including boundaries (0, 1, the rounding edge). A rule
      like `max(1, ...)` must show what happens at 0.
- [ ] **Totals don't double count.** For each aggregate, state which items each
      term counts, and check that no item lands in two terms.
- [ ] **Load-bearing research claims are proven.** A claim the design depends on
      ("these keys can't diverge", "X is never called with Y") needs file:line
      evidence or a test before it goes into the contract. Spot-check it
      yourself, and list it for the adversarial review to attack (§11).
- [ ] **Checks are behavioral.** Phrase every acceptance check as observable
      behavior ("the retired field is absent from runtime state", verified by a
      test), never as a text match ("grep returns nothing"). A text search may
      be listed as a hint only.
- [ ] **Scripts are read before they're delegated.** Open every package script
      a brief tells a child to run and list its side effects (§12).
- [ ] **Concurrency fits the machine.** At most two lanes run test suites at
      once; full-suite runs use `--maxWorkers=2`.

## 5. The dispatch contract (brief template)

Every brief is self-contained; a child starts with zero context. Save it to a
file outside the repo and pass it with `-BriefFile`.

```text
You are the <ROLE> agent for <issue/topic> in <epic>.

Worktree: <absolute path>
Branch: <branch> (already created by ORCH at <sha>). Do NOT fetch, rebase,
switch branches, or push.

READ FIRST
1. <contract section(s), by name and number>
2. <issue file>
3. <the exact source files and tests to mirror>

FILE LIST (verbatim; nothing else may change)
1. <create/modify files...>
FORBIDDEN: <tempting neighbors, each with the reason, e.g. "src/x.test.ts:
asserts the old ranking; ORCH handles it in #NNN">

FROZEN (use exactly; do not add/remove/rename)
<types, props, function signatures, formats, with worked examples>

REQUIREMENTS
<numbered, behavioral, with edge cases>

TESTS YOU MUST ADD
<each case, phrased as behavior>

GATE (all, in this order; report exit codes and counts)
    <lint> -> <narrow tests> -> <full tests --maxWorkers=2> -> <build>
From PowerShell call pnpm.cmd, not pnpm.

Never run: <DB resets, dev server, e2e, integration, platform, tauri,
version scripts, installs: whatever belongs to ORCH>

RULES
- Never change an existing test's expected outcome unless this brief names
  that exact assertion. A failing old test is a STOP-and-report, not an edit.
- Never split, concatenate, rename, or encode identifiers to get past a check.
  If a check seems wrong, STOP and report.
- If the contract is ambiguous, a frozen signature must change, or a file
  outside the list is required, STOP and report instead of improvising.

COMMIT  (IMPL / opencode lanes)
    git add -A
    git commit -m "<type>(<scope>): <summary> (#<issue>)"
    git log --oneline -1
    git status --short
COMMIT  (IMPL+ / Codex lanes: replace the block above with)
    Do NOT run git add or git commit; your sandbox cannot write .git. Leave
    the changes in the worktree and include the COMMIT MESSAGE block below.

REPORT: end your final message with exactly this block, markers on their own lines:
=== CHILD REPORT ===
branch / commit SHA (or "uncommitted, Codex lane"), files touched, tests
added, gate exit codes and test counts, contract deviations, git status,
confirmation nothing was pushed
--- COMMIT MESSAGE ---          (Codex lanes only)
<type>(<scope>): <summary> (#<issue>)

<optional body>
--- END COMMIT MESSAGE ---      (Codex lanes only)
=== CHILD REPORT END ===
```

ORCH answers a STOP by authorizing a narrowly scoped adjustment when it keeps
the agreed behavior (update the brief and `.allowed.txt`, record why), or by
asking the user when it changes a feature decision.

## 6. Running lanes

```text
New-Lane.ps1 -Path <wt> -Branch issue/<n>-<slug> -Base origin/epic/<name>
write brief + .allowed.txt  (outside the repo)
Invoke-Child.ps1 ... (background)  -> wait for the harness notification
Codex lane: Commit-Lane.ps1 -Worktree <wt> -Branch <b> -Base <sha>
            -AllowedFile <brief>.allowed.txt -MessageFile <run>\commit-message.txt
            -LaneAgent "codex <model>"
verify (§7) -> merge --no-ff -> Invoke-Gate.ps1 (merge gate) -PushRef epic/<name>
```

`Commit-Lane.ps1` refuses rather than fixes anything. On "changed outside the
authorized list", either authorize the file explicitly (record why, update
`.allowed.txt`, rerun) or dispatch a fresh child to remove the change.

## 7. Verification before any merge

A green lane gate is not proof. Several bugs in previous epics passed every
child gate and were caught only here. Do all of this; never trust the report
alone.

```powershell
git status --short --branch                       # clean
git log --oneline <base>..HEAD                    # expected subject(s)
git diff --name-only <base>..HEAD                 # equals <brief>.allowed.txt
git diff <base>..HEAD                             # READ IT, not just --stat
git diff <base>..HEAD -- '*.test.*' '*.spec.*'    # see test-edit rule below
```

Read the diff with these questions:

- **Were existing assertions changed?** A removed or changed `expect(...)` on a
  pre-existing test is a red flag unless the brief named that assertion. A
  child once flipped an assertion to match its bug.
- **Restored vs new state.** For anything persisted, cached, or rehydrated,
  follow the reload path. Is restored state treated as existing, or replayed
  as a brand-new event (e.g. a running timer seen as a fresh start)?
- **Error propagation.** If a function now throws or rejects where it didn't
  (or stops doing so), `git grep` every caller and confirm each one handles it.
- **Check gaming.** Look for strings split or concatenated near anything a
  check searches for.

Reject the merge if the file set drifted, the tree is dirty, gates were
skipped, or any question above fails. A red gate blocks the next phase. It
does not block independent, already-authorized lanes in other worktrees.

## 8. Merge and integration rules

- Merge `--no-ff` with a message that records the verification outcome.
- **Only ORCH uses the integration worktree.** Reviewers and side checks (e2e
  on a lane, a reviewer reading the epic) get their own detached lane:
  `New-Lane.ps1 -Detach -Base <ref>`. Never hold a merge because someone else is
  reading the integration worktree.
- After every merge run the merge gate through `Invoke-Gate.ps1 -PushRef`.
- **Fix forward** on the integration branch; never retro-edit a merged lane.
- Resolve conflicts by type: page/UI ownership violation = split the change;
  lockfile = take the integration branch's lockfile, then install; version
  files = drop the lane's bump (the release bump happens once); migrations =
  only the foundation owner.
- After an agent resolves a conflict, review the resolved tree, then conclude
  with `git add -A && git commit --no-edit`.

## 9. Gate ladder

| Tier  | When                                 | Typical steps                                                    |
| ----- | ------------------------------------ | ---------------------------------------------------------------- |
| Lane  | in the child, before commit          | lint -> narrow unit -> full unit (`--maxWorkers=2`) -> build     |
| Merge | after each `--no-ff`                 | lint -> unit (`--maxWorkers=2`) -> build, then push              |
| Phase | once per phase, integration worktree | start services -> full suite                                     |
| Final | before releasing                     | everything + PWA/platform/integration/e2e + MSI + version checks |

Rules:

- **Push only from `Invoke-Gate.ps1 -PushRef <branch>`.** It pushes after every
  step passed and the tree has no side effects. Never write `<gate>; git push`.
- **Never pipe a gate through `tail`.** The gate script writes each step to its
  own log and prints counts and failures.
- **Record flakes by name.** On a red unit step, the gate prints the failing
  test names. Copy them into your notes, rerun once with fewer workers, and only
  then call it a regression. "Saw one flake" without a name is not a record.
- **Side effects block the push.** If a build or version script changes tracked
  content, find out why before pushing. Line-ending-only changes are reported
  as warnings.
- Run the build before any artifact/PWA verification that inspects `dist/`.
- Restart or clear a stale dev server when a lockfile/dependency changed.
- Reset the local DB only from the integration worktree; it is destructive.
- Gitignored env files and test-only secrets must be present before e2e runs
  (`New-Lane.ps1` copies `.env*`; see the profile for test variables).

## 10. Human verification protocol

Pause for user input when either a material feature decision is unresolved or a
machine cannot answer. For a feature decision, use the available questions tool
when possible, with concise suggested answers and consequences; include a
recommendation when useful without treating it as approval. Hold only dependent
work. For platform checks that require human observation, hand the human:

1. **Frozen refs**: branch, SHA, what is merged and what is not.
2. **Automated proof**: gate results and what you verified yourself.
3. **Exact artifacts**: absolute paths, sizes, timestamps.
4. **A numbered yes/no checklist**: one question per observable platform
   behavior.
5. **What happens next**: merge, release, or fallback work.
6. **Explicit unknowns**: never claim platform behavior you did not observe.

For platform checks, ask for the observed outcome, not for permission to
continue. Example:

> Install `<msi path>` (3,932,160 B). 1) Does Export save a `.pptx` to
> Downloads? 2) Does PowerPoint open it with editable text? If (1) fails, I
> implement the agreed fallback instead of merging.

## 11. Independent review

For any T3/T4 epic, run adversarial reviews **early and again before release**:

- **First review as soon as the first lanes of a phase merge**, not at the end.
  Early reviews catch contract errors while later lanes can still absorb them.
- **Final review** against the full merged range before the release phase.
- Each reviewer gets its own detached lane at the reviewed SHA. A Codex reviewer
  uses `workspace-write` there so it can run tests, and is told not to modify
  files. If `status.json` shows dirty paths afterwards, discard the lane and
  note that the review touched files.
- Review the merged range, not the diff the author described. Give the reviewer
  the list of load-bearing research claims and contract rules to attack first.
- Require a verdict (`PASS` / `PASS WITH FINDINGS` / `FAIL`) plus a severity
  list with `file:line` and a minimal fix per item. For any changed error path,
  require the reviewer to trace every caller.
- Triage: blocker + should-fix go into **one** fix-forward branch with tests;
  nice-to-have can be deferred explicitly. Re-run the phase gate after fixes.
- If a fix intentionally changes tested behavior, authorize that exact assertion
  change narrowly instead of letting the child edit unrelated tests.

## 12. Release phase

1. Confirm the integration branch contains the current default branch.
2. **Read the release scripts first.** Know what the version script runs (in
   this repo it also runs a full Tauri build) and which files it touches.
   Delegate it with that knowledge in the brief.
3. Delegate the shared-doc pass (README/FEATURES/AGENTS/contract status).
4. Delegate **one** version bump (run the repo's version script once).
5. Build the release artifact; inspect it (name carries the version, size,
   timestamp). Check `git status` afterwards for build side effects.
6. Verify entry-chunk/bundle invariants if a heavy dependency was added.
7. Run the final gate ladder from a clean tree.
8. Merge to the default branch `--no-ff`, then push both refs through
   `Invoke-Gate.ps1 -PushRef`. Keep the epic branch until production has run
   once.
9. **Clean up.** `Remove-Lane.ps1 -MergedInto <default branch> -DeleteBranch`
   for every lane, including reviewer lanes, then delete the epic's run
   directories under `%TEMP%\orch-runs`. Don't use plain `git worktree remove`:
   it fails on pnpm `node_modules` and can leave an unregistered folder behind.
   Delete such a folder with `Remove-Item -LiteralPath "\\?\<path>" -Recurse -Force`
   only after confirming `git worktree list` no longer shows it.

## 13. Reporting to the user

Match the user's altitude, not the transcript's. Default shape:

- **State**: refs and version, one line.
- **What changed**: grouped by phase/issue with SHAs.
- **Evidence**: gate counts, artifact paths, invariants verified.
- **Deviations**: anything you did differently and why, including any child
  that hung or had to be relaunched.
- **Next**: the one decision or action you need, or the next phase.

Never bury a blocker, never present an unverified platform claim as verified,
and never dump raw child logs.

## Appendix: WorkTime profile

- **Env files** copied by `New-Lane.ps1`: `.env.development.local`,
  `.env.production.local`, `supabase/.env.local`.
- **Lane gate:** `pnpm lint;;pnpm exec vitest run <paths>;;pnpm exec vitest run --maxWorkers=2;;pnpm build`
- **Merge gate:** `pnpm lint;;pnpm exec vitest run --maxWorkers=2;;pnpm build`
- **Phase/final services** (Docker Desktop running): `pnpm supabase:start`,
  then `pnpm supabase:serve` in the background (needs `supabase/.env.local`).
- **Invite-signup e2e** is skipped unless `TEST_SIGNUP_INVITE_CODE` is set.
  Before `pnpm test:e2e`, set it in the gate's environment from
  `SIGNUP_INVITE_CODE` in `supabase/.env.local`, without printing the value.
- `pnpm test:integration` runs `supabase db reset`: integration worktree only.
- `pnpm run version <bump>` runs `sync-version` and then `pnpm tauri build`. It
  is slow and needs all three `VITE_*` variables. Run it once, in the release
  lane.
- Known load-sensitive suites: the goals and habits UI tests time out when
  several lanes run tests at once. Keep `--maxWorkers=2` and at most two
  concurrent suites.

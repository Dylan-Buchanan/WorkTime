---
name: orchestration
description: Run a multi-issue feature epic as a read-only orchestrator (ORCH) that delegates every code and doc change to IMPL/IMPL+/RESEARCH children in separate worktrees, verifies and merges their branches, gates each phase, and pauses for human verification only where it is genuinely required.
---

# Orchestration

Use this skill when a request spans many issues or features and you want one
integrator agent to coordinate specialists instead of editing the codebase
yourself. It works for any repo; the appendix records the WorkTime specifics
that were actually used.

## 1. The contract

**You are ORCH.** You coordinate, verify, merge, push, and run acceptance gates.
You do **not** author repository content: no code edits, no docs edits, no
config edits, no scratch files inside the repo, no ordinary `add`/`commit`.

**Children own content.** Every change — including contract corrections,
conflict resolution, shared docs, and version bumps — is delegated to an
authorized child. Children commit their own branches; they never push.

**ORCH's only write exceptions:**

| Allowed git write                                                 | Purpose                                  |
| ----------------------------------------------------------------- | ---------------------------------------- |
| `switch`, `fetch`, `branch`, `worktree add/remove/prune`          | organize lanes                           |
| `merge --no-ff`, `merge --abort`                                  | integrate verified branches              |
| `push`                                                            | publish `epic/*` and `main`              |
| `revert -m 1`                                                     | undo a bad merge                         |
| `rerere` config, lockfile/version-only `checkout --ours/--theirs` | resolve mechanical conflicts             |
| `add -A && commit --no-edit`                                      | only to conclude an agent-resolved merge |

Non-git writes you may do: run builds/tests, start/stop local services, create
branches/worktrees, inspect artifacts. Never use file-edit tools or shell
redirection to change repository content.

**Truth source order:** git state > frozen contract/decision docs > issue text >
chat history. Re-derive state at the start of every session; never trust a
summary table over `git status`/`git log`.

## 2. Roles and how to launch them

| Code     | Role                        | How to launch                                                                                                                                   |
| -------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| ORCH     | integrator                  | this session                                                                                                                                    |
| IMPL     | routine implementation      | `opencode run --auto --model "opencode-go/deepseek-v4.1-flash#high" --title "impl: <topic>" $brief`                                             |
| IMPL+    | complex/native/high-risk    | `$brief \| codex exec --sandbox workspace-write -c approval_policy="never" -m gpt-6.1-sol -c 'model_reasoning_effort="high"' -C "<worktree>" -` |
| RESEARCH | independent review/research | `opencode run --agent codebase-research --auto --model "opencode-go/deepseek-v4.1-flash#high" --title "research: <topic>" $brief`               |

Rules that matter:

- **One agent per worktree at a time.** A shelled-out `opencode run` or `codex`
  counts as an agent.
- **Dispatch blocking.** Wait for the child's exit code and report; do not start
  a second child in the same worktree.
- **Fresh child per issue.** Do not reuse a child that already committed.
- **Children commit, ORCH merges.** Never let a child push.
- **Escalate to IMPL+** on: two identical gate failures, a needed contract or
  signature change, data/migration correctness, cross-cutting state/data files,
  or platform/native diagnosis.

**Sandbox reality check (learned the hard way):** a Codex `workspace-write`
sandbox may be unable to create `.git/index.lock` or reach the Windows Installer
service. If a child reports either:

- commit through a tiny IMPL child that only runs `git add`/`git commit`;
- run the MSI/installer gate yourself from the ORCH shell (a gate, not content);
- never "fix" it by weakening a sandbox or gate.

## 3. Shape the work before dispatching

1. **Read the authoritative docs** (workflow plan, binding decisions, frozen
   contract, the issues). If they disagree with the code, git wins.
2. **Split into lanes by file ownership**, not by feature convenience. Two lanes
   may run in parallel only if their file sets are disjoint.
3. **Freeze the interfaces first.** Types, signatures, formats, and semantics go
   into a contract file before lanes start. Lanes implement against it; they do
   not renegotiate it.
4. **Declare the gates per tier** (lane / merge / phase / final) and the exact
   commands. Write them into every brief.
5. **Find the human pauses.** Only pause where a machine genuinely cannot
   verify: real OS/webview behavior, visual fidelity, destructive operations, or
   an irreversible external effect.

## 4. The dispatch contract (brief template)

Every brief is self-contained. A child starts with zero context, so include:

```text
You are the <ROLE> agent for <issue/topic> in <epic>.

Worktree: <absolute path>
Branch: <branch> (already created by ORCH at <sha>). Do NOT fetch, rebase, or
switch branches.

READ FIRST
1. <contract section(s), by name and number>
2. <issue file>
3. <the exact source files and tests to mirror>

FILE LIST (verbatim; nothing else may change)
1. <create/modify files...>
FORBIDDEN: <everything else that is tempting>

FROZEN (use exactly; do not add/remove/rename)
<types, props, function signatures, formats>

REQUIREMENTS
<numbered, behavioral, with edge cases>

TESTS YOU MUST ADD
<each case, phrased as behavior>

GATE (all, in this order; paste tails)
    <lint> -> <narrow tests> -> <full tests> -> <build>

Never run: <DB resets, dev server, e2e, integration, platform, e2e, tauri,
version scripts, installs - whatever belongs to ORCH>

Commit:
    git add -A
    git commit -m "<type>(<scope>): <summary> (#<issue>)"
    git log --oneline -1
    git status --short

If the contract is ambiguous, a frozen signature must change, or a file outside
the list is required, STOP and report instead of improvising. Do not weaken or
delete existing tests.

Report: branch, commit SHA, files touched, tests added, gate exit codes/counts,
contract deviations, clean status, and confirmation nothing was pushed.
```

Why this shape works: it removes every excuse to improvise, gives the child a
single verifiable definition of done, and makes the report auditable.

## 5. Per-issue loop

```
ORCH: create branch from origin/epic
  -> dispatch IMPL (or IMPL+) -> child implements, gates, commits
  -> ORCH: verify scope + clean tree + commit message
  -> ORCH: merge --no-ff into epic
  -> ORCH: rerun merge gate (lint, unit, build)
  -> ORCH: push epic
```

Verification before any merge — do all of these, do not trust the report alone:

```powershell
git status --short --branch          # must be clean
git log --oneline -2                 # expected subject
git diff --name-only <base>..HEAD    # must equal the authorized list
git show --stat --oneline HEAD
```

Reject the merge if the file set drifted, the tree is dirty, or gates were
skipped. A red gate blocks the next phase; it does not block independent,
already-authorized lane work in another worktree.

## 6. Merge and integration rules

- Merge `--no-ff` with a message that records the verification outcome.
- After every merge rerun the merge gate. After a phase, run the phase gate.
- **Fix forward** on the integration branch; never retro-edit a merged lane.
- Resolve conflicts per type instead of guessing: page/UI ownership violation =
  split the change; lockfile = take the integration branch's lockfile then
  install; version files = drop the lane's bump (the release bump happens once);
  migrations = only the foundation owner.
- After an agent resolves a conflict, review the resolved tree, then conclude
  with `git add -A && git commit --no-edit`.

## 7. Gate ladder

| Tier  | When                                 | Typical commands                                                 |
| ----- | ------------------------------------ | ---------------------------------------------------------------- |
| Lane  | in the child, before commit          | lint -> narrow unit -> full unit -> build                        |
| Merge | after each `--no-ff`                 | lint -> unit -> build                                            |
| Phase | once per phase, integration worktree | start services -> full suite (`test:all`)                        |
| Final | before releasing                     | everything + PWA/platform/integration/e2e + MSI + version checks |

Rules that prevent false reds:

- Run the build before any artifact/PWA verification that inspects `dist/`.
- Restart or clear a stale dev server when a lockfile/dependency changed.
- Reset the local DB only from the integration worktree; it is destructive.
- Re-run a flaky failure once with fewer workers before calling it a regression.
- Record exit codes and test counts, not just "passed".

## 8. Human verification protocol

Pause only where the machine cannot answer. At a pause, hand the human:

1. **Frozen refs** — branch, SHA, what is merged and what is not.
2. **Automated proof** — gate results and what you verified yourself.
3. **Exact artifacts** — absolute paths, sizes, timestamps.
4. **A numbered yes/no checklist** — one question per observable behavior.
5. **What happens next** — merge, release, or fallback work.
6. **Explicit unknowns** — never claim platform behavior you did not observe.

Ask for the outcome, not for permission to continue. Example:

> Install `<msi path>` (3,932,160 B). 1) Does Export save a `.pptx` to Downloads? 2) Does PowerPoint open it with editable text? If (1) fails, I implement the
> agreed fallback instead of merging.

## 9. Independent review before release

Add one adversarial review pass for any T3/T4 epic:

- Dispatch RESEARCH against the merged range, not the diff the author described.
- Require a verdict (`PASS` / `PASS WITH FINDINGS` / `FAIL`) plus a severity
  list with `file:line` and a minimal fix per item.
- Triage: blocker + should-fix go into **one** fix-forward branch with tests;
  nice-to-have can be deferred explicitly.
- Re-run the full phase gate after the fixes.
- If a fix intentionally changes tested behavior, authorize that exact assertion
  change narrowly instead of letting the child edit unrelated tests.

## 10. Release phase

1. Confirm the integration branch contains the current default branch.
2. Delegate the shared-doc pass (README/FEATURES/AGENTS/contract status).
3. Delegate **one** version bump (run the repo's version script once).
4. Build the release artifact; inspect it (name carries the version, size,
   timestamp).
5. Verify entry-chunk/bundle invariants if a heavy dependency was added.
6. Run the final gate ladder from a clean tree.
7. Merge to the default branch `--no-ff`, push both refs, keep the epic branch
   until production has run once.

## 11. Recovery playbook

| Symptom                                                           | Cause                                        | Action                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `504 Outdated Optimize Dep` on one route                          | stale Vite dep cache after a lockfile change | stop the dev server, clear `node_modules/.vite`, rerun                   |
| `ERR_PNPM_UNEXPECTED_STORE`                                       | worktree linked to a project-local store     | reinstall with `--store-dir .pnpm-store` and `CI=1`                      |
| `EACCES`/`ENOENT` on `.git/index.lock`                            | child sandbox cannot write `.git`            | commit via an IMPL child; do not change sandbox policy                   |
| WiX `light.exe` "Windows Installer Service could not be accessed" | sandbox cannot reach `msiserver`             | run `pnpm tauri build` from ORCH's shell                                 |
| Child stops asking to change a forbidden file                     | brief was too narrow                         | authorize the minimal change explicitly, in writing, and rerun the gates |
| Two identical gate failures                                       | implementation, not environment              | escalate that issue to IMPL+                                             |
| Flaky E2E in one area only                                        | worker contention or cold dev server         | rerun that spec with fewer workers before blaming code                   |

## 12. Reporting to the user

Match the user's altitude, not the transcript's. Default shape:

- **State** — refs and version, one line.
- **What changed** — grouped by phase/issue with SHAs.
- **Evidence** — gate counts, artifact paths, invariants verified.
- **Deviations** — anything you did differently and why.
- **Next** — the one decision or action you need, or the next phase.

Never bury a blocker, never present an unverified platform claim as verified,
and never dump raw child logs.

## 13. WorkTime appendix

Worktrees (one agent each):

| Path                                            | Role                                               |
| ----------------------------------------------- | -------------------------------------------------- |
| `C:\Users\dylan\Desktop\Coding\VSCode\WorkTime` | ORCH + integration + native/release                |
| `...\WorkTime-ui`                               | Lane A: page, wizard, providers, mounts            |
| `...\WorkTime-engine`                           | Lane B: pure `src/lib/goals/**`, deck plan/preview |

Core docs: `docs/plans/goals-epic-parallel-workflow.md`,
`docs/plans/issue-133-decisions.md`, `docs/goals/contract.md`,
`docs/research/issue-140-research.md`, `docs/issues/issue-*.md`.

Commands:

```powershell
pnpm lint:app                      # tsc --noEmit
pnpm test:unit [paths]             # vitest
pnpm build                         # tsc && vite build
pnpm test:pwa                      # build + artifact checks
pnpm test:platform                 # slim-shell + cargo check
pnpm test:integration              # destructive db reset, main worktree only
pnpm test:e2e                      # Playwright on :3000
pnpm test:all                      # unit+pwa+platform+integration+e2e
pnpm supabase:start/status/serve   # local stack + edge functions
pnpm tauri build                   # MSI under src-tauri/target/release/bundle/msi
pnpm run version minor|major|patch # single release bump
pnpm test:version
```

Environment gotchas: production builds need `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_APP_URL`; never print secrets. E2E needs
port 3000 free and the local stack; one invite-signup spec is conditionally
skipped. `pptxgenjs` must stay a function-local dynamic import with its own
chunk.

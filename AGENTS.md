## Overview

WorkTime is a Windows Tauri desktop app with a React/Vite frontend and a Rust backend. The current live desktop path uses Tauri commands and local JSON persistence. Supabase and the shared TypeScript engine are foundation work for future multi-user clients and are not wired into the desktop contexts yet.

## Project Basics

- `src/` contains the React frontend, contexts, shared state types, display helpers, and frontend tests.
- `src-tauri/` contains the Rust Tauri commands, timer/task domain implementation, and Rust tests.
- `e2e/` contains Playwright tests and the mock Tauri IPC bridge used by browser tests.
- `src/lib/engine/` contains the pure TypeScript port of the 16 timer/task commands. Commands clone input state, take explicit `Date` and task-ID inputs, perform no I/O, and return `{ state, value }`.
- `src/lib/supabase.ts` is an environment-only browser client foundation. Do not import it into the live app until a later client-rewire task.
- `supabase/` contains the local CLI config, versioned migration, owner-scoped RLS policies, invite-signup Edge Function, and local verification notes.
- Local desktop data is persisted by Rust under `dev-data/` during development; do not migrate or replace that path as part of Phase 0 foundation work.

### Supabase workflow

Docker Desktop must be running for the local Supabase stack. The package scripts are:

- `npm run supabase:start` - start the local Supabase services.
- `npm run supabase:stop` - stop the local Supabase services.
- `npm run supabase:reset` - destructively reset the local database and reapply migrations.

Use `npx supabase status` to inspect local URLs and keys without committing them. Never run a database reset against a hosted project. Keep real `.env` files, `supabase/.env.local`, service-role keys, and invite codes out of Git. Browser configuration may use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; service-role credentials and `SIGNUP_INVITE_CODE` are server-only.

## Updating

When adding new code use the following process to ensure the code works:

1. Run `npm install` to make sure dependencies are up to date.
2. Run `npm run build`.

Do not change `src-tauri/src/lib.rs`, `src/state/AppStateContext.tsx`, `src/state/ProjectManagerContext.tsx`, `e2e/mock-ipc.js`, or the existing display helpers merely to add Phase 0 foundation code. If timer semantics change intentionally, update every corresponding pure implementation and test boundary.

## Testing

Before considering a change complete, run the test suites that cover it:

- `npm run test:unit` — frontend unit + context integration tests (Vitest, jsdom, Testing Library).
- `npm run test:unit -- src/lib/engine/engine.test.ts` — focused deterministic TypeScript engine parity suite.
- `npm run test:rust` — Rust backend engine tests (`cargo test` in `src-tauri`). The domain logic in `src-tauri/src/lib.rs` is extracted into pure functions so the timer engine is fully covered; keep these in sync if you change timer/task behavior.
- `npm run test:e2e` — Playwright tests driving the real React app in a browser against a mock Tauri IPC bridge (`e2e/mock-ipc.js`). Run `npx playwright install chromium` once after setup.
- `npm run test:all` — runs all three suites.

### Notes

- The Tauri IPC bridge is mocked for e2e and context integration tests. `window.__TAURI_INTERNALS__.invoke` is implemented by `e2e/mock-ipc.js` (e2e) and `vi.mock("@tauri-apps/api/core")` (unit/integration).
- Pure logic that must stay testable lives in `src/lib/` (`timer.ts`, `analytics.ts`) and in exported helpers (`quickAddParse`, `normalizeState`).
- The shared engine also lives in `src/lib/engine/`; it must not import Supabase, Tauri, filesystem, network, wall-clock, or random-ID APIs. Preserve exact Rust error strings and timer accrual semantics when changing it.
- Supabase schema, Auth, and RLS checks are documented manual checks in `supabase/README.md`; automated Phase 0 coverage is intentionally focused on the pure engine.
- If you change the timer engine semantics in `lib.rs`, mirror the change in the e2e mock (`e2e/mock-ipc.js`) so e2e stays faithful.

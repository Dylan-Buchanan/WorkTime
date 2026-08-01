## Overview

Tauri APP

## Updating

When adding new code use the following process to ensure the code works:

1. Run `npm install` to make sure dependencies are up to date.
2. Run `npm run build`.

## Testing

Before considering a change complete, run the test suites that cover it:

- `npm run test:unit` — frontend unit + context integration tests (Vitest, jsdom, Testing Library).
- `npm run test:rust` — Rust backend engine tests (`cargo test` in `src-tauri`). The domain logic in `src-tauri/src/lib.rs` is extracted into pure functions so the timer engine is fully covered; keep these in sync if you change timer/task behavior.
- `npm run test:e2e` — Playwright tests driving the real React app in a browser against a mock Tauri IPC bridge (`e2e/mock-ipc.js`). Run `npx playwright install chromium` once after setup.
- `npm run test:all` — runs all three suites.

### Notes

- The Tauri IPC bridge is mocked for e2e and context integration tests. `window.__TAURI_INTERNALS__.invoke` is implemented by `e2e/mock-ipc.js` (e2e) and `vi.mock("@tauri-apps/api/core")` (unit/integration).
- Pure logic that must stay testable lives in `src/lib/` (`timer.ts`, `analytics.ts`) and in exported helpers (`quickAddParse`, `normalizeState`).
- If you change the timer engine semantics in `lib.rs`, mirror the change in the e2e mock (`e2e/mock-ipc.js`) so e2e stays faithful.

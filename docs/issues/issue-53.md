## Title: Agentic planning assistant — LLM transport & BYOK key settings

## Tags

Complexity Classification: T2
Severity: Medium
Reason: New greenfield frontend subsystem (LLM transport, BYOK settings, schema validation with retry) with no existing agent/LLM/fetch API layer to build on. Blast Radius=3 (new agent modules, SettingsPanel changes, new localStorage key + docs; roughly 5-10 files, but additive and does not touch the engine, staging store, Supabase, or sync layers), Uncertainty=2 (transport/storage/validation specified; base-URL configuration surface, planner/writer output schemas, and webview CORS behavior for OpenAI-compatible providers unspecified), Behavior=3 (fetch API handler with retry/feedback loop, state management, Settings integration), Testing=1 (mockable via Vitest fetch stubs; mirrors the established engine test pattern), Reversibility=1 (new localStorage key clearable from Settings; simple removal). Total=10 → T2.
Needs research before implementation: Yes — the exact JSON schema fields of planner/writer outputs the validator must enforce; how the base URL is configured (Settings UI field vs compile-time constant) and whether provider presets are needed; CORS/network reachability of OpenAI-compatible providers from both the PWA browser and the Tauri webview; how the in-memory API key is consumed by the later agent features.

## Summary

Add a frontend-only LLM transport and BYOK (bring-your-own-key) settings surface for the agentic planning assistant: a thin fetch wrapper against the OpenAI chat-completions format (no SDK dependency) with a configurable base URL, API key entry/clearing in Settings backed by a new localStorage key, and strict JSON schema validation of all planner/writer outputs with retry on malformed output.

## Steps to Reproduce Context

1. User opens Settings (`src/components/SettingsPanel.tsx`) → only timer fields and "Reset All Data" exist; no agent API key section.
2. (Once later agent features exist) the agent calls the LLM → no transport, validation, or key storage exists.

## Expected Behavior

- A thin fetch wrapper against the OpenAI chat-completions format (no SDK dependency) supports a configurable base URL for OpenAI-compatible providers.
- BYOK settings UI: the key is stored in a new localStorage key (`worktime:agent:apiKey`), read into memory at startup, and clearable from Settings. Note: localStorage is per-surface, so the key must be entered once in both PWA and Tauri.
- All planner/writer outputs are validated against a strict JSON schema; malformed output triggers a retry with the validation error as feedback.

## Actual Behavior

No agent surface exists. There is no LLM transport, no `worktime:agent:apiKey` key, and no BYOK settings UI. `src-tauri` is a slim native shell (opener + notification plugins only) and `npm run test:platform` (`scripts/verify-platform-cleanup.mjs`) enforces no `#[tauri::command]`/`invoke_handler` in `src-tauri/src/lib.rs`, so the transport must be entirely frontend/fetch-based. Per AGENTS.md, browser configuration may use only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PUBLIC_APP_URL`; no Tauri `invoke` data paths.

## Requirements for completed issue

1. Thin fetch wrapper against the OpenAI chat-completions format (no SDK dependency), supporting a configurable base URL for OpenAI-compatible providers.
2. BYOK settings UI: key stored in a new localStorage key (`worktime:agent:apiKey`), read into memory at startup, clearable from Settings. Note: localStorage is per-surface, so the key must be entered once in both PWA and Tauri.
3. All planner/writer outputs validated against a strict JSON schema; malformed output triggers a retry with the validation error as feedback.

## Context

- Files:
  - `src/components/SettingsPanel.tsx` — where the BYOK key entry/clearing lives (currently timer settings + Reset All Data).
  - `src/lib/engine/` — the established pure-module + Vitest pattern (`core.ts`, `engine.test.ts`) the agent modules should mirror.
  - `scripts/verify-platform-cleanup.mjs` — enforces the slim Tauri shell (no `invoke_handler`/`#[tauri::command]`), so the transport must be fetch-based.
  - `AGENTS.md` — browser configuration may use only the three public Vite variables; no Tauri `invoke` data paths or server-side credentials.
- Code Snippets:

```
// scripts/verify-platform-cleanup.mjs — the slim shell constraint
if (/#\[tauri::command\]|invoke_handler/.test(lib)) failures.push("Tauri commands or invoke_handler remain in lib.rs");
```

## Notes

- This is dependency slice #1 of the agentic planning assistant split. Sibling issues: context builder, diff engine + guardrails, snapshot/revert, approval-loop UI, Start-of-Day workflow, End-of-Day workflow, chat mode.
- The `worktime:agent:apiKey` localStorage key is a new documented intentional persistence exception alongside `pm_state_v1` (per AGENTS.md); it must not move into the staging store or to Tauri.

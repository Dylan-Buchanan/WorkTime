# Research: Agentic planning assistant — LLM transport & BYOK key settings

## Overview

WorkTime has no existing frontend LLM client, agent state, or agent persistence layer. The authenticated React shell already owns the Settings panel, while the Tauri side is intentionally only a native shell; a browser `fetch` client is therefore the compatible integration point for both surfaces.

## Issue Context

- User/requested outcome: Add an OpenAI-compatible chat-completions transport, frontend BYOK key storage/settings, and strict planner/writer JSON validation with retry feedback.
- Current pain or bug: No agent transport, API-key surface, or output validation exists.
- Scope classification, if known: T2

## Current Behavior

- `src/components/SettingsPanel.tsx` only edits timer settings and exposes the scoped timer-data reset flow.
- `src/test/setup.ts` clears `localStorage` between tests, and component tests render `SettingsPanel` through the authenticated provider stack.
- `src-tauri/src/lib.rs` contains no application data commands; platform verification rejects Tauri invoke handlers, so agent network access must stay in the frontend.
- The sibling agent issues describe planner output as an ordered `proposedTasks` snapshot and writer output as copy/checklist/summary enrichment, but no concrete TypeScript contract exists yet.

## Relevant Files And Entry Points

- `src/components/SettingsPanel.tsx` - authenticated settings UI where the BYOK key can be entered and cleared.
- `src/components/SettingsPanel.test.tsx` - existing component-test/provider harness and reset-scope regression coverage.
- `src/test/setup.ts` - browser test storage/audio/matchMedia setup.
- `src/lib/engine/` - established pure-module and Vitest style for deterministic logic.
- `docs/issues/issue-55.md` and `docs/issues/issue-58.md` - downstream proposed-task and Start-of-Day planner expectations.
- `AGENTS.md` - frontend-only, no-Tauri-command, and persistence boundaries.

## Data Flow Or Control Flow

1. The authenticated user opens Settings and edits the agent API key.
2. The frontend trims the value, keeps it in an in-memory module store, and persists only the key under `worktime:agent:apiKey`; clearing removes that key.
3. A later agent workflow creates a frontend chat-completions client with a configurable OpenAI-compatible base URL and the in-memory key.
4. Planner or writer requests parse the returned message as JSON, validate the strict contract, and retry once with validation errors appended as feedback when malformed.

## Important Contracts And Constraints

- The transport uses `POST <base-url>/chat/completions`, bearer authentication, and the OpenAI chat-completions request/response shape without an SDK dependency. The supported saved presets are OpenAI (`https://api.openai.com/v1`) and DeepSeek (`https://api.deepseek.com`).
- Base URLs are supplied to the client at construction time or selected from the saved OpenAI/DeepSeek provider preset; the URL is not a public Vite environment variable and no server-side credential is introduced.
- The API key is intentionally frontend-only and surface-local: PWA and Tauri webview storage are separate, and the key must never enter the staging store or Tauri invoke layer.
- Planner and writer objects reject unknown properties and invalid field types; the retry feedback contains validation paths/messages rather than silently accepting or coercing malformed model output.

## Existing Tests And Validation

- `src/components/SettingsPanel.test.tsx` can verify persistence and clearing through the existing provider wrapper.
- New agent unit tests can stub `fetch` and cover URL/body/auth handling, JSON parsing, strict validation, and retry behavior without Supabase or Tauri.
- `pnpm run build` checks strict TypeScript integration; `pnpm test:unit` runs the frontend Vitest suite.

## Risks, Edge Cases, And Unknowns

- OpenAI-compatible providers differ in CORS policy and response details; the browser transport can report provider/network failures but cannot bypass a provider's CORS policy.
- A provider may reject JSON response-format hints, so the client should treat the hint as part of the normal OpenAI-compatible request and surface a clear HTTP error.
- Malformed JSON and valid JSON with extra/incorrect fields are distinct validation failures and both need retry coverage.
- Downstream workflow issues may need to extend the planner/writer contract as their proposal/diff APIs are implemented; this slice should export a stable, explicit contract rather than silently accepting arbitrary objects.

## Downstream Guidance

- Requirements should consume the exported transport, API-key store, schema, and validated-request helpers instead of reaching into `localStorage` or calling `fetch` directly.
- Planning should preserve the `proposedTasks` ordering and strict no-extra-properties rule, and should inject provider base URL/model at the workflow boundary.
- Do not add Tauri commands, server-side/API proxy credentials, staging-store records, or background synchronization for the key.

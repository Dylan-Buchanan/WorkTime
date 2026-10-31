# Title: Optional LLM polish pass for deck generation (follow-up)

## Tags

Complexity Classification: T3
Classification Reason: A new agent workflow (deck-level prompt capture, one or two validated-JSON LLM calls, focus-set suggestion, copy rewrite) reusing the existing agent transport, key, and validation plumbing. Moderate uncertainty around prompt/payload design and graceful degradation, low infrastructure risk since `createStoredAgentClient` + `requestValidatedJson` already exist.

Severity: Low
Severity Reason: Optional enhancement layered on a complete deterministic deck (#138–#140); the feature is fully functional without it.

Needs research before implementation: No

## Summary

The optional language layer on top of the deterministic deck: a **single deck-level prompt** entered before generation, then an LLM pass that rewrites headline/body copy for cohesion and **proposes the focus set** (biased toward at-risk and blocked goals). The LLM never owns structure — slide inventory and order stay deterministic — and **no key produces a complete deck** with zero degradation of the core flow. Prompting *before* generation treats the model as a brief-taker for a presentation the user already understands.

## Steps to Reproduce Context

1. Build a deck (#138–#140) — it is complete but uses raw check-in text verbatim; there is no prompt field and no focus suggestion.
2. Observe the existing agent plumbing: `src/lib/agent/apiKey.ts` (provider + key in browser-local storage), `src/lib/agent/llmTransport.ts` (`createStoredAgentClient`), `src/lib/agent/agentClient.ts` (`requestValidatedJson` with one feedback retry), `src/lib/agent/outputSchemas.ts`.

## Expected Behavior

- Before generation (or before polish), the user can enter one deck-level prompt steering tone and emphasis. No per-slide, no per-goal prompts.
- With a key present, a polish pass rewrites slide copy for cohesion and proposes a focus set (3–5 goals, biased toward at-risk/blocked, then newly-shipped); the user accepts or adjusts — the suggestion is never auto-applied to structure without confirmation.
- Copy rewrite outputs validated JSON matching a new output schema in `src/lib/agent/outputSchemas.ts`; a failed/rejected pass leaves the deterministic copy intact (fix it in the #139 preview, not by retrying forever).
- With no key (or transport failure), generation proceeds exactly as today: plainer but complete; the prompt field simply has nothing to act on. No error walls.
- The LLM sees only: goal titles, statuses, the user's check-in text, metric numbers, and task **titles**. Never task or project descriptions, never raw timer logs.
- Reuses the existing agent provider/key — no second key UI; the settings panel and `AgentPanel` gating remain unchanged.

## Actual Behavior

No LLM involvement anywhere in deck generation.

## Requirements for completed issue

1. New workflow module (suggested `src/lib/agent/deckPolishWorkflow.ts`) following the `startOfDayWorkflow.ts` shape: injectable client/provider/model, system prompt builder, `onProgress` events, hard-coded model default per provider.
2. New output schema(s) in `outputSchemas.ts` for rewritten copy and focus suggestion; consumed via `requestValidatedJson`.
3. Deck-level prompt capture in the build/preview flow (single field, persisted per tracker only if trivial — transient is acceptable).
4. Focus suggestion surfaced as accept/adjust UI in the #139 preview; copy rewrite applied as preview-editable text (the user can still fix anything in preview).
5. Graceful no-key and failed-pass paths: deterministic deck, no blocking errors.
6. Payload construction with the explicit field allow-list above (titles/statuses/check-in text/metric numbers/task titles only).

### Testing

- Workflow tests with an injected fake client (existing pattern in agent workflow tests): valid response applied, invalid-JSON retry then fallback to deterministic copy, empty suggestion set, no-key path returns the untouched plan.
- Payload allow-list test: serialized prompt context contains no task descriptions, project descriptions, or raw log entries.
- Preview integration: suggestion accept/adjust; rewritten copy is editable and the pre-export pass still runs on it.

## Context

Code Source: `src/lib/agent/llmTransport.ts`
Code Description: `ChatCompletionsClient` interface and `createStoredAgentClient()` (~L151–160) — browser-native fetch, Bearer auth, no streaming; a plain "polishing…" progress state is sufficient UX.

Code Source: `src/lib/agent/agentClient.ts`
Code Description: `requestValidatedJson` (~L39–72) — JSON-mode request with schema validation and one feedback retry; the validation loop to reuse.

Code Source: `src/lib/agent/startOfDayWorkflow.ts`
Code Description: The workflow template — injectable client/model, `defaultModel(provider)` per-provider hard-coded models, system prompt builders, `onProgress`.

Code Source: `src/components/SettingsPanel.tsx` (~L107–168), `src/lib/agent/apiKey.ts`
Code Description: Existing agent key/provider settings — reuse, do not duplicate.

## Notes

- Follow-up to the v1 epic (#133–#141); land only after the deterministic deck is proven good in real use.
- The v1 focus default (all goals on, #136) remains the no-LLM behavior — the suggestion is an alternative, not a replacement.
- Per-slide "punch up" re-run and explained suggestions ("I gave this a slide because…") were brainstorm directions deliberately deferred.

# Title: LiftingTracker metric source integration (follow-up)

## Tags

Complexity Classification: T3
Classification Reason: A new api-token integration (registry entry, settings UI, browser-local secret) plus a pull-only aggregate client feeding the existing goal metric block, with per-period caching and degraded-last-known behavior. Cross-cutting but well-precedented: the registry and metric data model (`source`, `overridePinned`) already exist.

Severity: Low
Severity Reason: Optional enhancement; fitness goals work with manual metric entry until this lands.

Needs research before implementation: Yes

### Research Needed

The auth model diverges from both existing api-token integrations, and the remote contract needs pinning down.

- **CORS contract:** unlike Shortcut/Linear (tokens stored server-side in Supabase and consumed by service-role Edge Functions), this integration deliberately stores the key browser-local (like the agent key) and fetches directly from the browser. That requires the LiftingTracker API to send permissive CORS headers for the configured base URL — confirm LiftingTracker's actual CORS behavior and whether the base-URL configuration is expected to point at a CORS-enabled deployment.
- **Policy exception:** a new browser-local secret key means a new `localStorage` key outside the staging store. AGENTS.md currently enumerates the staging store plus the agent keys (`worktime:agent:*`) as the only exceptions — this issue must extend that list explicitly (a new `worktime:liftingtracker:*` key following the `src/lib/agent/apiKey.ts` pattern). Do not skip the AGENTS.md update; a `goals_state_v1` UI-only key needs nothing (habit/pet precedent), but a secret key does.
- **Aggregate contract:** define the versioned endpoint shape — which aggregates exist (sessions completed, total volume, PRs, bodyweight trend), what exactly counts as a PR (absolute best vs. period best), the default endpoint path, and the response schema. A goal whose first period has no history must degrade to "no data yet," not an error.

## Summary

Make fitness goals the most evidence-backed part of the Life deck: a fifth integration-registry entry using the existing `api-token` flow — base URL, key, default endpoint configured on the Integrations page — that individual goals opt into with `Source: LiftingTracker` in their metric block. Pull-only; per-period aggregates auto-fill the metric value and feed the #138 chart series. Auto value is the default; typing a value pins an explicit override until cleared; both states badged.

## Steps to Reproduce Context

1. Open `/integrations` — the registry (`src/lib/integrations/registry.ts`) has four entries; no LiftingTracker.
2. Open a goal's metric block (#134) — `source` is typed but only `"manual"` is selectable.
3. Observe the two existing api-token integrations (Shortcut, Linear) store tokens in Supabase with column-level grants and consume them in Edge Functions — this integration deliberately does **not** follow that pattern (browser-local key, direct fetch).

## Expected Behavior

- `liftingtracker` appears in the integration registry with the `api-token` flow; its Integrations page card configures base URL, key, and default endpoint; the key is stored browser-local (agent-key pattern), never server-side, never in the staging store.
- A goal's metric block can select `Source: LiftingTracker`; when configured, the metric current value auto-fills from per-period aggregates (sessions, volume, PRs, bodyweight trend as applicable).
- Values are fetched when the Goals page opens and again at deck build; per-period fetches are cached so preview edits never re-hit the API.
- Typing a value pins an explicit override (badged "override") until cleared, at which point the auto value (badged "auto") resumes; the auto/override states use the `overridePinned` field already present from #133.
- When the API is unreachable, degrade to the last-known value with an "as of" stamp — never an error wall, never a silent zero.

## Actual Behavior

No LiftingTracker integration exists; metrics are manual-only.

## Requirements for completed issue

1. Research spike resolving CORS behavior, the AGENTS.md exception update, and the versioned aggregate contract (documented in the PR).
2. Registry entry in `src/lib/integrations/registry.ts` (+ icon union and `IntegrationsPage` branch/prop) with `registry.test.ts` updated; wire the settings instance in `AuthenticatedIntegrationsRoute` (`src/App.tsx`).
3. Browser-local key module following `src/lib/agent/apiKey.ts` (storage key, get/set/clear, subscribe) — plus the explicit AGENTS.md exception-list update.
4. Pull-only client (suggested `src/lib/integrations/liftingTracker.ts`): configurable base URL/key/endpoint, per-period aggregate fetch, versioned response parsing, and a cache keyed by (goal, period) so preview/build reuse one fetch.
5. Metric block integration: source selector, auto value display with badge, override pinning on manual entry, resume-on-clear, "as of" degradation stamp.
6. The fetched aggregate feeds the #138 sparkline/chart series like any other metric value.
7. No push, no background sync — fetches only on Goals page open and deck build, in the foreground.

### Testing

- Registry test updated for the fifth entry.
- Key module tests (agent-key pattern): set/clear/subscribe, trimmed storage.
- Client tests with injected fetch: aggregate parsing, version mismatch error, unreachable-API degradation to last-known with "as of", cache hit behavior (second call for the same goal+period makes no network call).
- Metric block tests: source selection, auto badge, override pin/clear/resume.

## Context

Code Source: `src/lib/integrations/registry.ts` (+ `registry.test.ts`, `src/components/IntegrationsPage.tsx` ~L14–67, `src/App.tsx` `AuthenticatedIntegrationsRoute` ~L108–135)
Code Description: The four-entry registry, the api-token flow label, and the card-branch wiring pattern a fifth entry must extend.

Code Source: `src/lib/agent/apiKey.ts`
Code Description: The browser-local secret pattern this integration copies instead of the Shortcut/Linear server-side pattern — `AGENT_API_KEY_STORAGE_KEY` shows the `worktime:<domain>:<key>` naming convention.

Code Source: `supabase/migrations/20260812000000_shortcut_settings.sql`
Code Description: What this integration deliberately does **not** do (server-side token table + column grants + Edge Function consumer) — kept here as the contrast that motivated the browser-local decision.

Code Source: `src/lib/goals/types.ts` (#133)
Code Description: `GoalMetric.source: "manual" | "liftingtracker"` and `overridePinned` — typed in v1 precisely so this issue changes no schema.

## Notes

- Follow-up to the v1 epic (#133–#141); depends on #133/#134 and benefits from #138 (chart series) being live.
- A "period" here is #135's `LocalDateKey` boundary pair from the anchored cadence grid — use those keys for the per-period aggregate request and the `(goal, period)` cache, never a timestamp range computed ad hoc.
- `metric.current` is written by this integration while the rest of the goal is written by the goal editor. Under #133's whole-row LWW merge those are the same row, so a concurrent editor save and an integration refresh will clobber each other. Read the forward-hazards section of `docs/plans/issue-133-decisions.md` and apply the same guarded treatment as `lastBuiltPeriodStart`, or record explicitly why not.
- One metric per goal keeps the field mapping unambiguous — if a second numeric source ever appears, revisit whether `source` becomes a provider list (deliberately premature today).
- A versioned contract now leaves room for push (goal targets → programming) later without breaking key setup.

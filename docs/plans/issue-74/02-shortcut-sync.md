# Task: Implement the Shortcut sync Edge Function

## Classification

Type: T3: cross-system authenticated API handler
Reasoning: The task spans the Edge handler and external API client with auth, secret access, pagination, and typed error mapping. Blast Radius=2, Uncertainty=2, Behavior=5, Testing=2, Reversibility=1. Total=12. It is already split from the schema and configuration tasks.

## Goal

Authenticate the Supabase caller, load only that owner's stored credentials, return their selected-team Shortcut stories with status names, and record a successful sync timestamp.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `supabase/functions/shortcut-sync/shortcutApi.ts` | create |
| `supabase/functions/shortcut-sync/index.ts` | create |

## Step-by-Step Instructions

### 1. Add the external API client

**File:** `supabase/functions/shortcut-sync/shortcutApi.ts`

Export `fetchShortcutStories(settings, fetcher?)`. Resolve `/member` and `/workflows`; search `/search/stories` with `page_size=250`, `detail=full`, and escaped team/owner operators; follow only validated same-origin `next` URLs for at most four pages. Map each story to the slim WorkTime contract: `id`, `app_url`, `name`, `description`, `estimate`, `deadline`, `workflow_state_id`, `status_name`, `completed`, `archived`, `story_type`, and `{id,name}` labels. Throw typed errors that preserve Shortcut 401 and 429 (including parsed `Retry-After`) and sanitize all other upstream failures.

### 2. Add the authenticated handler

**File:** `supabase/functions/shortcut-sync/index.ts`

Support OPTIONS and POST only. Require a bearer token, load injected Supabase env variables, and verify the token with `auth.getUser(jwt)`. Use the service-role client to select `shortcut_token` and `team_name` by the verified user ID. Never accept an owner ID from the body and never log tokens or upstream bodies.

Return stable JSON error codes for missing configuration, invalid Supabase auth, invalid Shortcut token, rate limiting, and upstream/internal failures. On success, update `last_synced_at` and return `{ stories, synced_at }`; fail rather than claim success if that timestamp write fails.

## Edge Cases to Handle

- Missing/malformed bearer token and expired Supabase JWT.
- No stored settings row.
- Shortcut 401 or 429 from any request in the flow.
- Empty result pages, null `next`, repeated/foreign pagination URL, and the 1,000-result cap.
- Missing workflow-state mappings should produce `status_name: "Unknown"`.
- Network failures and invalid upstream JSON must not expose secrets or upstream bodies.

## Related Files (read-only context)

- `supabase/functions/invite-signup/index.ts`
- `docs/issues/issue-75.md`

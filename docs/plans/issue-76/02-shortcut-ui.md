# Task: Implement and wire the Shortcut integration flow

## Classification

Type: T2: moderate interactive UI change
Reasoning: Adds a stateful card/modal and authenticated route adapter across four UI files using established context contracts. Blast Radius=2, Uncertainty=1, Behavior=3, Testing=2, Reversibility=1. Total=9.

## Goal

Provide connection, editable settings, manual sync, proposal preview, confirmation, result summaries, timestamps, and recoverable error states on `/integrations`.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/components/ShortcutIntegrationCard.tsx` | create |
| `src/components/IntegrationsPage.tsx` | update |
| `src/lib/integrations/registry.ts` | update |
| `src/App.tsx` | update |

## Step-by-Step Instructions

### 1. Build the Shortcut card and preview modal

**File:** `src/components/ShortcutIntegrationCard.tsx`

Accept a `ShortcutDataAccess`, current tasks, and the PM `createTask` callback. Load settings on mount. Render disconnected token/team/exclusion inputs; connected team/exclusion settings with Save, Disconnect, Reconnect, and Sync now actions. Invoke sync, classify stories, show proposals and skip counts in an accessible modal, and create only on confirmation. Keep a result summary visible and render invalid-token, rate-limit, upstream/network, and generic errors with relevant recovery actions.

### 2. Insert the specialized card

**File:** `src/components/IntegrationsPage.tsx`

Add an optional Shortcut binding prop. Render `ShortcutIntegrationCard` for the Shortcut registry entry when bound, preserving generic placeholder/action-slot behavior for other entries and isolated tests.

### 3. Mark Shortcut implemented and bind authenticated state

**Files:** `src/lib/integrations/registry.ts`, `src/App.tsx`

Set `shortcut.isPlaceholder` to false. Add a route wrapper under `AuthenticatedShell` that constructs the owner-scoped adapter from the shared Supabase client, reads current PM tasks, and passes `createTask` to the page.

## Edge Cases to Handle

- Disable duplicate async actions while loading, saving, syncing, or creating.
- Cancelling/closing a preview creates no tasks.
- Empty proposal sets still show skip summaries and allow closing without task writes.
- On a partial create failure, preserve the modal and report how many tasks were created.
- Invalid/revoked credentials expose a reconnect action; 429 includes retry guidance when supplied.

## Related Files (read-only context)

- `src/state/ProjectManagerContext.tsx`
- `src/lib/engine/shortcutClassification.ts`
- `src/components/IntegrationsPage.test.tsx`


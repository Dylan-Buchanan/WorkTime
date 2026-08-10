# Task: Render Start-of-Day progress in the agent panel

## Classification

Type: T2: stateful UI enhancement
Reasoning: Adds bounded event state and accessible progress presentation to one component plus integration tests. Blast Radius=2, Uncertainty=1, Behavior=3, Testing=2, Reversibility=1. Total=9.

## Goal

Replace the silent planning wait with a calm phase indicator, latest activity line, and expandable diagnostic history that persists through rejection replans.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/components/ProjectManager/AgentPanel.tsx` | update |
| `src/state/AgentApprovalContext.test.tsx` | update |

## Step-by-Step Instructions

### 1. Retain a bounded activity log

**File:** `src/components/ProjectManager/AgentPanel.tsx`

Keep at most the latest 20 `StartOfDayProgressEvent` values. Clear on a new initial generation, retain across rejection replans, and pass the same append callback to both workflow calls.

### 2. Render compact and detailed status

Add a four-stage dot stepper, an `aria-live="polite"` latest-event line, and a `<details>` disclosure containing formatted events and a clear button. Show role/model/attempt/duration/outcome for LLM events and never expose response bodies.

### 3. Verify initial and replan plumbing

**File:** `src/state/AgentApprovalContext.test.tsx`

Use the injected workflow seam to emit representative progress and assert latest status, details, clear behavior, and that replans receive the same progress callback.

## Edge Cases to Handle

- Event log is empty, event count exceeds 20, phase changes during an approval card, and an invalid attempt is followed by a valid retry.
- Screen readers should receive phase/latest updates without announcing the full historical log.

## Related Files (read-only context)

- `src/components/ProjectManager/AgentApprovalCard.tsx`
- `src/state/AgentApprovalContext.tsx`


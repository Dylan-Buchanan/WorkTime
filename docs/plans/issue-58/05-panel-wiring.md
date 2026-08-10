# Task: Launch Start-of-Day from the agent panel

## Classification

Type: T2: UI and async workflow wiring
Reasoning: Adds work-until input, loading/error states, and orchestration across existing contexts in one component and component tests. Blast Radius=2, Uncertainty=1, Behavior=3, Testing=2, Reversibility=1. Total=9.

## Goal

Provide the production path for a user to choose a work-until time, generate the plan, and enter the existing approval loop.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/components/ProjectManager/AgentPanel.tsx` | update |
| `src/state/AgentApprovalContext.test.tsx` | update |

## Step-by-Step Instructions

### 1. Add Start-of-Day controls

**File:** `src/components/ProjectManager/AgentPanel.tsx`

When `start-of-day` is selected, render a time input defaulting to a near-future local time and a Generate button. Read PM state and app logs/settings, validate the selected project/window, run orchestration, and call `startReview` with changes, summary, replan, and completion persistence.

### 2. Add async feedback

Display generation status and actionable errors while preventing duplicate starts. Keep other mode selection behavior unchanged.

### 3. Test the production launch

Mock the stored LLM client/workflow seam and assert selected work-until input launches review and exposes the first approval card.

## Edge Cases to Handle

- App state still loading, project selection changes, missing key, and passed work-until.
- Network/schema failures leave the mode form available for retry.

## Related Files (read-only context)

- `src/state/AppStateContext.tsx`
- `src/state/ProjectManagerContext.tsx`
- `src/components/ProjectManager/AgentApprovalCard.tsx`


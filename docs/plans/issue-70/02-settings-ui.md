# Task: Add the end-of-day editor

## Classification

Type: T1: limited UI change
Reasoning: One component and its focused test use a standard controlled input. Blast Radius=1, Uncertainty=0, Behavior=2, Testing=1, Reversibility=1. Total=5.

## Goal

Let users edit and save the global cutoff through the existing settings update command.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/components/SettingsPanel.tsx` | update |
| `src/components/SettingsPanel.test.tsx` | update |

## Step-by-Step Instructions

### 1. Render a time input

**File:** `src/components/SettingsPanel.tsx`

Keep numeric fields numeric, render a labeled `type="time"` input for `end_of_day`, update the local draft as a string, and preserve whole-settings Save behavior.

### 2. Cover editing and saving

**File:** `src/components/SettingsPanel.test.tsx`

Change the cutoff, save, and assert that the data-access state contains the new value.

## Edge Cases to Handle

- React state refreshes when persisted settings change.
- Numeric field conversion must not be applied to the time string.

## Related Files (read-only context)

- `src/state/AppStateContext.tsx` — existing update command wiring.

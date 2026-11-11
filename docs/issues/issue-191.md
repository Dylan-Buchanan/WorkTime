# Title: Preserve checklist order in the Start-of-Day planner prompt

## Tags

Complexity Classification: T0
Classification Reason: Prompt-copy-only change confined to a single string literal in `plannerSystemPrompt()` (`src/lib/agent/startOfDayWorkflow.ts:213`). Verified that the planner contract string (line 216) and `checklistItemSchema` (`src/lib/agent/outputSchemas.ts:22-30`) declare only `id`/`title`/`done`, and that `applyTaskChange` (`src/lib/agent/applyTaskChange.ts:23`) wholesale-copies checklists, so nothing structural or behavioral is touched. No test asserts prompt string content.

Severity: Low
Severity Reason: Worst case is a slightly weaker advisory prompt that may let the planner reorder checklist items. The schema cannot carry `order` and nothing validates returned order, so there is no data loss, migration, or runtime risk.

Needs research before implementation: No

## Summary

Once a user can arrange their own checklist (drag-to-reorder, tracked in #155), a daily plan must not silently reshuffle it. The planner currently forbids changing checklist ids and `done` flags but says nothing about order, so a plan that regenerates a task's checklist could reorder it with no rule broken. The reorder feature's entire promise is that order stays put until the user drags again — the planner is the one automated path that could quietly undo that.

Add `order` to the checklist preservation clause in the planner system prompt so it reads as preserving existing checklist item ids, done flags, **and order**.

Prompt text only. No schema change, no type change, no runtime behaviour change — the planner contract already declares `checklist: Array<{id, title, done}>` and `checklistItemSchema` maps only those three fields. The writer prompt already requires preserving "checklist count, ids, order, and done flags", so this brings the planner in line with the writer.

## Steps to Reproduce Context

1. Start the Start-of-Day planner against a project whose tasks have checklists arranged in a user-chosen order.
2. Read `plannerSystemPrompt()` in `src/lib/agent/startOfDayWorkflow.ts:202-219`.
3. Observe that the preservation clause (line 213) protects ids, `projectId`, checklist item ids/done flags, and relationships — but never order.
4. Observe that `writerSystemPrompt()` (line 226) already protects order, so the two prompts disagree.

## Requirements for completed issue

1. The planner system prompt's checklist preservation clause requires preserving existing checklist item **order** in addition to ids and done flags.
2. The writer prompt clause is left untouched (it already covers order).
3. No schema, type, output-contract, or runtime behaviour change is introduced.

## Expected Behavior

- A Start-of-Day plan is instructed to keep each task's checklist in the order the user arranged it, alongside preserving ids and done flags.
- The planner and writer prompts state the same structural preservation rules.

## Actual Behavior

- `plannerSystemPrompt()` line 213 preserves only "existing checklist item ids/done flags", so the planner is free to reorder a checklist without breaking any stated rule.

### Testing

- `pnpm test:unit` (no behavioural change expected; confirms nothing regressed).
- Code review: confirm the planner clause mentions order and the writer clause at `startOfDayWorkflow.ts:226` is unchanged.
- A test could only assert that the prompt string contains the clause. Add one only if the repo already asserts prompt content elsewhere; otherwise leave it to review.

## Issue Context

### New Files

None.

### Remove Files

None.

### Change Files

#### Planner system prompt preservation clause

Code Source: `src/lib/agent/startOfDayWorkflow.ts:213`
Code Description: The preservation clause in `plannerSystemPrompt()` listing what a plan must not change.
Code Change Description: Add order to the protected checklist properties, so the clause reads as preserving existing checklist item ids, done flags, and order.
Files Using: `src/lib/agent/startOfDayWorkflow.ts` (the prompt is consumed by the Start-of-Day planner call sites in the same file)

```ts
// src/lib/agent/startOfDayWorkflow.ts:213 — current
"Preserve ids, projectId, existing checklist item ids/done flags, and relationships unless the plan deliberately updates their content.",

// src/lib/agent/startOfDayWorkflow.ts:216 — planner contract (unchanged, has no `order`)
"Planner contract: {summary:string, proposedTasks:Array<{id?:string,...,checklist:Array<{id:string,title:string,done:boolean}>,...}>}.",
```

#### Writer prompt clause (reference only — do not edit)

Code Source: `src/lib/agent/startOfDayWorkflow.ts:226`
Code Description: The writer's structural freeze clause, which already covers order.
Code Change Description: None. Shown so the planner change mirrors it rather than diverging from it.
Files Using: `src/lib/agent/startOfDayWorkflow.ts`

```ts
"Structure is frozen: return exactly the same task count and order, preserve every task id, and preserve checklist count, ids, order, and done flags.",
```

#### Checklist schema (reference only — unchanged)

Code Source: `src/lib/agent/outputSchemas.ts:22-30`
Code Description: `checklistItemSchema` with `additionalProperties: false` and `required: ["id", "title", "done"]`.
Code Change Description: None. Order is carried by array position, so no schema field is added.
Files Using: `src/lib/agent/outputSchemas.ts`

```ts
const checklistItemSchema: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "title", "done"],
    properties: {
        id: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1 },
        done: { type: "boolean" },
```

## Edge Cases

- **Approved agent updates keep wholesale checklist replacement** (`src/lib/agent/applyTaskChange.ts:23`). The asymmetry is intentional: a *daily plan* affects every task implicitly and unattended, while an *approved update* is a reviewed, per-task action the user explicitly accepts. Do not extend the order lock to `applyTaskChange` as part of this issue.
- **Prompt clauses are advisory, not enforced.** Nothing validates the returned order, and a model can still ignore the instruction; this reduces the chance of a reshuffle rather than guaranteeing against it.
- **No new test is meaningful here.** If a test is added, it can only assert the prompt string contains the clause — worth doing only if the repo already asserts prompt content elsewhere; otherwise leave it to review.
- **Keep the writer clause untouched.** It already covers order; duplicating or rewording it risks drift between the two prompts.

## Notes

This is a one-line change with its own blast radius (agent behaviour rather than UI), and no test can truly assert it, so it travels separately and must not gate the interactive reorder feature in #155.

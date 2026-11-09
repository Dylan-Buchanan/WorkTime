# Title: Quote exit memos in the end-of-day brief

Part of #160. Depends only on #180.

## Tags

Complexity Classification: T1
Classification Reason: Extends one inline context object and the system prompt in `src/lib/agent/endOfDayWorkflow.ts` and adds assertions to an existing test file that already inspects the serialized context. No schema, engine or UI change.

Severity: Low
Severity Reason: Prompt-context enrichment only. Worst case is a slightly weaker or paraphrased summary, with no data mutation, no persisted schema change and no timer impact.

Needs research before implementation: No

## Summary

The End-of-Day brief currently infers state from statuses, estimates and worked pomodoros. A resume note is the one input that came from the user's own words, so the summary can state the actual next action instead of guessing it.

Extend the inline context object built at `src/lib/agent/endOfDayWorkflow.ts:103` so each `remainingTasks` entry may carry `{ resumeNote: { nextAction, blocker?, savedAt } }`, and add the prompt instruction that a resume note is the user's own words and must be quoted rather than paraphrased or extrapolated from.

## Steps to Reproduce Context

1. Run the End-of-Day workflow for a project.
2. The user message contains `startOfDay`, `comparison`, and `remainingTasks` entries with `id`, `title`, `status`, `priority`, `dueDate`, `estimatePomos`, `workedPomos`, `relatedTo`.
3. Resume notes written by the capture form (#182) are stored in `worktime:resume:v1` but never reach the brief, so the summary has to infer the next action from status and estimates.

## Requirements for completed issue

1. Each `remainingTasks` entry in the serialized End-of-Day context may include `resumeNote: { nextAction: string; blocker?: string; savedAt: string }`.
2. The note is resolved from the store by the app task id linked to the PM task (`PMTask.appTaskId` via the existing `findPMTaskByAppTaskId`-style resolution), not by matching titles or scanning all notes per task.
3. A task with no note omits the `resumeNote` field entirely. No `null` and no empty strings are sent, so the prompt has nothing empty to reason over.
4. A note with only a blocker and no next action is still included, since blocker text is often the most important thing in the brief.
5. `savedAt` is always included with the note so the prompt can caveat its age.
6. The system prompt gains an instruction that a resume note is the user's own words and must be quoted rather than paraphrased or extrapolated from.
7. The system prompt gains an instruction to drop a note older than the working day rather than present it as current.
8. No change to `src/lib/agent/outputSchemas.ts` unless a genuinely new output field is needed. The existing reorder-only output contract stays intact.
9. A memo is never quoted for a task that no longer appears in `remainingTasks`; because the context is built from `remaining`, this follows from requirement 1, but it is asserted in a test.

## Expected Behavior

- A remaining task with a fresh memo serializes its `nextAction`, optional `blocker`, and `savedAt` inside `remainingTasks`.
- A remaining task without a memo serializes exactly as today, with no `resumeNote` key.
- The prompt text instructs quoting, not paraphrasing, and instructing the model to ignore notes from previous days.
- Output shape, reorder validation, and `tomorrowTasks` are unchanged.

## Actual Behavior

- `remainingTasks` in the user message at `endOfDayWorkflow.ts:103` carries only `id`, `title`, `status`, `priority`, `dueDate`, `estimatePomos`, `workedPomos`, `relatedTo`.
- The system prompt (`systemPrompt()`, L59-69) says nothing about resume notes.

### Testing

1. `pnpm test:unit` passes with additions to `src/lib/agent/endOfDayWorkflow.test.ts`.
2. Seed a memo for a remaining task, run the workflow with a mocked `complete`, and assert `complete.mock.calls[0][0].messages[1].content` contains the note's `nextAction`, `blocker` and `savedAt`.
3. A remaining task with no memo → the serialized context has no `resumeNote` key for that entry. Parse the embedded JSON rather than relying only on `toContain`.
4. A blocker-only memo → the context still contains the blocker text.
5. The system message (`messages[0].content`) contains the quoting instruction.
6. A completed or archived task that has a memo does not contribute a `resumeNote` to the context.
7. `pnpm run build` passes.

## Issue Context

### New Files

None.

### Remove Files

None.

### Change Files

#### End-of-Day context object and prompt

Code Source: `src/lib/agent/endOfDayWorkflow.ts`

Code Description: `systemPrompt()` L59-69 builds the instruction string; L101-104 builds the single inline JSON user message.

```ts
const output = await requestValidatedJson<EndOfDayOutput>(client, {
    model: input.model ?? getAgentProviderConfig(provider).defaultModel,
    temperature: 0.2,
    ...(provider === "deepseek" ? { thinking: { type: "disabled" as const } } : {}),
    messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: `${input.rejectionFeedback ? `Replan feedback: ${input.rejectionFeedback}\n` : ""}End-of-Day context:\n${JSON.stringify({ startOfDay: { ... }, comparison, remainingTasks: remaining.map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, dueDate: task.dueDate, estimatePomos: task.estimatePomos, workedPomos: task.workedPomos ?? 0, relatedTo: task.relatedTo })) })}` },
    ],
}, endOfDayOutputSchema, { maxRetries: LLM_MAX_ATTEMPTS - 1 });
```

Code Change Description: Read the resume notes through the #180 store once for the whole project (`remaining` is already filtered to non-Done, non-archived tasks of this project), map `task.appTaskId` to its note, and spread `resumeNote` into each entry only when a note exists. Add the two prompt instructions to `systemPrompt()`.

Files Using: `runEndOfDayWorkflow` callers (End-of-Day UI surface), `src/lib/agent/index.ts` if the store API is re-exported there.

#### Note lookup helper already in the repo

Code Source: `src/lib/pm/workStart.ts` lines 10-15

```ts
export function findPMTaskByAppTaskId(tasks: Readonly<Record<string, PMTask>>, appTaskId: string): PMTask | null
```

Code Description: Resolves a PM task from an app task id.

Code Change Description: This issue needs the inverse hop (PM task → `appTaskId` → memo). Use `task.appTaskId` directly; the field is optional (`src/state/types.ts:61`), so an unlinked task simply has no note.

#### Store read surface

Code Source: `src/lib/resume/resumeNoteStore.ts` (from #180)

Code Description: `getResumeNotes()` returns `{ version: 1, notes: Record<appTaskId, ResumeNote> }`.

Code Change Description: Read once per workflow run before the request, mirroring the existing `getAgentStartOfDayPlan()` call at L75.

#### Existing serialized-context assertions

Code Source: `src/lib/agent/endOfDayWorkflow.test.ts` line 41

```ts
expect(complete.mock.calls[0][0].messages[1].content).toContain('"outcome":"completed"');
```

Code Description: The test file already asserts on the serialized user message content, which is the pattern to extend.

Code Change Description: Add cases for present note, absent note, blocker-only note, and the system-prompt instruction.

## Notes

- Only the current value is stored by design, so a memo replaced three times today appears once, at its last version. Do not expect or imply a diff.
- A note from a previous day is still sent with `savedAt`; the prompt is responsible for dropping it, per requirement 7. Do not filter it out silently in code.
- `workedPomos` and the note fields are both "what happened", so keep the note nested under `resumeNote` rather than flattening it into the task fields.

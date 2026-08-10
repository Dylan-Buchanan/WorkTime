## Title: Improve the UI for adding items to a task's checklist

## Tags

Complexity Classification: T1
Severity: Low
Reason: Single-component UI change confined to the Checklist editor in `TaskInspector.tsx`, replacing the native `prompt()` dialog with an inline text input following the established `TagEditor`/`LinksEditor` pattern in the same file. The checklist data model (`PMTask.checklist`), ID generation (`crypto.randomUUID`), and update/persist path (`updateTask`, with the `checklist` field already handled) are all confirmed and unchanged. Blast Radius=1 (one file, no dependent changes), Uncertainty=1 (clear in-file precedent), Behavior=2 (UI + simple add logic, no data model change), Testing=2 (testing-library available but no component-test precedent and moderate user impact if the add flow breaks), Reversibility=1 (simple frontend revert). Total=7.
Needs research before implementation: No

## Summary

Adding a checklist item to a task currently has no real UI — it falls back to the native browser `prompt("Subtask title")` dialog in the Checklist section of the Task Inspector. Replace it with a proper inline text input so adding items is easier and consistent with the rest of the editor.

## Steps to Reproduce Context

1. Open the Project Manager and select a task to open the Task Inspector.
2. Scroll to the "Checklist" section.
3. Click the "Add Item" button.

## Expected Behavior

- Adding a checklist item happens through an inline text input in the Checklist section (input + add button, Enter-to-add), matching the existing `TagEditor`/`LinksEditor` pattern in the same file.
- No native browser prompt dialogs are used to add checklist items.

## Actual Behavior

- Clicking "Add Item" opens the native browser `prompt("Subtask title")` dialog, which is the only way to add an item.
- There is no inline text field or visual affordance for adding items within the checklist list itself.

## Requirements for completed issue

1. Checklist items can be added via an inline input in the Checklist section of the Task Inspector, with no native `prompt()` dialog involved.
2. The add flow preserves current behavior: a new item `{ id: crypto.randomUUID(), title, done: false }` is appended to `task.checklist` and saved through the existing `updateTask` path.

## Context

- Files:
  - `src/components/ProjectManager/TaskInspector.tsx` — the `Checklist` component (lines 388–422) adds items via `prompt("Subtask title")`; the `TagEditor` (lines 305–343) and `LinksEditor` (lines 345–386) in the same file establish the inline-input + Enter/Add pattern to follow.
  - `src/state/ProjectManagerContext.tsx` — `updateTask` (line 630) merges the `checklist` patch and persists; the `checklist` field is already handled in the create/merge paths (lines 537, 606–608).
  - `src/state/types.ts` — line 41, `checklist: { id: string; title: string; done: boolean }[]`.

- Code Snippets:

```
// src/components/ProjectManager/TaskInspector.tsx (lines 388–398) — current add flow
const Checklist: React.FC<{ task: PMTask; update: (patch: Partial<PMTask>) => void }> = ({ task, update }) => {
    const add = () => {
        const title = prompt("Subtask title");
        if (!title) return;
        update({
            checklist: [...task.checklist, { id: crypto.randomUUID(), title, done: false }],
        });
    };
```

```
// src/components/ProjectManager/TaskInspector.tsx (lines 324–340) — the existing TagEditor add pattern
<div className="flex items-center gap-1">
    <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Add tag"
        className="bg-neutral-900 rounded px-2 py-1 text-[10px]"
        onKeyDown={(e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                add();
            }
        }}
    />
    <button onClick={add} className="text-[10px] px-2 py-1 rounded bg-neutral-800">
        Add
    </button>
</div>
```

## Notes

- Checklist items currently also have no edit or remove affordance, but this issue is scoped to the add-item UI per the request.
- No existing tests cover the TaskInspector or Checklist component.

import { useId, useState } from "react";
import type { ResumeNote } from "../lib/resume";

export interface ResumeCardProps {
    taskId: string;
    taskName: string;
    memo: ResumeNote | null;
    weight: "full" | "dimmed-line";
    enteredAt: string;
    onDismiss: () => void;
    onAdd: () => void;
}

function noteAge(savedAt: string, enteredAt: string): string {
    const minutes = Math.floor(Math.max(0, Date.parse(enteredAt) - Date.parse(savedAt)) / 60_000);
    if (!Number.isFinite(minutes) || minutes < 1) return "just now";
    return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
}

export function ResumeCard({ taskId, taskName, memo, weight, enteredAt, onDismiss, onAdd }: ResumeCardProps) {
    const [expanded, setExpanded] = useState(false);
    const contentId = useId();
    if (memo?.dismissedAt || (!memo && weight === "dimmed-line")) return null;

    const dimmed = weight === "dimmed-line";
    const age = memo ? noteAge(memo.savedAt, enteredAt) : null;
    const summary = memo ? [
        ...(memo.whereIAm ? [`Where I am: ${memo.whereIAm}`] : []),
        ...(memo.nextAction ? [`Next action: ${memo.nextAction}`] : []),
        ...(memo.blocker ? [`Blocker: ${memo.blocker}`] : []),
    ].join(" · ") : "No note from your last exit";
    const control = "shrink-0 rounded px-1 py-1 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300";

    return <section aria-label={`Resume ${taskName}`} data-task-id={taskId} data-weight={weight}
        className={`w-full min-w-0 max-w-full overflow-hidden rounded-md border border-neutral-800 px-3 py-2 text-left text-xs ${dimmed ? "bg-neutral-900/30 text-neutral-500" : "bg-neutral-900/70 text-neutral-200"}`}>
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <div className="min-w-0 flex-1 overflow-hidden">
                {!dimmed && <div className={expanded ? "break-words [overflow-wrap:anywhere]" : "truncate"}>
                    <span className="font-medium">{taskName}</span>{age && <span className="ml-2 text-neutral-500">{age}</span>}
                </div>}
                {!expanded && <p id={contentId} className="truncate">
                    {dimmed && <>{taskName} · {age} · </>}{summary}
                </p>}
            </div>
            {memo ? <button type="button" className={control} aria-expanded={expanded} aria-controls={contentId}
                onClick={() => setExpanded(value => !value)}>{expanded ? "Collapse note" : "Expand note"}</button>
                : <button type="button" className={control} onClick={onAdd}>Add note</button>}
            <button type="button" className={control} onClick={onDismiss}>Dismiss</button>
        </div>
        {expanded && memo && <div id={contentId} className="mt-2 min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] select-text">
            {dimmed && <p>{taskName} · {age}</p>}
            <dl>
                {memo.whereIAm && <><dt className="font-medium">Where I am</dt><dd>{memo.whereIAm}</dd></>}
                {memo.nextAction && <><dt className="mt-1 font-medium">Next action</dt><dd>{memo.nextAction}</dd></>}
                {memo.blocker && <><dt className="mt-1 font-medium">Blocker</dt><dd>{memo.blocker}</dd></>}
            </dl>
        </div>}
    </section>;
}

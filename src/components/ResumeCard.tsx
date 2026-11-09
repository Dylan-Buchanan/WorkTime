import { Fragment, useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
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

/** Quiet, bordered control shared by the note actions. */
const CONTROL = "inline-flex shrink-0 items-center gap-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] font-medium leading-none text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300";

export function ResumeCard({ taskId, taskName, memo, weight, enteredAt, onDismiss, onAdd }: ResumeCardProps) {
    const [expanded, setExpanded] = useState(false);
    const contentId = useId();
    if (memo?.dismissedAt || (!memo && weight === "dimmed-line")) return null;

    const dimmed = weight === "dimmed-line";
    const age = memo ? noteAge(memo.savedAt, enteredAt) : null;
    // The next action leads: it is the part that gets the user moving again.
    const parts = memo ? [
        ...(memo.nextAction ? [{ label: "Next action", value: memo.nextAction }] : []),
        ...(memo.whereIAm ? [{ label: "Where I am", value: memo.whereIAm }] : []),
        ...(memo.blocker ? [{ label: "Blocker", value: memo.blocker }] : []),
    ] : [];

    const inlineParts = (items: typeof parts, muted: boolean) => items.map((part, index) => <Fragment key={part.label}>
        {index > 0 && <span className="text-neutral-600"> · </span>}
        <span className={part.label === "Next action" ? `font-medium ${muted ? "text-neutral-400" : "text-neutral-100"}` : "text-neutral-500"}>
            {part.label}: {part.value}
        </span>
    </Fragment>);

    let collapsedSummary: ReactNode = null;
    if (!expanded) {
        if (dimmed) {
            collapsedSummary = <p id={contentId} className="truncate">
                {taskName} · {age} · {inlineParts(parts, true)}
            </p>;
        } else if (!memo) {
            collapsedSummary = <p id={contentId} className="truncate">No note from your last exit</p>;
        } else if (parts.length === 0) {
            collapsedSummary = <p id={contentId} className="truncate text-neutral-500">No details recorded</p>;
        } else {
            collapsedSummary = <div className="space-y-0.5">
                <p id={contentId} className="truncate font-medium text-neutral-100">
                    {parts[0].label}: {parts[0].value}
                </p>
                {parts.length > 1 && <p className="truncate text-neutral-500">
                    {inlineParts(parts.slice(1), true)}
                </p>}
            </div>;
        }
    }

    return <section aria-label={`Resume ${taskName}`} data-task-id={taskId} data-weight={weight}
        className={`w-full min-w-0 max-w-full overflow-hidden rounded-lg border text-left text-xs ${dimmed ? "border-neutral-800 bg-neutral-900/30 text-neutral-500" : "border-indigo-500/25 bg-neutral-900/70 text-neutral-200 shadow-sm"}`}>
        <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-48">
                {!dimmed && <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`min-w-0 max-w-full rounded border border-neutral-600 bg-neutral-800/60 px-1.5 py-0.5 font-semibold text-neutral-200 ${expanded ? "break-words [overflow-wrap:anywhere]" : "truncate"}`}>{taskName}</span>
                    {age && <span className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-400">
                        <span className="text-neutral-600" aria-hidden="true">·</span>
                        <span>{age}</span>
                    </span>}
                </div>}
                {collapsedSummary}
            </div>
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1">
                {memo ? <button type="button" className={CONTROL} aria-expanded={expanded} aria-controls={contentId}
                    onClick={() => setExpanded(value => !value)}>
                    {expanded ? <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" /> : <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />}
                    {expanded ? "Collapse note" : "Expand note"}
                </button>
                    : <button type="button" className={CONTROL} onClick={onAdd}>
                        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                        Add note
                    </button>}
                <button type="button" className={`${CONTROL} hover:border-red-500/50 hover:bg-red-950/30 hover:text-red-200`} onClick={onDismiss}>
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                    Dismiss
                </button>
            </div>
        </div>
        {expanded && memo && <div id={contentId} className="min-w-0 border-t border-neutral-800 px-3 pb-3 pt-2.5 whitespace-pre-wrap break-words [overflow-wrap:anywhere] select-text">
            {dimmed && <p className="mb-2 text-neutral-400">{taskName} · {age}</p>}
            <dl className="space-y-2">
                {memo.nextAction && <div className="rounded-md border border-indigo-500/25 bg-indigo-950/25 px-2.5 py-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-indigo-300">Next action</dt>
                    <dd className="mt-0.5 font-medium text-neutral-100">{memo.nextAction}</dd>
                </div>}
                {memo.whereIAm && <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Where I am</dt>
                    <dd className="mt-0.5">{memo.whereIAm}</dd>
                </div>}
                {memo.blocker && <div className="rounded-md border border-amber-500/25 bg-amber-950/30 px-2.5 py-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">Blocker</dt>
                    <dd className="mt-0.5 text-amber-100">{memo.blocker}</dd>
                </div>}
            </dl>
        </div>}
    </section>;
}

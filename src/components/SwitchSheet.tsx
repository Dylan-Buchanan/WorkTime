import { useEffect, useId, useRef, useState } from "react";
import type { Project } from "../state/types";
import type { RankedCandidate, WhatsNextResult } from "../lib/whatsNext";
import { formatPomodoroCount } from "../lib/timer";

export interface SwitchSheetProps {
    mode: "switch" | "waiting";
    result: WhatsNextResult;
    projects: Readonly<Record<string, Project>>;
    linkStateOf: (pmTaskId: string) => "ready" | "preparing" | "failed";
    linkErrorOf?: (pmTaskId: string) => string | undefined;
    waitingType?: "agent" | "person";
    onSetWaitingType?: (type: "agent" | "person") => void;
    onSelect: (pmTaskId: string) => void;
    onRetryLink?: (pmTaskId: string) => void;
    onClose: () => void;
    busyTaskId?: string | null;
    notice?: string | null;
    error?: string | null;
}

export function SwitchSheet(props: SwitchSheetProps) {
    const { mode, result, projects, linkStateOf, linkErrorOf, waitingType = "agent", onSetWaitingType, onSelect, onRetryLink, onClose, busyTaskId, notice, error } = props;
    const headingId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    const [expanded, setExpanded] = useState(false);
    useEffect(() => {
        const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const dialog = dialogRef.current;
        dialog?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
            if (event.key !== "Tab" || !dialog) return;
            const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), [tabindex="0"]'));
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
                event.preventDefault(); first?.focus();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            if (invoker?.isConnected) invoker.focus();
        };
    }, []);

    const card = ({ task, projectId, remainingPomodoros, dueDate }: RankedCandidate) => {
        const project = projectId ? projects[projectId] : undefined;
        const linkState = linkStateOf(task.id);
        const preparing = busyTaskId === task.id || linkState === "preparing";
        const failed = linkState === "failed";
        return <li key={task.id} className="rounded-lg border border-neutral-700 p-3">
            <button type="button" onClick={() => onSelect(task.id)} disabled={Boolean(busyTaskId) || failed} className="w-full rounded text-left disabled:opacity-60">
                <span className="block font-medium text-neutral-100">{task.title}</span>
                <span className="mt-1 flex items-center gap-2 text-xs text-neutral-400">
                    {project && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} />}
                    <span>{project?.name ?? "No project"}</span>
                </span>
                <span className="mt-2 flex flex-wrap gap-3 text-xs text-neutral-300">
                    <span>{remainingPomodoros > 0 ? `${formatPomodoroCount(remainingPomodoros)} left` : "No estimate"}</span>
                    {dueDate && <span>Due {dueDate}</span>}
                    <span>{task.priority}</span><span>{task.status}</span>
                </span>
                {preparing && !failed && <span className="mt-2 block text-xs" role="status">preparing…</span>}
            </button>
            {failed && <div className="mt-2 text-xs text-red-300">
                <p role="alert">{linkErrorOf?.(task.id) ?? "Could not prepare this task."}</p>
                {onRetryLink && <button type="button" className="mt-1 rounded border border-neutral-600 px-3 py-1" disabled={Boolean(busyTaskId)} onClick={() => onRetryLink(task.id)}>Retry</button>}
            </div>}
        </li>;
    };
    return <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <button type="button" tabIndex={-1} aria-label="Close switch sheet backdrop" className="absolute inset-0 bg-black/70" onClick={onClose} />
        <div className="app-scrollbar relative z-10 max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id={headingId} className="text-lg font-semibold">{mode === "waiting" ? "Waiting — switch task" : "Switch task"}</h2>
                <button type="button" onClick={onClose} className="rounded border border-neutral-700 px-3 py-1 text-sm">Close</button>
            </div>
            {mode === "waiting" && <div role="group" aria-label="Waiting on" className="mb-4 flex gap-2">
                {(["agent", "person"] as const).map((type) => <button key={type} type="button" aria-pressed={waitingType === type} onClick={() => onSetWaitingType?.(type)} className="rounded border border-neutral-600 px-3 py-2 text-sm aria-pressed:bg-indigo-600">{type === "agent" ? "Agent" : "Person"}</button>)}
            </div>}
            {notice && <p role="status" className="mb-3 text-sm text-indigo-300">{notice}</p>}
            {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
            {result.top.length === 0 && result.continuation.length === 0 && <p>Nothing else to switch to</p>}
            {([ ["top-pick", "Top pick"], ["quick-win", "Quick win"], ["next-up", "Next up"] ] as const).map(([tier, label]) => {
                const candidates = result.top.filter((candidate) => candidate.tier === tier);
                return candidates.length > 0 && <section key={tier} className="mb-4"><h3 className="mb-2 text-sm font-semibold">{label}</h3><ul className="space-y-2">{candidates.map(card)}</ul></section>;
            })}
            {result.continuation.length > 0 && <section>
                <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="mb-2 text-sm font-semibold">Other options</button>
                {expanded && <ul className="space-y-2">{result.continuation.map(card)}</ul>}
            </section>}
        </div>
    </div>;
}

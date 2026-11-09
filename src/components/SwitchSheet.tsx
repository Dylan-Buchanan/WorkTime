import { useEffect, useId, useRef, useState } from "react";
import type { Project, TaskPriority } from "../state/types";
import type { PromotionTier, RankedCandidate, WhatsNextResult } from "../lib/whatsNext";
import { formatPomodoroCount } from "../lib/timer";
import { Check, ChevronRight, Bot, User } from "lucide-react";
import { useOptionalResumeMemo } from "../state/ResumeMemoContext";

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

const TIER_META: Record<PromotionTier, { label: string; accent: string; dot: string }> = {
    "top-pick": { label: "Top pick", accent: "text-emerald-300", dot: "bg-emerald-400" },
    "quick-win": { label: "Quick win", accent: "text-sky-300", dot: "bg-sky-400" },
    "next-up": { label: "Next up", accent: "text-violet-300", dot: "bg-violet-400" },
};

const PRIORITY_STYLES: Record<TaskPriority, string> = {
    High: "border-rose-400/25 bg-rose-400/10 text-rose-300",
    Medium: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    Low: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
};

const WAITING_CHOICES = [
    { type: "agent" as const, label: "Agent", hint: "An AI or automated process", icon: Bot },
    { type: "person" as const, label: "Person", hint: "A teammate or someone else", icon: User },
];

const WAITING_ACTIVE: Record<"agent" | "person", string> = {
    agent: "border-violet-700 bg-violet-950/40 text-violet-200",
    person: "border-amber-700 bg-amber-950/40 text-amber-200",
};

const WAITING_IDLE: Record<"agent" | "person", string> = {
    agent: "border-neutral-700 bg-neutral-900/60 text-neutral-300 hover:border-violet-700 hover:bg-violet-950/20",
    person: "border-neutral-700 bg-neutral-900/60 text-neutral-300 hover:border-amber-700 hover:bg-amber-950/20",
};

const WAITING_ACCENT: Record<"agent" | "person", string> = {
    agent: "text-violet-300",
    person: "text-amber-300",
};

const WAITING_DOT: Record<"agent" | "person", string> = {
    agent: "bg-violet-400",
    person: "bg-amber-400",
};

export function SwitchSheet(props: SwitchSheetProps) {
    const { mode, result, projects, linkStateOf, linkErrorOf, waitingType = "agent", onSetWaitingType, onSelect, onRetryLink, onClose, busyTaskId, notice, error } = props;
    const headingId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    const [expanded, setExpanded] = useState(false);
    const holdMemoPresentation = useOptionalResumeMemo()?.holdMemoPresentation;
    useEffect(() => {
        const releaseMemoPresentation = holdMemoPresentation?.();
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
            releaseMemoPresentation?.();
        };
    }, [holdMemoPresentation]);

    const card = ({ task, projectId, remainingPomodoros, dueDate }: RankedCandidate, index: number) => {
        const project = projectId ? projects[projectId] : undefined;
        const linkState = linkStateOf(task.id);
        const preparing = busyTaskId === task.id || linkState === "preparing";
        const failed = linkState === "failed";
        return <li key={task.id} className="switch-card-in" style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}>
            <div className={`group relative overflow-hidden rounded-xl border bg-neutral-900/60 transition-colors duration-200 focus-within:border-neutral-500/70 hover:bg-neutral-900 hover:shadow-lg hover:shadow-black/20 motion-safe:hover:-translate-y-0.5 ${failed ? "border-red-500/30" : "border-neutral-700/70"}`}>
                {project && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 transition-all duration-200 group-hover:w-1.5" style={{ backgroundColor: project.color }} />}
                <div className="p-3 pl-4">
                    <button type="button" onClick={() => onSelect(task.id)} disabled={Boolean(busyTaskId) || failed} className="flex w-full items-start justify-between gap-3 rounded-lg text-left disabled:cursor-not-allowed disabled:opacity-60">
                        <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold text-neutral-100">{task.title}</span>
                            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-400">
                                {project && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />}
                                <span className="truncate">{project?.name ?? "No project"}</span>
                            </span>
                            <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                                <span className="inline-flex items-center rounded-full border border-neutral-600/40 bg-neutral-800/60 px-2 py-0.5 font-medium text-neutral-300">
                                    {remainingPomodoros > 0 ? `${formatPomodoroCount(remainingPomodoros)} left` : "No estimate"}
                                </span>
                                {dueDate && <span className="inline-flex items-center rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 font-medium text-sky-300">
                                    Due {dueDate}
                                </span>}
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${PRIORITY_STYLES[task.priority]}`}>
                                    {task.priority}
                                </span>
                                <span className="inline-flex items-center rounded-full border border-neutral-600/40 bg-neutral-800/40 px-2 py-0.5 font-medium text-neutral-400">
                                    {task.status}
                                </span>
                            </span>
                        </span>
                        <ChevronRight size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-neutral-600 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-neutral-300" />
                    </button>
                    {preparing && !failed && <span className="mt-2 block text-xs text-sky-300" role="status">preparing…</span>}
                    {failed && <div className="mt-2 text-xs text-red-300">
                        <p role="alert">{linkErrorOf?.(task.id) ?? "Could not prepare this task."}</p>
                        {onRetryLink && <button type="button" className="mt-1 rounded border border-neutral-600 px-3 py-1" disabled={Boolean(busyTaskId)} onClick={() => onRetryLink(task.id)}>Retry</button>}
                    </div>}
                </div>
            </div>
        </li>;
    };
    return <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <button type="button" tabIndex={-1} aria-label="Close switch sheet backdrop" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <div className="switch-sheet-in app-scrollbar relative z-10 max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-neutral-700/80 bg-neutral-950/95 p-5 shadow-2xl shadow-black/40">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/[0.05] to-transparent" />
            <div className="relative mb-5 flex items-start justify-between gap-3">
                <div>
                    <h2 id={headingId} className="text-lg font-semibold">{mode === "waiting" ? "Waiting — switch task" : "Switch task"}</h2>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                        {mode === "waiting" ? "Choose who you're waiting on, then pick up something else." : "Pick up something else without stopping the clock."}
                    </p>
                </div>
                <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:bg-neutral-800/70">Close</button>
            </div>
            {mode === "waiting" && <div className="relative mb-5">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Who are you waiting on?</div>
                <div role="group" aria-label="Waiting on" className="grid grid-cols-2 gap-2">
                    {WAITING_CHOICES.map(({ type, label, hint, icon: Icon }) => {
                        const selected = waitingType === type;
                        return <button
                            key={type}
                            type="button"
                            aria-pressed={selected}
                            aria-label={label}
                            onClick={() => onSetWaitingType?.(type)}
                            className={`relative flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors duration-200 ${selected ? WAITING_ACTIVE[type] : WAITING_IDLE[type]}`}
                        >
                            <span className={`inline-flex items-center gap-2 text-sm font-semibold ${WAITING_ACCENT[type]}`}>
                                <Icon size={16} aria-hidden="true" />
                                {label}
                            </span>
                            <span className="pr-4 text-[11px] leading-snug text-neutral-400">{hint}</span>
                            <span aria-hidden="true" className={`absolute right-3 top-3 grid h-4 w-4 place-items-center rounded-full border ${selected ? `border-transparent ${WAITING_DOT[type]}` : "border-neutral-600"}`}>
                                {selected && <Check size={11} className="text-neutral-950" strokeWidth={3} />}
                            </span>
                        </button>;
                    })}
                </div>
            </div>}
            {notice && <p role="status" className="mb-3 rounded-lg border border-indigo-400/20 bg-indigo-400/10 px-3 py-2 text-sm text-indigo-300">{notice}</p>}
            {error && <p role="alert" className="mb-3 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-300">{error}</p>}
            {result.top.length === 0 && result.continuation.length === 0 && <p className="rounded-lg border border-dashed border-neutral-700/70 px-3 py-6 text-center text-sm text-neutral-500">Nothing else to switch to</p>}
            {(["top-pick", "quick-win", "next-up"] as const).map((tier) => {
                const candidates = result.top.filter((candidate) => candidate.tier === tier);
                const meta = TIER_META[tier];
                return candidates.length > 0 && <section key={tier} className="mb-4">
                    <h3 className={`mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${meta.accent}`}>
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                    </h3>
                    <ul className="space-y-2">{candidates.map(card)}</ul>
                </section>;
            })}
            {result.continuation.length > 0 && <section>
                <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="mb-2 flex w-full items-center justify-between rounded-lg border border-neutral-700/60 bg-neutral-900/40 px-3 py-2 text-sm font-semibold text-neutral-300 transition-colors hover:bg-neutral-800/60">
                    <span>Other options</span>
                    <ChevronRight size={15} aria-hidden="true" className={`transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
                </button>
                {expanded && <ul className="space-y-2">{result.continuation.map(card)}</ul>}
            </section>}
        </div>
    </div>;
}

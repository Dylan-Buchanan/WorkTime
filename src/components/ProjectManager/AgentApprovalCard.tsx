import React from "react";
import { AlertTriangle, ArrowRight, Check, X } from "lucide-react";
import type { TaskChange } from "../../lib/engine/diffEngine";
import type { PMTask, ProposedTask } from "../../state/types";

const TYPE_LABELS: Record<TaskChange["type"], string> = {
    create: "Create task", update: "Update task", split: "Split task", remove: "Remove task", reorder: "Reorder tasks",
};

const REASON_LABELS: Record<string, string> = {
    "split-with-worked-progress": "A task with recorded work cannot be split.",
    "split-source-not-found": "The source task no longer exists.",
    "estimate-increase-requires-rationale": "An estimate increase needs a rationale.",
    "done-transition-is-timer-owned": "Only the timer can mark a task Done.",
};

function TaskSummary({ task, empty }: { task?: PMTask | ProposedTask; empty: string }) {
    if (!task) return <span className="text-neutral-500 italic">{empty}</span>;
    return (
        <div className="min-w-0">
            <div className="font-medium text-neutral-100 break-words">{task.title}</div>
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-neutral-400">
                <span>{task.status}</span><span>{task.priority}</span>
                {task.dueDate && <span>Due {task.dueDate}</span>}
                {task.estimatePomos !== undefined && <span>{task.estimatePomos} pomos</span>}
            </div>
        </div>
    );
}

interface AgentApprovalCardProps {
    change: TaskChange;
    busy?: boolean;
    orderLabels?: { before: string[]; after: string[] };
    onApprove: () => void;
    onReject: () => void;
}

export const AgentApprovalCard = React.memo(function AgentApprovalCard({
    change,
    busy = false,
    orderLabels,
    onApprove,
    onReject,
}: AgentApprovalCardProps) {
    const warnings = [
        change.guardrails.forwardDueDate ? "Due date moves later" : null,
        change.guardrails.estimateIncreased ? "Estimate increases" : null,
    ].filter(Boolean) as string[];

    return (
        <article aria-label={`${TYPE_LABELS[change.type]} proposal`} className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-xl">
            <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-violet-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200">{TYPE_LABELS[change.type]}</span>
                {change.blocked && <span className="flex items-center gap-1 text-[10px] text-red-300"><AlertTriangle size={12} />Blocked</span>}
            </div>

            {change.type === "reorder" ? (
                <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-start gap-2 rounded-lg bg-neutral-950/60 p-2 text-[10px]">
                    <span className="break-words text-neutral-400">{orderLabels?.before.join(" → ") || change.beforeTaskIds?.join(" → ") || "No order"}</span>
                    <ArrowRight size={13} className="text-neutral-600" />
                    <span className="break-words text-neutral-200">{orderLabels?.after.join(" → ") || change.afterTaskIds?.join(" → ") || "No order"}</span>
                </div>
            ) : (
                <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-start gap-2 rounded-lg bg-neutral-950/60 p-2">
                    <TaskSummary task={change.before} empty="New task" />
                    <ArrowRight size={14} className="mt-1 text-neutral-600" />
                    <TaskSummary task={change.after} empty="Archived" />
                </div>
            )}

            {change.rationale && <p className="mt-2 text-[11px] leading-relaxed text-neutral-300"><span className="text-neutral-500">Why: </span>{change.rationale}</p>}
            {(warnings.length > 0 || change.blockReasons.length > 0) && (
                <div className="mt-2 space-y-1" aria-label="Guardrails">
                    {warnings.map((warning) => <div key={warning} className="flex items-center gap-1 text-[10px] text-amber-300"><AlertTriangle size={11} />{warning}</div>)}
                    {change.blockReasons.map((reason) => <div key={reason} className="flex items-center gap-1 text-[10px] text-red-300"><AlertTriangle size={11} />{REASON_LABELS[reason] ?? reason}</div>)}
                </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={onReject} disabled={busy} className="flex items-center justify-center gap-1 rounded-lg border border-neutral-700 px-3 py-2 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"><X size={14} />Reject</button>
                <button type="button" onClick={onApprove} disabled={busy || change.blocked} title={change.blocked ? "This change is blocked by a guardrail" : undefined} className="flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"><Check size={14} />Approve</button>
            </div>
        </article>
    );
});

import type { PMTaskWaiting } from "../state/types";
import { formatWaitingDuration } from "../lib/pm/waitingDuration";

export function WaitingDot({ waiting }: { waiting: PMTaskWaiting }) {
    const label = `Waiting on ${waiting.type}`;
    return (
        <span
            role="img"
            aria-label={label}
            title={label}
            className={`h-2 w-2 shrink-0 rounded-full ${waiting.type === "agent" ? "bg-violet-400" : "bg-amber-500"}`}
        />
    );
}

export function WaitingBadge({ waiting, nowMs, onClear }: { waiting: PMTaskWaiting; nowMs: number; onClear: () => void }) {
    return (
        <span
            title={`Waiting on ${waiting.type} · ${formatWaitingDuration(waiting.since, nowMs)}`}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium tracking-wide ${waiting.type === "agent" ? "text-violet-300 bg-violet-400/15" : "text-amber-300 bg-amber-500/10"}`}
        >
            <span>WAITING · {waiting.type.toUpperCase()}</span>
            <button
                type="button"
                aria-label="Clear waiting"
                onClick={onClear}
                className="rounded px-1 text-sm leading-none hover:bg-neutral-500/10 focus-visible:outline focus-visible:outline-current"
            >
                ×
            </button>
        </span>
    );
}

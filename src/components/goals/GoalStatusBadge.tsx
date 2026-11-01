import React from "react";
import type { Goal, GoalCheckIn } from "../../state/types";

type Lifecycle = Goal["lifecycle"];
type StatusPill = GoalCheckIn["statusPill"];

const base = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium";

const LIFECYCLE_STYLES: Record<Lifecycle, { label: string; className: string }> = {
    active: { label: "Active", className: "border-sky-700 bg-sky-950/40 text-sky-200" },
    achieved: { label: "Achieved", className: "border-emerald-700 bg-emerald-950/40 text-emerald-200" },
    dropped: { label: "Dropped", className: "border-neutral-700 bg-neutral-900/60 text-neutral-400" },
};

const STATUS_STYLES: Record<StatusPill, { label: string; className: string }> = {
    "on-track": { label: "On track", className: "border-emerald-700 bg-emerald-950/40 text-emerald-200" },
    "at-risk": { label: "At risk", className: "border-amber-700 bg-amber-950/40 text-amber-200" },
    blocked: { label: "Blocked", className: "border-rose-700 bg-rose-950/40 text-rose-200" },
};

/** Colored lifecycle pill for a goal row. Presentation only; no behavior. */
export const GoalStatusBadge: React.FC<{ lifecycle: Lifecycle }> = ({ lifecycle }) => {
    const style = LIFECYCLE_STYLES[lifecycle];
    return <span className={`${base} ${style.className}`} data-goal-lifecycle={lifecycle}>{style.label}</span>;
};

/** Colored check-in status chip shown beside the wizard's status select. */
export const CheckInStatusBadge: React.FC<{ statusPill: StatusPill }> = ({ statusPill }) => {
    const style = STATUS_STYLES[statusPill];
    return <span className={`${base} ${style.className}`} data-status-pill={statusPill}>{style.label}</span>;
};

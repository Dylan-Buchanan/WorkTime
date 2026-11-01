import React, { useEffect, useRef } from "react";
import type { Goal, GoalCheckIn } from "../../state/types";
import type { PeriodBounds } from "../../lib/goals/periods";
import { buildGoalEvidence, evidencePrefillText, formatEvidenceHours } from "../../lib/goals/evidence";
import { usePM } from "../../state/ProjectManagerContext";
import { useAppState } from "../../state/AppStateContext";

export interface GoalEvidencePanelProps {
    goal: Goal;
    checkIn: GoalCheckIn;
    period: PeriodBounds;
    onChange: (patch: Partial<Pick<GoalCheckIn, "did" | "current" | "evidenceTaskIds">>) => void;
}

const button = "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50";

/**
 * Read-only project evidence for one goal card. Suggestions are explicit
 * accept/reject checkboxes; the Current prefill is written once on first open
 * and frozen after any manual edit (Refresh is the only later re-sync).
 */
export const GoalEvidencePanel: React.FC<GoalEvidencePanelProps> = ({ goal, checkIn, period, onChange }) => {
    const pm = usePM();
    const { state: appState } = useAppState();
    const frozenRef = useRef(goal.projectId === null || checkIn.current !== "");
    const lastSeenRef = useRef(checkIn.current);
    const prefilledRef = useRef<string | null>(null);

    const evidence = buildGoalEvidence({
        goal,
        checkIn,
        period,
        projects: Object.values(pm.state.projects),
        pmTasks: Object.values(pm.state.tasks),
        backendTasks: appState ? Object.values(appState.tasks) : [],
        logs: appState?.logs ?? [],
    });

    // Freeze when the Current value changes from anything other than our own prefill.
    useEffect(() => {
        if (checkIn.current === lastSeenRef.current) return;
        const ownWrite = prefilledRef.current !== null && checkIn.current === prefilledRef.current;
        if (!ownWrite) frozenRef.current = true;
        lastSeenRef.current = checkIn.current;
    }, [checkIn.current]);

    // First-open prefill only. This never writes `did`.
    useEffect(() => {
        if (frozenRef.current || prefilledRef.current !== null) return;
        if (checkIn.current !== "" || goal.projectId === null) return;
        const text = evidencePrefillText(evidence.inProgress);
        if (!text) return;
        prefilledRef.current = text;
        onChange({ current: text });
    }, [checkIn.current, evidence.inProgress, goal.projectId, onChange]);

    if (goal.projectId === null) return null;

    const toggle = (pmTaskId: string, checked: boolean) => {
        const ids = checkIn.evidenceTaskIds;
        onChange({
            evidenceTaskIds: checked
                ? (ids.includes(pmTaskId) ? [...ids] : [...ids, pmTaskId])
                : ids.filter(id => id !== pmTaskId),
        });
    };

    const refresh = () => {
        const text = evidencePrefillText(evidence.inProgress);
        prefilledRef.current = text;
        lastSeenRef.current = text;
        // An explicit refresh is the only write path after the first manual edit.
        frozenRef.current = true;
        onChange({ current: text });
    };

    const summaryParts: string[] = [];
    if (evidence.completedTaskCount > 0) {
        summaryParts.push(`${evidence.completedTaskCount} ${evidence.completedTaskCount === 1 ? "task" : "tasks"} done`);
    }
    if (evidence.hoursMinutes > 0) summaryParts.push(formatEvidenceHours(evidence.hoursMinutes));

    return <section aria-label={`Evidence for ${goal.title}`} className="space-y-2 rounded-md border border-neutral-800/70 bg-neutral-950/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Evidence</h4>
            {summaryParts.length > 0 && <p className="ml-auto text-xs text-neutral-400">{summaryParts.join(" · ")}</p>}
        </div>
        {evidence.brokenProject
            ? <p className="text-xs text-neutral-500">Linked project no longer exists - evidence is unavailable.</p>
            : <>
                {evidence.completedTasks.length > 0 && <ul className="space-y-1">
                    {evidence.completedTasks.map(item => <li key={item.pmTaskId}>
                        <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                            <input
                                type="checkbox"
                                checked={item.accepted}
                                aria-label={`Evidence ${item.title} for ${goal.title}`}
                                onChange={event => toggle(item.pmTaskId, event.target.checked)}
                            />
                            <span>{item.title}</span>
                            <span className="text-xs text-neutral-500">{item.completedOn}</span>
                        </label>
                    </li>)}
                </ul>}
                <p className="text-xs text-neutral-500">Best effort: only tasks finalized through the timer appear here.</p>
                {evidence.inProgress.length > 0 && <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-neutral-500">In Progress: {evidencePrefillText(evidence.inProgress)}</p>
                    <button type="button" className={button} onClick={refresh}>Refresh suggestions</button>
                </div>}
            </>}
    </section>;
};

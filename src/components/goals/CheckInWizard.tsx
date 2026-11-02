import React, { useEffect, useRef, useState } from "react";
import type { Goal, GoalCheckIn } from "../../state/types";
import type { LocalDateKey } from "../../lib/todos/types";
import { localDateKey } from "../../lib/todos/calendar";
import { createGoalCheckIn, isGoalDateKey } from "../../lib/goals/factories";
import {
    firstPeriod,
    goalGrid,
    listPeriods,
    periodAt,
    periodLabel,
    periodRangeLabel,
    type GoalPeriod,
} from "../../lib/goals/periods";
import { isGoalIncludedInPeriod, normalizeCheckInHistory, slipSummary, unmetPlannedItems } from "../../lib/goals/slips";
import { useGoals } from "../../state/GoalContext";
import { CheckInStatusBadge } from "./GoalStatusBadge";
import { GoalEvidencePanel } from "./GoalEvidencePanel";
import { GoalSlipBadge } from "./GoalSlipBadge";
import { HabitMetricStrip } from "./HabitMetricStrip";

export interface CheckInWizardProps {
    trackerId: string;
    period: GoalPeriod;
    onClose: () => void;
}

const control = "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs";
const button = `${control} hover:bg-neutral-800 disabled:opacity-50`;
const primary = "rounded bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-500 disabled:opacity-50";
const STATUS_OPTIONS: Array<[GoalCheckIn["statusPill"], string]> = [
    ["on-track", "On track"],
    ["at-risk", "At risk"],
    ["blocked", "Blocked"],
];

const pairKey = (row: GoalCheckIn) => `${row.goalId}\u0000${row.periodStart}`;
const cloneCheckIn = (row: GoalCheckIn): GoalCheckIn => ({
    ...row,
    planned: row.planned.map(item => ({ text: item.text, dueDate: item.dueDate })),
    evidenceTaskIds: [...row.evidenceTaskIds],
});
const failureMessage = (error: unknown) => error instanceof Error ? error.message : "Unable to save check-ins. Please try again.";

/** One-line recital shown while a goal card is minimized. */
const minimizedSummary = (row: GoalCheckIn): string => {
    const did = row.did.replace(/\s+/g, " ").trim();
    const planned = row.planned.filter(item => item.text.trim() !== "").length;
    const parts = [did === "" ? "Nothing entered yet." : did];
    if (planned > 0) parts.push(`${planned} ${planned === 1 ? "plan" : "plans"} for next period`);
    return parts.join(" · ");
};

function currentDateKey(): LocalDateKey {
    const key = localDateKey(new Date());
    if (!isGoalDateKey(key)) throw new RangeError("Invalid goal date");
    return key;
}

/** One draft per active goal, seeded from the stored natural-key row. */
function buildDrafts(periodStart: LocalDateKey, goals: readonly Goal[], checkIns: readonly GoalCheckIn[]): Record<string, GoalCheckIn> {
    const drafts: Record<string, GoalCheckIn> = {};
    for (const goal of goals) {
        const existing = checkIns.find(row => row.goalId === goal.id && row.periodStart === periodStart);
        if (existing) {
            drafts[goal.id] = cloneCheckIn(existing);
            continue;
        }
        // The shared factory defaults focus off; the wizard defaults new active-goal rows on.
        drafts[goal.id] = {
            ...createGoalCheckIn({ goalId: goal.id, periodStart }, new Date(), crypto.randomUUID()),
            isFocus: true,
        };
    }
    return drafts;
}

/**
 * The complete desired check-in set: every stored row is retained unless the
 * wizard replaced that natural key. Historical/off-grid keys stay untouched.
 */
function mergeDrafts(stored: readonly GoalCheckIn[], drafts: readonly GoalCheckIn[]): GoalCheckIn[] {
    const edited = new Set(drafts.map(pairKey));
    return [
        ...stored.filter(row => !edited.has(pairKey(row))).map(cloneCheckIn),
        ...drafts.map(cloneCheckIn),
    ];
}

export const CheckInWizard: React.FC<CheckInWizardProps> = ({ trackerId, period, onClose }) => {
    const goals = useGoals();
    const { state } = goals;
    const tracker = state.trackers[trackerId];
    const [activePeriod, setActivePeriod] = useState<GoalPeriod>(period);
    // A goal created at/after the period end never appears in that period, even
    // though it is active now; section 4's inclusion rule matches the deck.
    const activeGoals = tracker
        ? Object.values(state.goals)
            .filter(row =>
                row.trackerId === trackerId &&
                row.lifecycle === "active" &&
                isGoalIncludedInPeriod(row, activePeriod))
            .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
        : [];
    const [drafts, setDrafts] = useState<Record<string, GoalCheckIn>>(() => buildDrafts(period.periodStart, activeGoals, Object.values(state.checkIns)));
    const [dismissedStamp, setDismissedStamp] = useState<LocalDateKey | null>(null);
    const [reloadMessage, setReloadMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    // Minimized cards keep their body mounted (so drafts and the evidence
    // prefill refs survive) but hidden, letting a long period stay scannable.
    const [minimizedGoalIds, setMinimizedGoalIds] = useState<ReadonlySet<string>>(() => new Set());
    const loadedPeriodRef = useRef(period.periodStart);

    // Period selection (the past-period editor) reloads the stored rows for the
    // chosen grid period. The pinned prop only changes when the page reopens us.
    useEffect(() => {
        if (loadedPeriodRef.current === activePeriod.periodStart) return;
        loadedPeriodRef.current = activePeriod.periodStart;
        setDrafts(buildDrafts(activePeriod.periodStart, activeGoals, Object.values(state.checkIns)));
        setMinimizedGoalIds(new Set());
    }, [activePeriod.periodStart, activeGoals, state.checkIns]);

    if (!tracker) {
        return <section aria-label="Check-in wizard" className="rounded border border-neutral-800 p-4">
            <p role="status">Loading check-in…</p>
        </section>;
    }

    const grid = goalGrid(tracker);
    const today = currentDateKey();
    const current = periodAt(grid, today);
    const periods = listPeriods(grid, firstPeriod(grid).periodStart, (current ?? activePeriod).periodEnd);
    const lastBuilt = tracker.lastBuiltPeriodStart;
    // TEST-VERIFIABLE ONLY until #140 stamps lastBuiltPeriodStart: this guard has
    // no real build key to observe yet, so it is exercised only by simulated data.
    const staleWarning = lastBuilt !== null && lastBuilt >= activePeriod.periodStart && dismissedStamp !== lastBuilt;
    // "Did not do" is derived from the latest stored row before the selected
    // period; no new persisted field is added to GoalCheckIn.
    const storedHistory = normalizeCheckInHistory(Object.values(state.checkIns));

    const patchDraft = (goalId: string, patch: Partial<GoalCheckIn>) => {
        const updatedAt = new Date().toISOString();
        setDrafts(previous => {
            const row = previous[goalId];
            if (!row) return previous;
            return { ...previous, [goalId]: { ...row, ...patch, updatedAt } };
        });
    };
    // The habit strip hands over only the sentence to append; the append (and the
    // duplicate guard) stays here so repeat presses cannot stack prose.
    const insertCurrent = (goalId: string, text: string) => {
        const updatedAt = new Date().toISOString();
        setDrafts(previous => {
            const row = previous[goalId];
            if (!row || row.current.includes(text)) return previous;
            return {
                ...previous,
                [goalId]: { ...row, current: row.current === "" ? text : `${row.current}\n${text}`, updatedAt },
            };
        });
    };
    const updatePlanned = (goalId: string, index: number, patch: Partial<GoalCheckIn["planned"][number]>) => {
        const updatedAt = new Date().toISOString();
        setDrafts(previous => {
            const row = previous[goalId];
            if (!row) return previous;
            return {
                ...previous,
                [goalId]: {
                    ...row,
                    planned: row.planned.map((item, currentIndex) => currentIndex === index ? { ...item, ...patch } : item),
                    updatedAt,
                },
            };
        });
    };
    const addPlanned = (goalId: string) => {
        const updatedAt = new Date().toISOString();
        setDrafts(previous => {
            const row = previous[goalId];
            if (!row) return previous;
            return { ...previous, [goalId]: { ...row, planned: [...row.planned, { text: "", dueDate: null }], updatedAt } };
        });
    };
    const removePlanned = (goalId: string, index: number) => {
        const updatedAt = new Date().toISOString();
        setDrafts(previous => {
            const row = previous[goalId];
            if (!row) return previous;
            return { ...previous, [goalId]: { ...row, planned: row.planned.filter((_, currentIndex) => currentIndex !== index), updatedAt } };
        });
    };
    const toggleMinimized = (goalId: string) => {
        setMinimizedGoalIds(previous => {
            const next = new Set(previous);
            if (next.has(goalId)) next.delete(goalId);
            else next.add(goalId);
            return next;
        });
    };

    const reloadCurrent = () => {
        const next = periodAt(goalGrid(tracker), currentDateKey());
        if (!next) {
            setReloadMessage("This tracker has no open period yet, so the pinned period stays selected.");
            return;
        }
        if (next.periodStart === activePeriod.periodStart) {
            setReloadMessage("The wizard is already pinned to the current period.");
            return;
        }
        setReloadMessage(null);
        setActivePeriod(next);
    };

    const submit = async () => {
        if (saving) return;
        setSaving(true);
        setError(null);
        try {
            await goals.saveCheckIns(mergeDrafts(Object.values(state.checkIns), Object.values(drafts)));
            onClose();
        } catch (failure) {
            setError(failureMessage(failure));
        } finally {
            setSaving(false);
        }
    };

    return <form aria-label="Check-in wizard" className="space-y-3 rounded border border-neutral-800 bg-neutral-950/40 p-4" onSubmit={event => {
        event.preventDefault();
        void submit();
    }}>
        <header className="flex flex-wrap items-center gap-3">
            <div>
                <h2 className="text-sm font-semibold">Check in · {periodLabel(activePeriod)}</h2>
                <p className="text-neutral-400">{periodRangeLabel(activePeriod)}</p>
            </div>
            <label className="grid gap-1">Period
                <select className={control} aria-label="Check-in period" value={activePeriod.periodStart} onChange={event => {
                    const chosen = periods.find(row => row.periodStart === event.target.value);
                    if (chosen) { setReloadMessage(null); setActivePeriod(chosen); }
                }}>
                    {periods.map(row => <option key={row.periodStart} value={row.periodStart}>
                        {periodLabel(row)} · {periodRangeLabel(row)}
                    </option>)}
                </select>
            </label>
            <button type="button" className={`${button} ml-auto`} aria-label="Close check-in wizard" onClick={onClose}>Close</button>
        </header>
        {staleWarning && <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
            <span>This period was already built elsewhere. You can keep editing it or reload the current period.</span>
            <button type="button" className={button} onClick={() => setDismissedStamp(lastBuilt)}>Continue editing</button>
            <button type="button" className={button} onClick={reloadCurrent}>Reload current period</button>
        </div>}
        {reloadMessage && <p role="status" className="text-neutral-400">{reloadMessage}</p>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
        {activeGoals.length === 0
            ? <p className="text-neutral-400">No active goals to check in. Add or reactivate a goal first.</p>
            : <div className="space-y-3">
                {activeGoals.map(goal => {
                    const draft = drafts[goal.id];
                    if (!draft) return null;
                    const slips = slipSummary(goal.id, Object.values(state.checkIns), activePeriod.periodStart);
                    const priorRows = storedHistory.filter(row => row.goalId === goal.id && row.periodStart < activePeriod.periodStart);
                    const previous = priorRows.length > 0 ? priorRows[priorRows.length - 1] : null;
                    const unmet = previous ? unmetPlannedItems(previous, draft) : [];
                    const minimized = minimizedGoalIds.has(goal.id);
                    const bodyId = `check-in-goal-${goal.id}`;
                    return <article key={goal.id} aria-label={goal.title} className="space-y-2 rounded border border-neutral-800 bg-neutral-900/30 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="flex-1 font-medium">{goal.title}</h3>
                            {minimized && <CheckInStatusBadge statusPill={draft.statusPill} />}
                            <GoalSlipBadge consecutiveSlips={slips.consecutiveSlips} />
                            <button
                                type="button"
                                className={button}
                                aria-label={`${minimized ? "Expand" : "Minimize"} ${goal.title}`}
                                aria-expanded={!minimized}
                                aria-controls={bodyId}
                                onClick={() => toggleMinimized(goal.id)}
                            >
                                {minimized ? "Expand" : "Minimize"}
                            </button>
                        </div>
                        {minimized && <p className="truncate text-xs text-neutral-500">{minimizedSummary(draft)}</p>}
                        <div id={bodyId} hidden={minimized} className="space-y-2">
                            <div className="flex flex-wrap items-end gap-3">
                                <label className="grid gap-1">Status
                                    <select className={control} aria-label={`Status for ${goal.title}`} value={draft.statusPill} onChange={event => patchDraft(goal.id, { statusPill: event.target.value as GoalCheckIn["statusPill"] })}>
                                        {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                    </select>
                                </label>
                                <span className="mb-2"><CheckInStatusBadge statusPill={draft.statusPill} /></span>
                                <label className="flex items-center gap-2"><input type="checkbox" aria-label={`Focus for ${goal.title}`} checked={draft.isFocus} onChange={event => patchDraft(goal.id, { isFocus: event.target.checked })} />Focus</label>
                            </div>
                            <label className="grid gap-1">Did
                                <textarea className={control} aria-label={`Did for ${goal.title}`} value={draft.did} onChange={event => patchDraft(goal.id, { did: event.target.value })} />
                            </label>
                            {goal.projectId !== null && <GoalEvidencePanel
                                key={`${goal.id}:${activePeriod.periodStart}`}
                                goal={goal}
                                checkIn={draft}
                                period={activePeriod}
                                onChange={patch => patchDraft(goal.id, patch)}
                            />}
                            <HabitMetricStrip
                                goal={goal}
                                period={activePeriod}
                                current={draft.current}
                                today={today}
                                onInsert={text => insertCurrent(goal.id, text)}
                            />
                            <section className="rounded-md border border-neutral-800/70 bg-neutral-950/20 p-3">
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Did not do</h4>
                                {!previous
                                    ? <p className="mt-1 text-xs text-neutral-500">No previous plans to compare.</p>
                                    : unmet.length === 0
                                        ? <p className="mt-1 text-xs text-neutral-500">Everything from the previous check-in is marked done.</p>
                                        : <ul className="mt-1 space-y-1 text-sm text-neutral-300">
                                            {unmet.map((item, index) => <li key={`${item.text}-${index}`} className="flex flex-wrap items-baseline gap-2">
                                                <span>{item.text}</span>
                                                {item.dueDate && <span className="text-xs text-neutral-500">Due <time dateTime={item.dueDate}>{item.dueDate}</time></span>}
                                            </li>)}
                                        </ul>}
                                <label className="mt-2 grid gap-1">
                                    <span className="text-xs font-medium text-neutral-400">Why not</span>
                                    <textarea className={control} rows={2} aria-label={`Miss reason for ${goal.title}`} placeholder="Add a note about why this was not done." value={draft.missReason} onChange={event => patchDraft(goal.id, { missReason: event.target.value })} />
                                    <span className="text-xs text-neutral-500">Optional notes explaining the items above.</span>
                                </label>
                            </section>
                            <label className="grid gap-1">Currently working on
                                <textarea className={control} aria-label={`Current for ${goal.title}`} value={draft.current} onChange={event => patchDraft(goal.id, { current: event.target.value })} />
                            </label>
                            <fieldset className="space-y-2">
                                <legend>Planned next</legend>
                                {draft.planned.map((item, index) => <div key={index} className="flex flex-wrap items-end gap-2">
                                    <label className="grid flex-1 gap-1">Plan
                                        <input className={control} aria-label={`Planned item ${index + 1} for ${goal.title}`} value={item.text} onChange={event => updatePlanned(goal.id, index, { text: event.target.value })} />
                                    </label>
                                    <label className="grid gap-1">Due date
                                        <input className={control} type="date" aria-label={`Planned due date ${index + 1} for ${goal.title}`} value={item.dueDate ?? ""} onChange={event => updatePlanned(goal.id, index, { dueDate: isGoalDateKey(event.target.value) ? event.target.value : null })} />
                                    </label>
                                    <button type="button" className={button} aria-label={`Remove planned item ${index + 1} for ${goal.title}`} onClick={() => removePlanned(goal.id, index)}>Remove</button>
                                </div>)}
                                <button type="button" className={button} aria-label={`Add planned item for ${goal.title}`} onClick={() => addPlanned(goal.id)}>Add planned item</button>
                            </fieldset>
                        </div>
                    </article>;
                })}
            </div>}
        <div className="flex gap-2">
            {activeGoals.length > 0 && <button type="submit" className={primary} disabled={saving}>{saving ? "Saving…" : "Save check-ins"}</button>}
            <button type="button" className={button} onClick={onClose}>Cancel</button>
        </div>
    </form>;
};

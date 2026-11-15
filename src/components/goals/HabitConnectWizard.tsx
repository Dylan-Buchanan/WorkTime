import React, { useEffect, useRef, useState } from "react";
import { HABIT_COLORS } from "../../lib/habits";
import {
    connectableHabitFrequencies,
    habitUnitPlural,
    habitUnitWord,
    maxHabitMetricBuckets,
    minHabitMetricBuckets,
} from "../../lib/goals/habitMetric";
import { downgradeHabitMetric } from "../../lib/goals/metrics";
import { useGoals } from "../../state/GoalContext";
import { useHabits } from "../../state/HabitContext";
import type { Goal, GoalCadence, Habit, HabitFrequency } from "../../state/types";
import { CreateHabitForm, type NewHabitDraft } from "./CreateHabitModal";

export interface HabitConnectWizardProps {
    goal: Goal;
    cadence: GoalCadence;
    /** Habit promoted to the top of step 1 and preselected; may be archived or dangling. */
    linkedHabitId: string | null;
    onClose: () => void;
}

type WizardStep = "habit" | "create" | "target";

const control = "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs";
const button = `${control} hover:bg-neutral-800 disabled:opacity-50`;
const primary = "rounded bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-500 disabled:opacity-50";
const FREQUENCY_LABELS: Record<HabitFrequency, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Unable to save. Please try again.";

/** Listable habits follow the goals rail rule: the linked habit first, then position. */
function listableHabits(habits: Record<string, Habit>, linkedHabitId: string | null): Habit[] {
    const rows = Object.values(habits)
        .filter(habit => !habit.isArchived || habit.id === linkedHabitId)
        .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const linked = linkedHabitId !== null ? rows.find(habit => habit.id === linkedHabitId) : undefined;
    return linked ? [linked, ...rows.filter(habit => habit.id !== linked.id)] : rows;
}

export const HabitConnectWizard: React.FC<HabitConnectWizardProps> = ({ goal, cadence, linkedHabitId, onClose }) => {
    const habits = useHabits();
    const goals = useGoals();
    const [step, setStep] = useState<WizardStep>("habit");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draft, setDraft] = useState<NewHabitDraft | null>(null);
    const [targetText, setTargetText] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [skippedHabitStep, setSkippedHabitStep] = useState(false);
    const [pendingRollbackId, setPendingRollbackId] = useState<string | null>(null);
    const initializedRef = useRef(false);
    const rollingBackRef = useRef(false);
    const deleteHabitRef = useRef(habits.deleteHabit);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        deleteHabitRef.current = habits.deleteHabit;
    }, [habits.deleteHabit]);

    const offered = connectableHabitFrequencies(cadence);
    const listable = listableHabits(habits.state.habits, linkedHabitId);
    const linkedHabit = linkedHabitId !== null ? habits.state.habits[linkedHabitId] : undefined;
    const selectedHabit = selectedId !== null ? habits.state.habits[selectedId] : undefined;
    const storedHabitMetric = goal.metric?.source === "habit" ? goal.metric : null;
    const dangling = habits.hydrated && linkedHabitId !== null && habits.state.habits[linkedHabitId] === undefined;
    const active = goal.lifecycle === "active";
    const targetFrequency = draft?.frequency ?? selectedHabit?.frequency;

    useEffect(() => {
        dialogRef.current?.focus();
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key !== "Tab") return;
            const dialog = dialogRef.current;
            if (!dialog) return;
            const controls = dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)");
            const first = controls[0];
            const last = controls[controls.length - 1];
            const boundary = event.shiftKey ? first : last;
            if (document.activeElement === boundary || !dialog.contains(document.activeElement)) {
                event.preventDefault();
                (event.shiftKey ? last : first)?.focus();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    // Apply the link and skip rules exactly once, when habits finish hydrating.
    useEffect(() => {
        if (!habits.hydrated || initializedRef.current) return;
        initializedRef.current = true;
        const linked = linkedHabitId !== null ? habits.state.habits[linkedHabitId] : undefined;
        if (linked && offered.includes(linked.frequency)) setSelectedId(linked.id);
        if (listable.length === 0 && goal.metric?.source !== "habit" && goal.lifecycle === "active") {
            setSkippedHabitStep(true);
            setStep("create");
        }
    }, [habits.hydrated]);

    // HabitContext.deleteHabit reads the provider state captured at render time, so
    // a habit minted in this click handler is only deletable after it renders here.
    // The macrotask also lets the provider's create save settle, so the empty
    // follow-up state is not mistaken for the already-saved pre-create slice.
    useEffect(() => {
        if (pendingRollbackId === null || !habits.hydrated || rollingBackRef.current) return;
        const created = habits.state.habits[pendingRollbackId];
        if (!created) return;
        rollingBackRef.current = true;
        const id = pendingRollbackId;
        const timer = setTimeout(() => {
            try {
                deleteHabitRef.current(id);
                setError("This goal couldn’t be saved, so the new habit wasn’t kept. Try again.");
            } catch {
                setDraft(null);
                setSelectedId(id);
                setError(`Habit “${created.name}” was created, but this goal could not be saved with it. Link it from /habits.`);
            } finally {
                rollingBackRef.current = false;
                setPendingRollbackId(current => current === id ? null : current);
            }
        }, 0);
        return () => {
            clearTimeout(timer);
            rollingBackRef.current = false;
        };
    }, [pendingRollbackId, habits.state.habits, habits.hydrated]);

    const goalCount = (habitId: string) => Object.values(goals.state.goals)
        .filter(row => row.metric?.source === "habit" && row.metric.habitId === habitId)
        .length;

    const nextFromHabit = () => {
        if (!habits.hydrated || !selectedHabit || !offered.includes(selectedHabit.frequency)) return;
        setDraft(null);
        setError(null);
        setTargetText(String(minHabitMetricBuckets(cadence, selectedHabit.frequency)));
        setStep("target");
    };

    const confirmCreate = (nextDraft: NewHabitDraft) => {
        const frequency = offered.includes(nextDraft.frequency) ? nextDraft.frequency : offered[0] ?? nextDraft.frequency;
        setDraft({ ...nextDraft, frequency });
        setSelectedId(null);
        setError(null);
        setTargetText(String(minHabitMetricBuckets(cadence, frequency)));
        setStep("target");
    };

    const cancelCreate = () => {
        setError(null);
        if (skippedHabitStep) onClose();
        else setStep("habit");
    };

    const disconnect = () => {
        if (!storedHabitMetric) return;
        try {
            goals.updateGoal(goal.id, { metric: downgradeHabitMetric(storedHabitMetric) });
            onClose();
        } catch (failure) {
            setError(errorMessage(failure));
        }
    };

    const renderHabitStep = () => {
        const heading = <h2 className="text-sm font-semibold">Choose a habit</h2>;
        if (!habits.hydrated) {
            return <>
                {heading}
                <p role="status" className="mt-2 text-xs text-neutral-400">Loading habits…</p>
                <div className="mt-4 flex gap-2">
                    <button type="button" className={primary} disabled>Next</button>
                    <button type="button" className={button} onClick={onClose}>Cancel</button>
                </div>
            </>;
        }
        if (!active) {
            return <>
                {heading}
                <p className="mt-2 text-xs text-neutral-400">Reactivate this goal to connect a different habit.</p>
                {storedHabitMetric && <button type="button" className={`${button} mt-3`} onClick={disconnect}>Disconnect habit</button>}
                <div className="mt-4 flex gap-2">
                    <button type="button" className={button} onClick={onClose}>Cancel</button>
                </div>
            </>;
        }
        return <>
            {heading}
            <div role="radiogroup" aria-label="Habits" className="mt-3 space-y-2">
                {listable.map(habit => {
                    const connectable = offered.includes(habit.frequency);
                    const count = goalCount(habit.id);
                    const label = habit.isArchived ? `${habit.name} (archived)` : habit.name;
                    return <button
                        key={habit.id}
                        type="button"
                        role="radio"
                        aria-checked={selectedId === habit.id}
                        aria-label={label}
                        disabled={!connectable}
                        onClick={() => {
                            setSelectedId(habit.id);
                            setDraft(null);
                            setError(null);
                        }}
                        className="block w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-left text-xs hover:bg-neutral-800 disabled:opacity-60"
                    >
                        <span className="block">{habit.name}</span>
                        {count > 0 && <span className="block text-[10px] text-neutral-400">{`Tracks ${count} ${count === 1 ? "goal" : "goals"}`}</span>}
                        {!connectable && <span className="block text-[10px] text-neutral-500">{`${FREQUENCY_LABELS[habit.frequency]} habits don't fit every period of this tracker`}</span>}
                    </button>;
                })}
            </div>
            <button type="button" className={`${button} mt-3`} onClick={() => { setError(null); setStep("create"); }}>Create a new habit</button>
            {goal.metric?.source === "manual" && <p className="mt-2 text-xs text-neutral-400">
                Saving replaces this goal’s manual metric “{goal.metric.label}”.
            </p>}
            {goal.metric?.source === "liftingtracker" && <p className="mt-2 text-xs text-neutral-400">
                Saving replaces this goal’s automatic metric “{goal.metric.label}”.
            </p>}
            {linkedHabit && selectedId !== null && selectedId !== linkedHabit.id && <p className="mt-2 text-xs text-neutral-400">
                Saving replaces the link to “{linkedHabit.name}”.
            </p>}
            {dangling && <p data-goals-slot="connect-missing" className="mt-2 text-xs text-amber-300">
                The habit this goal tracked (“{storedHabitMetric?.label ?? ""}”) no longer exists. Choose a habit to repair the link.
            </p>}
            {storedHabitMetric && <button type="button" className={`${button} mt-3`} onClick={disconnect}>Disconnect habit</button>}
            <div className="mt-4 flex gap-2">
                <button
                    type="button"
                    className={primary}
                    disabled={!selectedHabit || !offered.includes(selectedHabit.frequency)}
                    onClick={nextFromHabit}
                >Next</button>
                <button type="button" className={button} onClick={onClose}>Cancel</button>
            </div>
        </>;
    };

    const renderCreateStep = () => <>
        <h2 className="text-sm font-semibold">New habit</h2>
        <CreateHabitForm
            initial={draft ?? { name: goal.title, color: HABIT_COLORS[0], frequency: offered[0] ?? "daily" }}
            frequencies={offered}
            confirmLabel="Next"
            cancelLabel={skippedHabitStep ? "Cancel" : "Back"}
            onConfirm={confirmCreate}
            onCancel={cancelCreate}
        />
    </>;

    const renderTargetStep = () => {
        if (!targetFrequency) return <p role="alert">Choose a habit first.</p>;
        const min = minHabitMetricBuckets(cadence, targetFrequency);
        const max = maxHabitMetricBuckets(cadence, targetFrequency);
        const raw = targetText.trim();
        const targetValue = raw === "" ? Number.NaN : Number(raw);
        const validTarget = Number.isInteger(targetValue) && targetValue >= 1 && targetValue <= max;
        const habitName = draft?.name ?? selectedHabit?.name ?? "";
        const displayTarget = Number.isFinite(targetValue) ? targetValue : targetText;
        const unitWord = habitUnitWord(Number.isFinite(targetValue) ? targetValue : 0, targetFrequency);
        const rangeText = min === max
            ? `Every period holds exactly ${min} ${habitUnitWord(min, targetFrequency)}.`
            : `Every period holds at least ${min} ${habitUnitWord(min, targetFrequency)}; the longest holds ${max}.`;

        const decrease = () => {
            const current = validTarget ? targetValue : min;
            setTargetText(String(Math.max(1, current - 1)));
        };
        const increase = () => {
            const current = validTarget ? targetValue : min;
            setTargetText(String(Math.min(max, current + 1)));
        };
        const save = () => {
            if (!habits.hydrated || goal.lifecycle !== "active" || !validTarget) return;
            let created: Habit | null = null;
            try {
                if (draft) created = habits.createHabit({ name: draft.name, color: draft.color, frequency: draft.frequency });
                const habit = created ?? selectedHabit;
                if (!habit) return;
                goals.updateGoal(goal.id, {
                    metric: {
                        label: habit.name,
                        current: 0,
                        target: targetValue,
                        unit: habitUnitPlural(targetFrequency),
                        source: "habit",
                        habitId: habit.id,
                        overridePinned: false,
                    },
                });
                onClose();
            } catch (failure) {
                if (created) setPendingRollbackId(created.id);
                else setError(errorMessage(failure));
            }
        };

        return <>
            <h2 className="text-sm font-semibold">Set the target</h2>
            <p data-goals-slot="connect-sentence" className="mt-3 text-sm">
                Track <strong>{habitName}</strong> against {displayTarget} {unitWord} per period
            </p>
            <div className="mt-3 flex items-center gap-2">
                <button
                    type="button"
                    className={button}
                    aria-label="Decrease target"
                    disabled={validTarget && targetValue <= 1}
                    onClick={decrease}
                >−</button>
                <input
                    type="number"
                    className={`${control} w-24`}
                    aria-label="Target"
                    min={1}
                    max={max}
                    step={1}
                    value={targetText}
                    onChange={event => setTargetText(event.target.value)}
                />
                <button
                    type="button"
                    className={button}
                    aria-label="Increase target"
                    disabled={validTarget && targetValue >= max}
                    onClick={increase}
                >+</button>
            </div>
            {!validTarget && <p role="alert" className="mt-2 text-[11px] text-red-300">Choose a whole number from 1 to {max}.</p>}
            <p className="mt-2 text-xs text-neutral-500">{rangeText}</p>
            <div className="mt-4 flex gap-2">
                <button type="button" className={button} onClick={() => { setError(null); setStep(draft ? "create" : "habit"); }}>Back</button>
                <button type="button" className={primary} disabled={!validTarget} onClick={save}>Save</button>
            </div>
        </>;
    };

    return <div
        ref={dialogRef}
        className="fixed inset-0 z-50 outline-none"
        role="dialog"
        aria-modal="true"
        aria-label="Connect a habit"
        tabIndex={-1}
    >
        <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
        <div className="absolute inset-x-0 top-24 mx-auto w-[28rem] max-w-[calc(100vw-2rem)] rounded border border-neutral-800 bg-neutral-950 p-4 shadow-2xl">
            {step === "habit" ? renderHabitStep() : step === "create" ? renderCreateStep() : renderTargetStep()}
            {error && <p role="alert" className="mt-2 text-[11px] text-red-300">{error}</p>}
        </div>
    </div>;
};

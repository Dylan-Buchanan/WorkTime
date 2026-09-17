import React, { useState } from "react";
import type { NewPetScheduleItemInput } from "../../lib/pets";
import type { PetActivityType, PetFlexibility } from "../../state/types";
import { PET_ACTIVITY_META } from "./petShared";

interface PetScheduleItemFormProps {
    submitLabel: string;
    onAddItem(input: NewPetScheduleItemInput): string | null;
}

const ACTIVITY_OPTIONS = Object.entries(PET_ACTIVITY_META) as Array<[PetActivityType, { icon: string; label: string }]>;

type Mode = "fixed-time" | "interval";

const blankDraft = () => ({
    label: "",
    activityType: "potty" as PetActivityType,
    flexibility: "flexible" as PetFlexibility,
    mode: "fixed-time" as Mode,
    time: "08:00",
    windowMinutes: "0",
    minMinutes: "90",
    maxMinutes: "120",
});

/**
 * Minimal schedule-item creation form shared by the first-run onboarding and
 * the deck's add flow. Validation and record creation stay in the parent so
 * every item funnels through the same factory + persistence path.
 */
export const PetScheduleItemForm: React.FC<PetScheduleItemFormProps> = ({ submitLabel, onAddItem }) => {
    const [draft, setDraft] = useState(blankDraft);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState(false);

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => { setOpen(true); setError(null); }}
                className="rounded-xl bg-neutral-800 px-3 py-1.5 text-[11px] text-neutral-200 hover:bg-neutral-700"
            >
                + Add schedule item
            </button>
        );
    }

    const submit = () => {
        const input: NewPetScheduleItemInput = draft.mode === "fixed-time"
            ? {
                activityType: draft.activityType,
                label: draft.label,
                flexibility: draft.flexibility,
                recurrence: {
                    mode: "fixed-time",
                    time: draft.time,
                    windowMinutes: Math.max(0, Math.trunc(Number(draft.windowMinutes) || 0)),
                },
            }
            : {
                activityType: draft.activityType,
                label: draft.label,
                flexibility: draft.flexibility,
                recurrence: {
                    mode: "interval",
                    minMinutes: Math.trunc(Number(draft.minMinutes) || 0),
                    maxMinutes: Math.trunc(Number(draft.maxMinutes) || 0),
                },
            };
        const result = onAddItem(input);
        if (result) {
            setError(result);
            return;
        }
        setError(null);
        setDraft(blankDraft);
        setOpen(false);
    };

    return (
        <form
            onSubmit={(event) => { event.preventDefault(); submit(); }}
            className="flex flex-col gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3"
        >
            <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                    Label
                    <input
                        value={draft.label}
                        placeholder="e.g. Afternoon potty"
                        onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                    />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                    Activity
                    <select
                        value={draft.activityType}
                        onChange={(event) => setDraft({ ...draft, activityType: event.target.value as PetActivityType })}
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                    >
                        {ACTIVITY_OPTIONS.map(([value, meta]) => (
                            <option key={value} value={value}>{meta.label}</option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                    Flexibility
                    <select
                        value={draft.flexibility}
                        onChange={(event) => setDraft({ ...draft, flexibility: event.target.value as PetFlexibility })}
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                    >
                        <option value="fixed">Fixed — never moves</option>
                        <option value="flexible">Flexible — may reflow</option>
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                    Recurrence
                    <select
                        value={draft.mode}
                        onChange={(event) => setDraft({ ...draft, mode: event.target.value as Mode })}
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                    >
                        <option value="fixed-time">Fixed time</option>
                        <option value="interval">Interval</option>
                    </select>
                </label>
            </div>
            {draft.mode === "fixed-time" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        Time
                        <input
                            type="time"
                            value={draft.time}
                            onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        Window minutes
                        <input
                            inputMode="numeric"
                            value={draft.windowMinutes}
                            onChange={(event) => setDraft({ ...draft, windowMinutes: event.target.value })}
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                        />
                    </label>
                </div>
            ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        Every min (minutes)
                        <input
                            inputMode="numeric"
                            value={draft.minMinutes}
                            onChange={(event) => setDraft({ ...draft, minMinutes: event.target.value })}
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        Every max (minutes)
                        <input
                            inputMode="numeric"
                            value={draft.maxMinutes}
                            onChange={(event) => setDraft({ ...draft, maxMinutes: event.target.value })}
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                        />
                    </label>
                </div>
            )}
            {error && <p role="alert" className="text-[11px] text-red-300">{error}</p>}
            <div className="flex gap-2">
                <button
                    type="submit"
                    className="rounded-lg bg-neutral-100 px-3 py-1.5 text-[11px] font-medium text-neutral-900 hover:bg-white"
                >
                    {submitLabel}
                </button>
                <button
                    type="button"
                    onClick={() => { setOpen(false); setError(null); }}
                    className="rounded-lg bg-neutral-800 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-700"
                >
                    Cancel
                </button>
            </div>
        </form>
    );
};

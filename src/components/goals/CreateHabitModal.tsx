import React, { useEffect, useRef, useState } from "react";
import { HABIT_COLORS } from "../../lib/habits";
import type { HabitFrequency } from "../../state/types";

export type NewHabitDraft = {
    name: string;
    color: string;
    frequency: HabitFrequency;
};

const FREQUENCIES: ReadonlyArray<{ value: HabitFrequency; label: string }> = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
];

const control = "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs";
const primary = "rounded bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-500";
const button = `${control} hover:bg-neutral-800`;

/**
 * The shared name/color/frequency body. Both the modal and the connect wizard
 * host it so validation, focus, and Enter handling stay identical.
 */
export function CreateHabitForm({
    initial,
    frequencies = FREQUENCIES.map(option => option.value),
    confirmLabel = "Create habit",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
}: {
    initial: NewHabitDraft;
    /** Offered frequencies in display order; defaults to daily, weekly, monthly. */
    frequencies?: readonly HabitFrequency[];
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: (draft: NewHabitDraft) => void;
    onCancel: () => void;
}): React.ReactElement {
    const offered = FREQUENCIES.filter(option => frequencies.includes(option.value));
    const startingFrequency = offered.some(option => option.value === initial.frequency)
        ? initial.frequency
        : offered[0]?.value ?? initial.frequency;
    const [name, setName] = useState(initial.name);
    const [color, setColor] = useState(initial.color);
    const [frequency, setFrequency] = useState<HabitFrequency>(startingFrequency);
    const [error, setError] = useState<string | null>(null);
    const nameRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        nameRef.current?.focus();
    }, []);

    const confirm = () => {
        const trimmed = name.trim();
        if (!trimmed) {
            setError("Give this habit a name first.");
            return;
        }
        onConfirm({ name: trimmed, color, frequency });
    };

    return <>
        <div className="mt-3 space-y-3">
            <label className="grid gap-1">Habit name<input
                ref={nameRef}
                className={control}
                value={name}
                onChange={event => setName(event.target.value)}
                onKeyDown={event => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        confirm();
                    }
                }}
            /></label>
            <div className="space-y-2">
                <span className="block text-[10px] text-neutral-400">Color</span>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Habit color">
                    {HABIT_COLORS.map(swatch => <button
                        key={swatch}
                        type="button"
                        role="radio"
                        aria-checked={color === swatch}
                        aria-label={`Choose ${swatch}`}
                        onClick={() => setColor(swatch)}
                        className={`h-6 w-6 rounded-full border-2 ${color === swatch ? "border-neutral-50" : "border-transparent"}`}
                        style={{ backgroundColor: swatch }}
                    />)}
                </div>
            </div>
            <label className="grid gap-1">Frequency<select className={control} value={frequency} onChange={event => setFrequency(event.target.value as HabitFrequency)}>
                {offered.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label>
        </div>
        {error && <p role="alert" className="mt-2 text-[11px] text-red-300">{error}</p>}
        <div className="mt-4 flex gap-2">
            <button className={primary} type="button" onClick={confirm}>{confirmLabel}</button>
            <button className={button} type="button" onClick={onCancel}>{cancelLabel}</button>
        </div>
    </>;
}

/**
 * The goal editor's habit creator. It collects only the properties the metric
 * fieldset does not already own: name, color, and frequency. The goal title
 * seeds the name so the common case is one keystroke from confirmation.
 */
export function CreateHabitModal({ initial, replacing, onConfirm, onCancel }: {
    initial: NewHabitDraft;
    /** Name of the habit link this will replace, or null when none. */
    replacing: string | null;
    onConfirm: (draft: NewHabitDraft) => void;
    onCancel: () => void;
}): React.ReactElement {
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
            }
            const dialog = dialogRef.current;
            if (event.key !== "Tab" || !dialog) return;
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
    }, [onCancel]);

    return <div ref={dialogRef} className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Create habit">
        <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onCancel} />
        <div className="absolute inset-x-0 top-24 mx-auto w-96 max-w-[calc(100vw-2rem)] rounded border border-neutral-800 bg-neutral-950 p-4 shadow-2xl">
            <h3 className="font-medium">Create habit</h3>
            {replacing !== null && <p className="mt-1 text-xs text-neutral-400">
                Saving will replace this goal’s “{replacing}” habit link.
            </p>}
            <CreateHabitForm initial={initial} onConfirm={onConfirm} onCancel={onCancel} />
        </div>
    </div>;
}

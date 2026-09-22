import React from "react";
import type { PetTrainingSkill } from "../../state/types";

interface PetTrainingTagDialogProps {
    skills: readonly PetTrainingSkill[];
    value: string[];
    onChange: (next: string[]) => void;
    onSave(): void;
    onSkip(): void;
}

/**
 * Modal prompt shown right after a one-tap training log. Skills are rendered
 * as visible, directly clickable chips (no dropdown) so the choices are never
 * clipped or hidden, and the centered card makes the prompt unmistakable.
 */
export const PetTrainingTagDialog: React.FC<PetTrainingTagDialogProps> = ({
    skills,
    value,
    onChange,
    onSave,
    onSkip,
}) => {
    const toggle = (id: string): void => {
        onChange(value.includes(id) ? value.filter((selected) => selected !== id) : [...value, id]);
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Tag training session"
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
        >
            <div className="app-scrollbar flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-900 p-4 shadow-2xl">
                <h2 className="text-sm font-semibold text-neutral-100">Tag training session</h2>
                <p className="mt-1 text-[11px] text-neutral-400">Which skills did you practice?</p>
                {skills.length === 0 ? (
                    <p className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 text-[11px] text-neutral-500">
                        No training skills yet. Add some on the Training tab, then tag this session.
                    </p>
                ) : (
                    <div className="app-scrollbar mt-3 flex max-h-60 flex-wrap gap-2 overflow-y-auto">
                        {skills.map((skill) => {
                            const selected = value.includes(skill.id);
                            return (
                                <label
                                    key={skill.id}
                                    data-selected={selected}
                                    className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
                                        selected
                                            ? "border-neutral-400 bg-neutral-700 text-neutral-100"
                                            : "border-neutral-700 bg-neutral-800/60 text-neutral-300 hover:bg-neutral-800"
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selected}
                                        onChange={() => toggle(skill.id)}
                                        className="h-3.5 w-3.5 accent-neutral-100"
                                    />
                                    <span>{skill.label}</span>
                                </label>
                            );
                        })}
                    </div>
                )}
                <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onSkip}
                        className="rounded-lg bg-neutral-800 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-700"
                    >
                        Skip
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        className="rounded-lg bg-neutral-100 px-3 py-1.5 text-[11px] font-medium text-neutral-900 hover:bg-white"
                    >
                        Save tags
                    </button>
                </div>
            </div>
        </div>
    );
};

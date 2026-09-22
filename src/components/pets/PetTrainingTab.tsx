import React, { useState } from "react";
import {
    advancePetTrainingSkill,
    createPetTrainingSkill,
    isPetTrainingSkillResolved,
    nextPetTrainingStatus,
    PET_TRAINING_STATUSES,
    petTrainingStatusLabel,
    previousPetTrainingStatus,
    reopenPetTrainingSkill,
    resolvePetTrainingSkill,
    reversePetTrainingSkill,
} from "../../lib/pets";
import type { PetTrainingSkill, PetTrainingStatus } from "../../state/types";
import { usePets } from "../../state/PetContext";

interface StatusStyle {
    /** Card shell tint so the whole card reads at a glance. */
    card: string;
    /** Status pill tone. */
    pill: string;
    /** Filled segment tone for the progress meter. */
    segment: string;
    /** Non-color cue so status never depends on hue alone. */
    icon: string;
}

const STATUS_STYLES: Record<PetTrainingStatus, StatusStyle> = {
    introduced: {
        card: "border-neutral-700 bg-neutral-900/60",
        pill: "bg-neutral-800 text-neutral-200",
        segment: "bg-neutral-300",
        icon: "○",
    },
    progressing: {
        card: "border-amber-700/60 bg-amber-950/30",
        pill: "bg-amber-900/50 text-amber-100",
        segment: "bg-amber-400",
        icon: "◐",
    },
    reliable: {
        card: "border-emerald-700/60 bg-emerald-950/30",
        pill: "bg-emerald-900/50 text-emerald-100",
        segment: "bg-emerald-400",
        icon: "✓",
    },
};

const STATUS_INDEX: Record<PetTrainingStatus, number> = {
    introduced: 0,
    progressing: 1,
    reliable: 2,
};

type StepDirection = "forward" | "back";

const TrainingProgressMeter: React.FC<{ skill: PetTrainingSkill }> = ({ skill }) => {
    const index = STATUS_INDEX[skill.status];
    return (
        <div className="flex items-center gap-1.5">
            <div
                role="progressbar"
                aria-label={`${skill.label} training progress`}
                aria-valuemin={1}
                aria-valuemax={PET_TRAINING_STATUSES.length}
                aria-valuenow={index + 1}
                aria-valuetext={petTrainingStatusLabel(skill.status)}
                className="flex items-center gap-1"
            >
                {PET_TRAINING_STATUSES.map((status, position) => (
                    <span
                        key={status}
                        className={`h-1.5 w-7 rounded-full ${
                            position <= index ? STATUS_STYLES[skill.status].segment : "bg-neutral-700/70"
                        }`}
                    />
                ))}
            </div>
            <span className="text-[10px] tabular-nums text-neutral-400">
                {index + 1}/{PET_TRAINING_STATUSES.length}
            </span>
        </div>
    );
};

function messageFor(error: unknown, fallback: string): string {
    return error instanceof RangeError ? error.message : fallback;
}

function formatResolvedAt(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

interface EditDraft {
    label: string;
    notes: string;
}

/**
 * The Training tab: the short list of skills Whitney is actively learning with
 * an `introduced → progressing → reliable` progression, plus a collapsed
 * archive of resolved skills. All transitions run through the pure pet lib;
 * this component only persists the resulting full set.
 */
export const PetTrainingTab: React.FC = () => {
    const pets = usePets();
    const skills = Object.values(pets.state.trainingSkills);
    const [draft, setDraft] = useState<EditDraft>({ label: "", notes: "" });
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<EditDraft>({ label: "", notes: "" });
    const [error, setError] = useState<string | null>(null);
    const [archiveOpen, setArchiveOpen] = useState(false);
    const [flash, setFlash] = useState<{ id: string; direction: StepDirection } | null>(null);

    const persist = (next: PetTrainingSkill[]): void => {
        pets.setTrainingSkills(next);
    };

    const addSkill = (event: React.FormEvent): void => {
        event.preventDefault();
        try {
            const skill = createPetTrainingSkill(draft, pets.now(), pets.uuid());
            persist([...skills, skill]);
            setDraft({ label: "", notes: "" });
            setError(null);
        } catch (caught) {
            setError(messageFor(caught, "Could not add the skill"));
        }
    };

    const advance = (id: string): void => {
        const skill = skills.find((entry) => entry.id === id);
        if (!skill) return;
        try {
            const updated = advancePetTrainingSkill(skill, pets.now());
            persist(skills.map((entry) => (entry.id === id ? updated : entry)));
            setFlash({ id, direction: "forward" });
            setError(null);
        } catch (caught) {
            setError(messageFor(caught, "Could not advance the skill"));
        }
    };

    const resolve = (id: string): void => {
        const skill = skills.find((entry) => entry.id === id);
        if (!skill) return;
        try {
            const updated = resolvePetTrainingSkill(skill, pets.now());
            persist(skills.map((entry) => (entry.id === id ? updated : entry)));
            setError(null);
        } catch (caught) {
            setError(messageFor(caught, "Could not resolve the skill"));
        }
    };

    const reverse = (id: string): void => {
        const skill = skills.find((entry) => entry.id === id);
        if (!skill) return;
        try {
            const updated = reversePetTrainingSkill(skill, pets.now());
            persist(skills.map((entry) => (entry.id === id ? updated : entry)));
            setFlash({ id, direction: "back" });
            setError(null);
        } catch (caught) {
            setError(messageFor(caught, "Could not step the skill back"));
        }
    };

    const reopen = (id: string): void => {
        const skill = skills.find((entry) => entry.id === id);
        if (!skill) return;
        try {
            const updated = reopenPetTrainingSkill(skill, pets.now());
            persist(skills.map((entry) => (entry.id === id ? updated : entry)));
            setError(null);
        } catch (caught) {
            setError(messageFor(caught, "Could not reopen the skill"));
        }
    };

    const startEdit = (skill: PetTrainingSkill): void => {
        setEditingId(skill.id);
        setEditDraft({ label: skill.label, notes: skill.notes });
        setError(null);
    };

    const saveEdit = (): void => {
        if (!editingId) return;
        const label = editDraft.label.trim();
        if (!label) {
            setError("A training skill needs a label");
            return;
        }
        const updatedAt = pets.now().toISOString();
        persist(
            skills.map((entry) =>
                entry.id === editingId ? { ...entry, label, notes: editDraft.notes, updatedAt } : entry,
            ),
        );
        setEditingId(null);
        setError(null);
    };

    if (!pets.hydrated) {
        return (
            <div className="flex h-full items-center justify-center text-xs text-neutral-500" role="status">
                Loading…
            </div>
        );
    }

    const active = skills.filter((skill) => !isPetTrainingSkillResolved(skill));
    const archived = skills.filter(isPetTrainingSkillResolved);

    return (
        <div className="app-scrollbar h-full overflow-y-auto px-4 py-4 sm:px-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                <section className="flex flex-col gap-3">
                    <div>
                        <h2 className="text-sm font-semibold text-neutral-100">Training</h2>
                        <p className="text-[11px] text-neutral-500">What Whitney is learning right now.</p>
                    </div>

                    <form
                        onSubmit={addSkill}
                        className="flex flex-col gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3"
                    >
                        <div className="grid gap-2 sm:grid-cols-2">
                            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                Skill
                                <input
                                    value={draft.label}
                                    placeholder="e.g. Sit"
                                    onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                                />
                            </label>
                            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                Notes
                                <input
                                    value={draft.notes}
                                    placeholder="optional"
                                    onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                                />
                            </label>
                        </div>
                        <button
                            type="submit"
                            className="self-start rounded-lg bg-neutral-100 px-3 py-1.5 text-[11px] font-medium text-neutral-900 hover:bg-white"
                        >
                            Add skill
                        </button>
                    </form>

                    {error && <p role="alert" className="text-[11px] text-red-300">{error}</p>}

                    {active.length > 0 ? (
                        <ul className="flex flex-col gap-2">
                            {active.map((skill) => (
                                <li
                                    key={skill.id}
                                    data-status={skill.status}
                                    onAnimationEnd={() =>
                                        setFlash((current) => (current?.id === skill.id ? null : current))
                                    }
                                    className={`flex flex-col gap-2 rounded-xl border p-3 transition-colors ${
                                        STATUS_STYLES[skill.status].card
                                    } ${
                                        flash?.id === skill.id
                                            ? flash.direction === "forward"
                                                ? "training-step-forward"
                                                : "training-step-back"
                                            : ""
                                    }`}
                                >
                                    {editingId === skill.id ? (
                                        <div className="flex flex-col gap-2">
                                            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                                Edit skill
                                                <input
                                                    aria-label="Edit skill"
                                                    value={editDraft.label}
                                                    onChange={(event) => setEditDraft({ ...editDraft, label: event.target.value })}
                                                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                                Edit notes
                                                <input
                                                    aria-label="Edit notes"
                                                    value={editDraft.notes}
                                                    onChange={(event) => setEditDraft({ ...editDraft, notes: event.target.value })}
                                                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                                                />
                                            </label>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={saveEdit}
                                                    className="rounded-lg bg-neutral-100 px-3 py-1.5 text-[11px] font-medium text-neutral-900 hover:bg-white"
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => { setEditingId(null); setError(null); }}
                                                    className="rounded-lg bg-neutral-800 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-700"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-xs text-neutral-100">{skill.label}</p>
                                                    {skill.notes && (
                                                        <p className="truncate text-[11px] text-neutral-500">{skill.notes}</p>
                                                    )}
                                                </div>
                                                <span
                                                    className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLES[skill.status].pill}`}
                                                >
                                                    <span aria-hidden="true">{STATUS_STYLES[skill.status].icon}</span>
                                                    <span>{petTrainingStatusLabel(skill.status)}</span>
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <TrainingProgressMeter skill={skill} />
                                                <div className="ml-auto flex flex-wrap items-center gap-2">
                                                    {previousPetTrainingStatus(skill.status) !== null && (
                                                        <button
                                                            type="button"
                                                            aria-label={`Step back ${skill.label}`}
                                                            onClick={() => reverse(skill.id)}
                                                            className="shrink-0 rounded-lg bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                                                        >
                                                            Step back
                                                        </button>
                                                    )}
                                                    {nextPetTrainingStatus(skill.status) !== null && (
                                                        <button
                                                            type="button"
                                                            aria-label={`Advance ${skill.label}`}
                                                            onClick={() => advance(skill.id)}
                                                            className="shrink-0 rounded-lg bg-neutral-800 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-700"
                                                        >
                                                            Advance
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        aria-label={`Mark done ${skill.label}`}
                                                        onClick={() => resolve(skill.id)}
                                                        className="shrink-0 rounded-lg bg-neutral-800 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-700"
                                                    >
                                                        Mark done
                                                    </button>
                                                    <button
                                                        type="button"
                                                        aria-label={`Edit ${skill.label}`}
                                                        onClick={() => startEdit(skill)}
                                                        className="shrink-0 rounded-lg bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                                                    >
                                                        Edit
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="px-1 text-[11px] text-neutral-500">No skills in progress yet.</p>
                    )}
                </section>

                {archived.length > 0 && (
                    <section aria-label="Resolved training skills" className="flex flex-col gap-2">
                        <button
                            type="button"
                            aria-expanded={archiveOpen}
                            onClick={() => setArchiveOpen((value) => !value)}
                            className="self-start rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                        >
                            {archiveOpen ? "Hide" : "Show"} resolved skills ({archived.length})
                        </button>
                        {archiveOpen && (
                            <ul className="flex flex-col gap-2">
                                {archived.map((skill) => (
                                    <li
                                        key={skill.id}
                                        className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800/60 bg-neutral-900/20 p-3"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-xs text-neutral-300">{skill.label}</p>
                                            {skill.notes && (
                                                <p className="truncate text-[11px] text-neutral-500">{skill.notes}</p>
                                            )}
                                        </div>
                                        <span className="shrink-0 text-[11px] text-neutral-500">
                                            {skill.resolvedAt ? `done ${formatResolvedAt(skill.resolvedAt)}` : "done"}
                                        </span>
                                        <button
                                            type="button"
                                            aria-label={`Reopen ${skill.label}`}
                                            onClick={() => reopen(skill.id)}
                                            className="shrink-0 rounded-lg bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                                        >
                                            Reopen
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                )}
            </div>
        </div>
    );
};

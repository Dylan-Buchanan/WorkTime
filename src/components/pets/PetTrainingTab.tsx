import React, { useEffect, useState } from "react";
import {
    advancePetTrainingSkill,
    createPetTrainingSkill,
    isPetTrainingSkillResolved,
    nextPetTrainingStatus,
    petTrainingStatusLabel,
    resolvePetTrainingSkill,
} from "../../lib/pets";
import type { PetTrainingSkill, PetTrainingStatus } from "../../state/types";
import { useData } from "../../state/DataContext";
import { petUuid } from "./petShared";

const STATUS_TONES: Record<PetTrainingStatus, string> = {
    introduced: "bg-neutral-800 text-neutral-300",
    progressing: "bg-amber-900/40 text-amber-300",
    reliable: "bg-emerald-900/40 text-emerald-300",
};

function persistenceError(context: string): (error: unknown) => void {
    return (error) => console.warn(`[PetPage] failed to persist ${context}`, error);
}

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
    const data = useData();
    const [skills, setSkills] = useState<PetTrainingSkill[]>([]);
    const [hydrated, setHydrated] = useState(false);
    const [draft, setDraft] = useState<EditDraft>({ label: "", notes: "" });
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<EditDraft>({ label: "", notes: "" });
    const [error, setError] = useState<string | null>(null);
    const [archiveOpen, setArchiveOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const loaded = await data.loadPetTrainingSkills().catch(() => [] as PetTrainingSkill[]);
            if (cancelled) return;
            setSkills(loaded);
            setHydrated(true);
        })();
        return () => { cancelled = true; };
    }, [data]);

    const persist = (next: PetTrainingSkill[]): void => {
        setSkills(next);
        void data.savePetTrainingSkills(next).catch(persistenceError("pet training skills"));
    };

    const addSkill = (event: React.FormEvent): void => {
        event.preventDefault();
        try {
            const skill = createPetTrainingSkill(draft, new Date(), petUuid());
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
            const updated = advancePetTrainingSkill(skill, new Date());
            persist(skills.map((entry) => (entry.id === id ? updated : entry)));
            setError(null);
        } catch (caught) {
            setError(messageFor(caught, "Could not advance the skill"));
        }
    };

    const resolve = (id: string): void => {
        const skill = skills.find((entry) => entry.id === id);
        if (!skill) return;
        try {
            const updated = resolvePetTrainingSkill(skill, new Date());
            persist(skills.map((entry) => (entry.id === id ? updated : entry)));
            setError(null);
        } catch (caught) {
            setError(messageFor(caught, "Could not resolve the skill"));
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
        const updatedAt = new Date().toISOString();
        persist(
            skills.map((entry) =>
                entry.id === editingId ? { ...entry, label, notes: editDraft.notes, updatedAt } : entry,
            ),
        );
        setEditingId(null);
        setError(null);
    };

    if (!hydrated) {
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
                                    className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3"
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
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-xs text-neutral-100">{skill.label}</p>
                                                {skill.notes && (
                                                    <p className="truncate text-[11px] text-neutral-500">{skill.notes}</p>
                                                )}
                                            </div>
                                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${STATUS_TONES[skill.status]}`}>
                                                {petTrainingStatusLabel(skill.status)}
                                            </span>
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

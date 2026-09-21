import React, { useState } from "react";
import { createPetFixation, isPetFixationActive, resolvePetFixation } from "../../lib/pets";
import type { PetFixation } from "../../state/types";
import { usePets } from "../../state/PetContext";

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
 * The Fixations tab: the short list of current obsessions/behavior problems
 * with an active → resolved lifecycle. Resolving captures a freeform reason and
 * moves the fixation into a collapsed archive; resolved fixations are never
 * deleted.
 */
export const PetFixationTab: React.FC = () => {
    const pets = usePets();
    const fixations = Object.values(pets.state.fixations);
    const [draft, setDraft] = useState<EditDraft>({ label: "", notes: "" });
    const [reasons, setReasons] = useState<Record<string, string>>({});
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<EditDraft>({ label: "", notes: "" });
    const [error, setError] = useState<string | null>(null);
    const [archiveOpen, setArchiveOpen] = useState(false);

    const persist = (next: PetFixation[]): void => {
        pets.setFixations(next);
    };

    const addFixation = (event: React.FormEvent): void => {
        event.preventDefault();
        try {
            const fixation = createPetFixation(draft, pets.now(), pets.uuid());
            persist([...fixations, fixation]);
            setDraft({ label: "", notes: "" });
            setError(null);
        } catch (caught) {
            setError(messageFor(caught, "Could not add the fixation"));
        }
    };

    const resolve = (id: string): void => {
        const fixation = fixations.find((entry) => entry.id === id);
        if (!fixation) return;
        try {
            const updated = resolvePetFixation(fixation, reasons[id] ?? "", pets.now());
            persist(fixations.map((entry) => (entry.id === id ? updated : entry)));
            setReasons((previous) => {
                const next = { ...previous };
                delete next[id];
                return next;
            });
            setError(null);
        } catch (caught) {
            setError(messageFor(caught, "Could not resolve the fixation"));
        }
    };

    const startEdit = (fixation: PetFixation): void => {
        setEditingId(fixation.id);
        setEditDraft({ label: fixation.label, notes: fixation.notes });
        setError(null);
    };

    const saveEdit = (): void => {
        if (!editingId) return;
        const label = editDraft.label.trim();
        if (!label) {
            setError("A fixation needs a label");
            return;
        }
        const updatedAt = pets.now().toISOString();
        persist(
            fixations.map((entry) =>
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

    const active = fixations.filter(isPetFixationActive);
    const archived = fixations.filter((fixation) => !isPetFixationActive(fixation));

    return (
        <div className="app-scrollbar h-full overflow-y-auto px-4 py-4 sm:px-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                <section className="flex flex-col gap-3">
                    <div>
                        <h2 className="text-sm font-semibold text-neutral-100">Fixations</h2>
                        <p className="text-[11px] text-neutral-500">Current obsessions and behavior problems.</p>
                    </div>

                    <form
                        onSubmit={addFixation}
                        className="flex flex-col gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3"
                    >
                        <div className="grid gap-2 sm:grid-cols-2">
                            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                Fixation
                                <input
                                    value={draft.label}
                                    placeholder="e.g. Chasing the vacuum"
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
                            Add fixation
                        </button>
                    </form>

                    {error && <p role="alert" className="text-[11px] text-red-300">{error}</p>}

                    {active.length > 0 ? (
                        <ul className="flex flex-col gap-2">
                            {active.map((fixation) => (
                                <li
                                    key={fixation.id}
                                    className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3"
                                >
                                    {editingId === fixation.id ? (
                                        <div className="flex flex-col gap-2">
                                            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                                Edit fixation
                                                <input
                                                    aria-label="Edit fixation"
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
                                                <p className="truncate text-xs text-neutral-100">{fixation.label}</p>
                                                {fixation.notes && (
                                                    <p className="truncate text-[11px] text-neutral-500">{fixation.notes}</p>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                aria-label={`Edit ${fixation.label}`}
                                                onClick={() => startEdit(fixation)}
                                                className="shrink-0 rounded-lg bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                                            >
                                                Edit
                                            </button>
                                        </div>
                                    )}
                                    {editingId !== fixation.id && (
                                        <div className="flex flex-wrap items-end gap-2">
                                            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] text-neutral-400">
                                                How did it go?
                                                <input
                                                    aria-label={`Reason for ${fixation.label}`}
                                                    value={reasons[fixation.id] ?? ""}
                                                    placeholder="e.g. grew out of it"
                                                    onChange={(event) =>
                                                        setReasons((previous) => ({ ...previous, [fixation.id]: event.target.value }))
                                                    }
                                                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                                                />
                                            </label>
                                            <button
                                                type="button"
                                                aria-label={`Resolve ${fixation.label}`}
                                                onClick={() => resolve(fixation.id)}
                                                className="shrink-0 rounded-lg bg-neutral-100 px-3 py-1.5 text-[11px] font-medium text-neutral-900 hover:bg-white"
                                            >
                                                Resolve
                                            </button>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="px-1 text-[11px] text-neutral-500">No active fixations right now. 🎉</p>
                    )}
                </section>

                {archived.length > 0 && (
                    <section aria-label="Resolved fixations" className="flex flex-col gap-2">
                        <button
                            type="button"
                            aria-expanded={archiveOpen}
                            onClick={() => setArchiveOpen((value) => !value)}
                            className="self-start rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                        >
                            {archiveOpen ? "Hide" : "Show"} resolved fixations ({archived.length})
                        </button>
                        {archiveOpen && (
                            <ul className="flex flex-col gap-2">
                                {archived.map((fixation) => (
                                    <li
                                        key={fixation.id}
                                        className="flex flex-col gap-1 rounded-xl border border-neutral-800/60 bg-neutral-900/20 p-3"
                                    >
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="min-w-0 flex-1 truncate text-xs text-neutral-300">{fixation.label}</p>
                                            <span className="shrink-0 text-[11px] text-neutral-500">
                                                {fixation.resolvedAt ? `resolved ${formatResolvedAt(fixation.resolvedAt)}` : "resolved"}
                                            </span>
                                        </div>
                                        {fixation.resolutionNote && (
                                            <p className="text-[11px] text-neutral-400">“{fixation.resolutionNote}”</p>
                                        )}
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

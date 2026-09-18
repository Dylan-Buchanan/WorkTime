import React, { useEffect, useState } from "react";
import {
    annotateNotableEvent,
    correctNotableEvent,
    createPetNotableEvent,
    filterNotableEvents,
    notableEventDateKey,
    notableEventTimestamp,
    sortNotableEventsNewestFirst,
} from "../../lib/pets";
import type { PetNotableEvent, PetProfile } from "../../state/types";
import { useData } from "../../state/DataContext";
import { petUuid } from "./petShared";

function persistenceError(context: string): (error: unknown) => void {
    return (error) => console.warn(`[PetPage] failed to persist ${context}`, error);
}

function messageFor(error: unknown, fallback: string): string {
    return error instanceof RangeError ? error.message : fallback;
}

function formatEventDate(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
        ? ""
        : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

interface EventDraft {
    title: string;
    notes: string;
    date: string;
}

function emptyDraft(): EventDraft {
    return { title: "", notes: "", date: notableEventDateKey(new Date()) };
}

/**
 * The Timeline tab: manually recorded notable moments ("first reliable sit",
 * "met the neighbor's dog"), each shown with the pet's age at the event time.
 * Records are append-plus-correct — events are added and edited, never
 * deleted. Mechanical activity records (potty, naps, weight, training status)
 * live in their own tabs and are deliberately absent here.
 */
export const PetTimelineTab: React.FC = () => {
    const data = useData();
    const [events, setEvents] = useState<PetNotableEvent[]>([]);
    const [profile, setProfile] = useState<PetProfile | null>(null);
    const [hydrated, setHydrated] = useState(false);
    const [draft, setDraft] = useState<EventDraft>(emptyDraft);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<EventDraft>(emptyDraft);
    const [range, setRange] = useState({ from: "", to: "" });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [loadedEvents, loadedProfile] = await Promise.all([
                data.loadPetNotableEvents().catch(() => [] as PetNotableEvent[]),
                data.loadPetProfile().catch(() => null),
            ]);
            if (cancelled) return;
            setEvents(loadedEvents);
            setProfile(loadedProfile);
            setHydrated(true);
        })();
        return () => { cancelled = true; };
    }, [data]);

    const persist = (next: PetNotableEvent[]): void => {
        setEvents(next);
        void data.savePetNotableEvents(next).catch(persistenceError("pet notable events"));
    };

    const addEvent = (event: React.FormEvent): void => {
        event.preventDefault();
        try {
            const created = createPetNotableEvent(
                { title: draft.title, notes: draft.notes, timestamp: notableEventTimestamp(draft.date) },
                new Date(),
                petUuid(),
            );
            persist([...events, created]);
            setDraft(emptyDraft());
            setError(null);
        } catch (caught) {
            setError(messageFor(caught, "Could not add the event"));
        }
    };

    const startEdit = (notableEvent: PetNotableEvent): void => {
        setEditingId(notableEvent.id);
        setEditDraft({
            title: notableEvent.title,
            notes: notableEvent.notes,
            date: notableEventDateKey(notableEvent.timestamp),
        });
        setError(null);
    };

    const saveEdit = (): void => {
        if (!editingId) return;
        const existing = events.find((entry) => entry.id === editingId);
        if (!existing) return;
        try {
            const corrected = correctNotableEvent(
                existing,
                { title: editDraft.title, notes: editDraft.notes, timestamp: notableEventTimestamp(editDraft.date) },
                new Date(),
            );
            persist(events.map((entry) => (entry.id === editingId ? corrected : entry)));
            setEditingId(null);
            setError(null);
        } catch (caught) {
            setError(messageFor(caught, "Could not save the event"));
        }
    };

    if (!hydrated) {
        return (
            <div className="flex h-full items-center justify-center text-xs text-neutral-500" role="status">
                Loading…
            </div>
        );
    }

    const visible = sortNotableEventsNewestFirst(
        filterNotableEvents(events, {
            from: range.from === "" ? null : range.from,
            to: range.to === "" ? null : range.to,
        }),
    );

    return (
        <div className="app-scrollbar h-full overflow-y-auto px-4 py-4 sm:px-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                <section className="flex flex-col gap-3">
                    <div>
                        <h2 className="text-sm font-semibold text-neutral-100">Timeline</h2>
                        <p className="text-[11px] text-neutral-500">
                            Notable moments only — potty, naps, weight, and training stay in their own tabs.
                        </p>
                    </div>

                    {profile ? (
                        <>
                            <form
                                onSubmit={addEvent}
                                className="flex flex-col gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3"
                            >
                                <div className="grid gap-2 sm:grid-cols-3">
                                    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                        Event
                                        <input
                                            value={draft.title}
                                            placeholder="e.g. First reliable sit"
                                            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
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
                                    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                        Date
                                        <input
                                            type="date"
                                            aria-label="Event date"
                                            value={draft.date}
                                            onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                                        />
                                    </label>
                                </div>
                                <button
                                    type="submit"
                                    className="self-start rounded-lg bg-neutral-100 px-3 py-1.5 text-[11px] font-medium text-neutral-900 hover:bg-white"
                                >
                                    Add event
                                </button>
                            </form>

                            {error && <p role="alert" className="text-[11px] text-red-300">{error}</p>}

                            <div className="flex flex-wrap items-end gap-2">
                                <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                    From
                                    <input
                                        type="date"
                                        aria-label="Filter from"
                                        value={range.from}
                                        onChange={(event) => setRange({ ...range, from: event.target.value })}
                                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                                    />
                                </label>
                                <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                    To
                                    <input
                                        type="date"
                                        aria-label="Filter to"
                                        value={range.to}
                                        onChange={(event) => setRange({ ...range, to: event.target.value })}
                                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                                    />
                                </label>
                                {(range.from !== "" || range.to !== "") && (
                                    <button
                                        type="button"
                                        onClick={() => setRange({ from: "", to: "" })}
                                        className="rounded-lg bg-neutral-800 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-700"
                                    >
                                        Clear dates
                                    </button>
                                )}
                            </div>

                            {visible.length > 0 ? (
                                <ul className="flex flex-col gap-2">
                                    {visible.map((notableEvent) => (
                                        <li
                                            key={notableEvent.id}
                                            className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3"
                                        >
                                            {editingId === notableEvent.id ? (
                                                <div className="flex flex-col gap-2">
                                                    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                                        Edit event
                                                        <input
                                                            aria-label="Edit event"
                                                            value={editDraft.title}
                                                            onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })}
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
                                                    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                                        Edit date
                                                        <input
                                                            type="date"
                                                            aria-label="Edit date"
                                                            value={editDraft.date}
                                                            onChange={(event) => setEditDraft({ ...editDraft, date: event.target.value })}
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
                                                <div className="flex flex-wrap items-start gap-2">
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs text-neutral-100">
                                                            {annotateNotableEvent(notableEvent, profile.birthDate)}
                                                        </p>
                                                        <p className="text-[11px] text-neutral-500">
                                                            {formatEventDate(notableEvent.timestamp)}
                                                            {notableEvent.notes ? ` · ${notableEvent.notes}` : ""}
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        aria-label={`Edit ${notableEvent.title}`}
                                                        onClick={() => startEdit(notableEvent)}
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
                                <p className="px-1 text-[11px] text-neutral-500">
                                    {events.length > 0 ? "No events match this date range." : "No notable events yet."}
                                </p>
                            )}
                        </>
                    ) : (
                        <p className="px-1 text-[11px] text-neutral-500">
                            Add your pet's name and birth date on the Today tab first — every entry is stamped with
                            the age at the event.
                        </p>
                    )}
                </section>
            </div>
        </div>
    );
};

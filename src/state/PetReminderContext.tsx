import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildPetSchedule } from "../lib/pets";
import type { PetScheduleEntry } from "../lib/pets";
import type { PetNapRecord, PetReminderMark, PetScheduleItem } from "./types";
import { notifyNow } from "./AppStateContext";
import { useData } from "./DataContext";
import { usePetActivity } from "./PetActivityContext";
import { useSync } from "./SyncContext";
import { useToast } from "./ToastContext";

interface ReminderSnapshot {
    scheduleItems: PetScheduleItem[];
    naps: PetNapRecord[];
    marks: Record<string, PetReminderMark>;
}

const EMPTY_SNAPSHOT: ReminderSnapshot = { scheduleItems: [], naps: [], marks: {} };

/** Item id plus resolved start re-arms after corrections, new anchors, or reflow. */
export function petOccurrenceId(entry: Pick<PetScheduleEntry, "itemId" | "start">): string {
    return `${entry.itemId}:${entry.start.toISOString()}`;
}

/**
 * App-open-only pet scheduler. It deliberately notifies even while the window
 * is focused; timer notifications retain their separate visibility guard.
 * Initial due/overdue state is baselined so reopening never creates catch-up
 * alerts for crossings that happened while the app was closed.
 */
export const PetReminderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const data = useData();
    const { revision } = useSync();
    const { state: activityState, hydrated: activityHydrated } = usePetActivity();
    const { showToast } = useToast();
    const [snapshot, setSnapshot] = useState<ReminderSnapshot>(EMPTY_SNAPSHOT);
    const [hydrated, setHydrated] = useState(false);
    const [now, setNow] = useState(() => new Date());
    const marksRef = useRef<Record<string, PetReminderMark>>({});
    const previousDueRef = useRef<Set<string> | null>(null);
    const previousOverdueRef = useRef<Set<string> | null>(null);
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void Promise.all([
            data.loadPetScheduleItems(),
            data.loadPetNapRecords(),
            data.loadPetReminderMarks(),
        ]).then(([scheduleItems, naps, loadedMarks]) => {
            if (cancelled) return;
            const marks = { ...marksRef.current };
            for (const mark of loadedMarks) marks[mark.id] = mark;
            marksRef.current = marks;
            setSnapshot({ scheduleItems, naps, marks });
            setHydrated(true);
        }).catch((error) => {
            if (cancelled) return;
            console.warn("[PetReminder] failed to load scheduler state", error);
            setHydrated(true);
        });
        return () => { cancelled = true; };
    }, [data, revision]);

    const schedule = useMemo(() => buildPetSchedule({
        now,
        scheduleItems: snapshot.scheduleItems,
        activityRecords: Object.values(activityState.records),
        naps: snapshot.naps,
    }), [activityState.records, now, snapshot.naps, snapshot.scheduleItems]);

    useEffect(() => {
        if (!hydrated || !activityHydrated) return;

        const dueEntries = schedule.entries.filter((entry) =>
            !entry.fulfilled && !entry.paused && entry.start.getTime() <= now.getTime(),
        );
        const overdueEntries = schedule.entries.filter((entry) =>
            !entry.fulfilled && !entry.paused && entry.overdueMinutes > 0,
        );
        const dueIds = new Set(dueEntries.map(petOccurrenceId));
        const overdueIds = new Set(overdueEntries.map(petOccurrenceId));

        if (previousDueRef.current === null || previousOverdueRef.current === null) {
            previousDueRef.current = dueIds;
            previousOverdueRef.current = overdueIds;
            return;
        }

        const previousDue = previousDueRef.current;
        const newlyOverdue = overdueEntries.filter((entry) => !previousOverdueRef.current!.has(petOccurrenceId(entry)));
        previousDueRef.current = dueIds;
        previousOverdueRef.current = overdueIds;

        for (const entry of newlyOverdue) {
            showToast(`${entry.label} is overdue`, { tone: "warning" });
        }

        const newDueEntries = dueEntries.filter((entry) => {
            const id = petOccurrenceId(entry);
            return !previousDue.has(id) && !marksRef.current[id] && !snapshot.marks[id];
        });
        if (newDueEntries.length === 0) return;

        const remindedAt = now.toISOString();
        const nextMarks = { ...marksRef.current };
        for (const entry of newDueEntries) {
            const id = petOccurrenceId(entry);
            nextMarks[id] = { id, itemId: entry.itemId, dueAt: entry.start.toISOString(), remindedAt };
        }
        marksRef.current = nextMarks;
        setSnapshot((current) => ({ ...current, marks: { ...current.marks, ...nextMarks } }));

        // A reminder attempt is deduped even when permission is unavailable;
        // otherwise a denied permission would retry on every one-second tick.
        void Promise.all(newDueEntries.map((entry) => notifyNow({
            title: `Pet care: ${entry.label}`,
            body: `${entry.label} is due now`,
        }))).finally(() => {
            saveQueueRef.current = saveQueueRef.current.then(async () => {
                await data.savePetReminderMarks(Object.values(marksRef.current));
            }).catch((error) => {
                console.warn("[PetReminder] failed to persist reminder marks", error);
            });
        });
    }, [activityHydrated, data, hydrated, now, schedule.entries, showToast, snapshot.marks]);

    return <>{children}</>;
};

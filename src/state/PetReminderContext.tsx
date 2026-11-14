import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildPetSchedule, formatClock } from "../lib/pets";
import type { PetScheduleEntry } from "../lib/pets";
import type { PetReminderMark } from "./types";
import { DEFAULT_END_OF_DAY, DEFAULT_START_OF_DAY } from "../lib/settings";
import { notifyNow, useAppState } from "./AppStateContext";
import { useData } from "./DataContext";
import { useCalendarBusy } from "./CalendarBusyContext";
import { usePetActivity } from "./PetActivityContext";
import { usePets } from "./PetContext";
import { useSync } from "./SyncContext";
import { useToast } from "./ToastContext";

interface ReminderSnapshot {
    marks: Record<string, PetReminderMark>;
}

const EMPTY_SNAPSHOT: ReminderSnapshot = { marks: {} };

interface PendingReminder {
    id: string;
    itemId: string;
    label: string;
    start: Date;
    dueAt: string;
    run: { start: Date; end: Date };
    dayEnd: Date;
    target: number;
}

/** Item id plus the pre-reflow occurrence start, so nap, post-wake and busy reflow never re-arm the reminder. */
export function petOccurrenceId(entry: Pick<PetScheduleEntry, "itemId" | "occurrenceStart">): string {
    return `${entry.itemId}:${entry.occurrenceStart.toISOString()}`;
}

/**
 * App-open-only pet scheduler. It deliberately notifies even while the window
 * is focused; timer notifications retain their separate visibility guard.
 * Initial due/overdue state is baselined so reopening never creates catch-up
 * alerts for crossings that happened while the app was closed.
 */
export const PetReminderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const data = useData();
    const app = useAppState();
    const settingsKey = `${app.state?.settings.start_of_day ?? DEFAULT_START_OF_DAY}:${app.state?.settings.end_of_day ?? DEFAULT_END_OF_DAY}`;
    const previousSettingsKeyRef = useRef<string | null>(null);
    const pets = usePets();
    const { snapshot: busySnapshot } = useCalendarBusy();
    const { revision } = useSync();
    const { state: activityState, hydrated: activityHydrated } = usePetActivity();
    const { showToast } = useToast();
    const [snapshot, setSnapshot] = useState<ReminderSnapshot>(EMPTY_SNAPSHOT);
    const [hydrated, setHydrated] = useState(false);
    const [now, setNow] = useState(() => new Date());
    const marksRef = useRef<Record<string, PetReminderMark>>({});
    const previousDueRef = useRef<Set<string> | null>(null);
    const previousOverdueRef = useRef<Set<string> | null>(null);
    const pendingRef = useRef<Map<string, PendingReminder>>(new Map());
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void data.loadPetReminderMarks().then((loadedMarks) => {
            if (cancelled) return;
            const marks = { ...marksRef.current };
            for (const mark of loadedMarks) marks[mark.id] = mark;
            marksRef.current = marks;
            setSnapshot({ marks });
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
        scheduleItems: Object.values(pets.state.scheduleItems),
        activityRecords: Object.values(activityState.records),
        naps: Object.values(pets.state.naps),
        startOfDay: app.state?.settings.start_of_day,
        endOfDay: app.state?.settings.end_of_day,
        busyIntervals: busySnapshot.intervals,
    }), [activityState.records, app.state?.settings.start_of_day, app.state?.settings.end_of_day, busySnapshot.intervals, now, pets.state.naps, pets.state.scheduleItems]);

    useEffect(() => {
        if (!hydrated || !pets.hydrated || !activityHydrated) return;

        const dueEntries = schedule.entries.filter((entry) =>
            !entry.fulfilled && !entry.paused && entry.start.getTime() <= now.getTime(),
        );
        const overdueEntries = schedule.entries.filter((entry) =>
            !entry.fulfilled && !entry.paused && entry.overdueMinutes > 0,
        );
        const dueIds = new Set(dueEntries.map(petOccurrenceId));
        const overdueIds = new Set(overdueEntries.map(petOccurrenceId));
        if (previousSettingsKeyRef.current !== settingsKey) {
            pendingRef.current.clear();
            previousSettingsKeyRef.current = settingsKey;
            previousDueRef.current = dueIds;
            previousOverdueRef.current = overdueIds;
            return;
        }

        if (previousDueRef.current === null || previousOverdueRef.current === null) {
            previousDueRef.current = dueIds;
            previousOverdueRef.current = overdueIds;
            return;
        }

        const previousDue = previousDueRef.current;
        const newlyOverdue = overdueEntries.filter((entry) => !previousOverdueRef.current!.has(petOccurrenceId(entry)));
        previousDueRef.current = dueIds;
        previousOverdueRef.current = overdueIds;

        const nowMs = now.getTime();
        const pending = pendingRef.current;
        const entriesById = new Map(schedule.entries.map((entry) => [petOccurrenceId(entry), entry]));
        for (const [id, record] of pending) {
            const entry = entriesById.get(id);
            if (marksRef.current[id] || snapshot.marks[id]) {
                pending.delete(id);
            } else if (!entry) {
                // The engine excludes all entries at day end; retain that final nudge.
                if (nowMs < record.dayEnd.getTime()) pending.delete(id);
            } else if (entry.fulfilled || entry.paused) {
                pending.delete(id);
            } else {
                record.label = entry.label;
                record.start = entry.start;
                if (entry.blockedBy !== null) {
                    record.run = { start: entry.blockedBy.start, end: entry.blockedBy.end };
                    record.dayEnd = schedule.dayEnd;
                    record.target = Math.min(entry.blockedBy.end.getTime(), schedule.dayEnd.getTime());
                } else if (entry.start.getTime() <= nowMs) {
                    record.target = nowMs;
                } else {
                    pending.delete(id);
                }
            }
        }

        const held = (entry: PetScheduleEntry) => entry.blockedBy !== null
            && nowMs < Math.min(entry.blockedBy.end.getTime(), schedule.dayEnd.getTime());
        const defer = (entry: PetScheduleEntry) => {
            const id = petOccurrenceId(entry);
            if (marksRef.current[id] || snapshot.marks[id] || pending.has(id) || entry.blockedBy === null) return;
            pending.set(id, {
                id, itemId: entry.itemId, label: entry.label, start: entry.start,
                dueAt: entry.occurrenceStart.toISOString(),
                run: { start: entry.blockedBy.start, end: entry.blockedBy.end },
                dayEnd: schedule.dayEnd,
                target: Math.min(entry.blockedBy.end.getTime(), schedule.dayEnd.getTime()),
            });
        };

        for (const entry of newlyOverdue) {
            if (held(entry)) defer(entry);
            else showToast(`${entry.label} is overdue`, { tone: "warning" });
        }

        const newDueEntries = dueEntries.filter((entry) => {
            const id = petOccurrenceId(entry);
            if (previousDue.has(id) || marksRef.current[id] || snapshot.marks[id] || pending.has(id)) return false;
            if (held(entry)) {
                defer(entry);
                return false;
            }
            return true;
        });
        const fired = [...pending.values()].filter((record) => record.target <= nowMs)
            .sort((left, right) => left.start.getTime() - right.start.getTime() || left.label.localeCompare(right.label));
        if (newDueEntries.length === 0 && fired.length === 0) return;

        const remindedAt = now.toISOString();
        const nextMarks = { ...marksRef.current };
        for (const entry of newDueEntries) {
            const id = petOccurrenceId(entry);
            nextMarks[id] = { id, itemId: entry.itemId, dueAt: entry.occurrenceStart.toISOString(), remindedAt };
        }
        const runs = new Map<string, PendingReminder[]>();
        for (const record of fired) {
            nextMarks[record.id] = { id: record.id, itemId: record.itemId, dueAt: record.dueAt, remindedAt };
            pending.delete(record.id);
            const key = `${record.run.start.toISOString()}:${record.run.end.toISOString()}`;
            const group = runs.get(key) ?? [];
            group.push(record);
            runs.set(key, group);
        }
        marksRef.current = nextMarks;
        setSnapshot((current) => ({ ...current, marks: { ...current.marks, ...nextMarks } }));

        // A reminder attempt is deduped even when permission is unavailable;
        // otherwise a denied permission would retry on every one-second tick.
        const notifications = newDueEntries.map((entry) => notifyNow({
            title: `Pet care: ${entry.label}`,
            body: `${entry.label} is due now`,
        }));
        for (const group of runs.values()) {
            const labels = group.map((record) => record.label);
            const run = group[0].run;
            notifications.push(notifyNow({
                title: `Pet care: ${labels.join(", ")}`,
                body: `Held during busy ${formatClock(run.start)}–${formatClock(run.end)}. ${labels.length === 1 ? `${labels[0]} is` : `${labels.join(", ")} are`} due now.`,
            }));
        }
        void Promise.all(notifications).finally(() => {
            saveQueueRef.current = saveQueueRef.current.then(async () => {
                await data.savePetReminderMarks(Object.values(marksRef.current));
            }).catch((error) => {
                console.warn("[PetReminder] failed to persist reminder marks", error);
            });
        });
    }, [activityHydrated, data, hydrated, now, pets.hydrated, schedule.dayEnd, schedule.entries, settingsKey, showToast, snapshot.marks]);

    return <>{children}</>;
};

import React, { useEffect, useRef } from "react";
import { dueState, goalGrid, periodLabel } from "../../lib/goals/periods";
import type { LocalDateKey } from "../../lib/todos/types";
import { notifyNow } from "../../state/AppStateContext";
import { useGoals } from "../../state/GoalContext";

export interface GoalDueNudgeProps {
    today: LocalDateKey;
}

interface DueTracker {
    key: string;
    trackerName: string;
    label: string;
}

/**
 * Foreground-only deck-due nudge. It deliberately notifies even while the window
 * is focused, mirroring the pet reminder precedent. The first evaluation after
 * hydration baselines the currently due periods, so crossings that happened
 * while the app was closed are never replayed. Dedupe is session-scoped and
 * keyed per tracker per completed period; nothing is persisted.
 */
export const GoalDueNudge: React.FC<GoalDueNudgeProps> = ({ today }) => {
    const { state, hydrated } = useGoals();
    const previousKeysRef = useRef<Set<string> | null>(null);
    const seenKeysRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!hydrated) return;
        const due: DueTracker[] = [];
        for (const tracker of Object.values(state.trackers)) {
            const result = dueState(goalGrid(tracker), today);
            if (result.kind !== "due") continue;
            const period = result.mostRecentCompleted;
            due.push({
                key: `${tracker.id}:${period.periodStart}`,
                trackerName: tracker.name,
                label: periodLabel(period),
            });
        }
        const currentKeys = new Set(due.map(row => row.key));
        if (previousKeysRef.current === null) {
            // Baseline on mount: already-due periods never replay as notifications.
            previousKeysRef.current = currentKeys;
            for (const key of currentKeys) seenKeysRef.current.add(key);
            return;
        }
        const previousKeys = previousKeysRef.current;
        previousKeysRef.current = currentKeys;
        for (const row of due) {
            if (previousKeys.has(row.key) || seenKeysRef.current.has(row.key)) continue;
            seenKeysRef.current.add(row.key);
            void notifyNow({
                title: `Deck due: ${row.trackerName}`,
                body: `${row.label} is ready to build`,
            });
        }
    }, [hydrated, state.trackers, today]);

    return null;
};

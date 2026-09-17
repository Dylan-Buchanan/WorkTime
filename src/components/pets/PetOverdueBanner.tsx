import React from "react";
import type { PetScheduleEntry } from "../../lib/pets";
import { PET_ACTIVITY_META } from "./petShared";

interface PetOverdueBannerProps {
    entries: PetScheduleEntry[];
    onLog(entry: PetScheduleEntry): void;
}

/**
 * Conditional overdue banner pinned under the hero. Multiple overdue items
 * stack, and each line carries its fix action inline. The banner is this
 * page's persistent surface; the moment-of-crossing toast belongs to Issue F.
 */
export const PetOverdueBanner: React.FC<PetOverdueBannerProps> = ({ entries, onLog }) => {
    if (entries.length === 0) return null;
    return (
        <section
            role="alert"
            aria-label="Overdue care items"
            className="flex flex-col gap-2 rounded-2xl border border-red-900/60 bg-red-950/30 p-3"
        >
            {entries.map((entry) => (
                <div key={entry.itemId} className="flex flex-wrap items-center gap-2">
                    <span aria-hidden="true">{PET_ACTIVITY_META[entry.activityType].icon}</span>
                    <span className="text-xs text-red-200">
                        {entry.label} was due {Math.round(entry.overdueMinutes)} min ago
                    </span>
                    <button
                        type="button"
                        onClick={() => onLog(entry)}
                        className="rounded bg-red-800 px-2 py-1 text-[11px] font-medium text-red-50 hover:bg-red-700"
                    >
                        Log {entry.label.toLowerCase()}
                    </button>
                </div>
            ))}
        </section>
    );
};

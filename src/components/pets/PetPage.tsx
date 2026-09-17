import React, { useState } from "react";
import { PetTodayTab } from "./PetTodayTab";

type PetTabId = "today" | "training" | "fixations" | "timeline";

const PET_TABS: Array<{ id: PetTabId; label: string }> = [
    { id: "today", label: "Today" },
    { id: "training", label: "Training" },
    { id: "fixations", label: "Fixations" },
    { id: "timeline", label: "Timeline" },
];

const PLACEHOLDER_COPY: Record<Exclude<PetTabId, "today">, string> = {
    training: "Training skill tracking is coming soon.",
    fixations: "Fixation tracking is coming soon.",
    timeline: "The notable-events timeline is coming soon.",
};

/**
 * The `/pet` page: internal Today | Training | Fixations | Timeline tabs.
 * Today is built here; the other tabs render placeholders until Issues D and
 * E land. The route is named `/pet` (not dog-specific) for a possible future
 * second animal.
 */
export const PetPage: React.FC = () => {
    const [tab, setTab] = useState<PetTabId>("today");

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-800 px-4 py-2 sm:px-6">
                <h1 className="text-xs font-semibold uppercase tracking-wide text-neutral-300">🐶 Pet care</h1>
                <nav role="tablist" aria-label="Pet sections" className="flex flex-wrap items-center gap-1">
                    {PET_TABS.map((entry) => {
                        const active = tab === entry.id;
                        return (
                            <button
                                key={entry.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setTab(entry.id)}
                                className={
                                    active
                                        ? "rounded-lg bg-neutral-800 px-3 py-1.5 text-[11px] font-medium text-neutral-100"
                                        : "rounded-lg px-3 py-1.5 text-[11px] text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
                                }
                            >
                                {entry.label}
                            </button>
                        );
                    })}
                </nav>
            </header>
            <div className="min-h-0 flex-1">
                {tab === "today" ? (
                    <PetTodayTab />
                ) : (
                    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-neutral-500">
                        {PLACEHOLDER_COPY[tab]}
                    </div>
                )}
            </div>
        </div>
    );
};

import React, { useState } from "react";
import { useGoals } from "../../state/GoalContext";
import { usePM } from "../../state/ProjectManagerContext";
import type { GoalCadence } from "../../state/types";
import { localDateKey } from "../../lib/todos/calendar";
import type { LocalDateKey } from "../../lib/todos/types";
import { isGoalDateKey } from "../../lib/goals/factories";
import { initiateBlobDownload } from "../../lib/goals/deck/delivery";
import {
    GoalSetError,
    goalSetFileName,
    materializeGoalSet,
    parseGoalSet,
    serializeGoalSet,
    type GoalSetFile,
} from "../../lib/goals/goalSetFile";

export interface GoalSetActionsProps {
    trackerId: string;
    onImported: (newTrackerId: string) => void;
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const action =
    "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:cursor-not-allowed disabled:opacity-50";
const primary =
    "rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:opacity-50";

const cadenceLabel = (cadence: GoalCadence): string => cadence.kind === "monthly-weekday"
    ? `Monthly on ${weekdays[cadence.weekday]}`
    : `Every ${cadence.intervalWeeks} ${cadence.intervalWeeks === 1 ? "week" : "weeks"} on ${weekdays[cadence.weekday]}`;

const countLabel = (count: number): string => count === 1 ? "1 goal" : `${count} goals`;

const EXPORT_HINT_ID = "goal-set-export-hint";

const projectLinkLabel = (count: number): string => count === 1
    ? "1 project link will be cleared because that project is not on this device."
    : `${count} project links will be cleared because those projects are not on this device.`;

/** Short, code-specific copy so a bad file names its own problem. */
function errorCopy(error: GoalSetError): string {
    switch (error.code) {
        case "invalid-json":
            return "That file is not valid JSON. Choose a goal-set file exported from WorkTime.";
        case "invalid-format":
            return "That file is not a WorkTime goal-set file.";
        case "unsupported-version":
            return "That goal-set file uses a version this app does not support. Export it again from this version of WorkTime.";
        case "invalid-field":
            return `That goal-set file has an invalid field: ${error.message}.`;
        case "empty-goals":
            return "That goal-set file has no goals, so there is nothing to import.";
    }
}

function todayKey(): LocalDateKey {
    const key = localDateKey(new Date());
    if (!isGoalDateKey(key)) throw new RangeError("Invalid goal date");
    return key;
}

/**
 * Review is only rendered once a file parses, so its PM dependency is limited to
 * this subtree. The project lookup decides which imported links survive.
 */
interface ImportReviewProps {
    review: GoalSetFile;
    busy: "export" | "import" | null;
    onConfirm: (knownProjectIds: ReadonlySet<string>) => void;
    onCancel: () => void;
}

const ImportReview: React.FC<ImportReviewProps> = ({ review, busy, onConfirm, onCancel }) => {
    const pm = usePM();
    const knownProjectIds = new Set(Object.keys(pm.state.projects));
    const clearedLinks = review.goals.filter(goal => goal.projectId !== null && !knownProjectIds.has(goal.projectId)).length;

    return <section aria-label="Import review" className="flex flex-col gap-2 rounded border border-neutral-800 bg-neutral-900/40 p-2">
        <h3 className="text-xs font-semibold text-neutral-100">Review import</h3>
        <p className="text-xs text-neutral-300">
            Creates a new tracker <strong className="text-neutral-100">{review.tracker.name}</strong> with {countLabel(review.goals.length)}. Nothing existing is changed.
        </p>
        <p className="text-xs text-neutral-400">{cadenceLabel(review.tracker.cadence)}</p>
        {clearedLinks > 0 && <p className="text-xs text-amber-200">{projectLinkLabel(clearedLinks)}</p>}
        <ul aria-label="Imported goal titles" className="list-disc space-y-0.5 pl-4 text-xs text-neutral-300">
            {review.goals.map((goal, index) => <li key={`${index}:${goal.title}`}>{goal.title}</li>)}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primary} disabled={busy !== null} onClick={() => onConfirm(knownProjectIds)}>
                {busy === "import" ? "Importing…" : "Create tracker"}
            </button>
            <button type="button" className={action} disabled={busy !== null} onClick={onCancel}>
                Cancel
            </button>
        </div>
    </section>;
};

/**
 * Export/import affordance for one tracker. Import is review-first and always
 * creates a new tracker: existing trackers are never replaced, merged, or edited.
 */
export const GoalSetActions: React.FC<GoalSetActionsProps> = ({ trackerId, onImported }) => {
    const { state, createTracker, createGoal, setGoalLifecycle, selectTracker, persist } = useGoals();
    const tracker = state.trackers[trackerId];
    const goals = Object.values(state.goals).filter(goal => goal.trackerId === trackerId);
    const hasGoals = goals.length > 0;
    const [review, setReview] = useState<GoalSetFile | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<"export" | "import" | null>(null);

    async function runExport() {
        if (!tracker || busy !== null || goals.length === 0) return;
        setBusy("export");
        setError(null);
        try {
            const blob = new Blob([serializeGoalSet(tracker, goals)], { type: "application/json" });
            await initiateBlobDownload(blob, goalSetFileName(tracker.name, todayKey()));
        } catch (caught) {
            setError(caught instanceof GoalSetError ? errorCopy(caught) : "Could not export the goal set. Try again.");
        } finally {
            setBusy(null);
        }
    }

    async function readFile(file: File) {
        setReview(null);
        setError(null);
        let text: string;
        try {
            text = await file.text();
        } catch {
            setError("Could not read that file. Choose the goal-set file again.");
            return;
        }
        try {
            setReview(parseGoalSet(text));
        } catch (caught) {
            setError(caught instanceof GoalSetError ? errorCopy(caught) : "Could not read that goal-set file.");
        }
    }

    async function confirmImport(knownProjectIds: ReadonlySet<string>) {
        if (!review || busy !== null) return;
        setBusy("import");
        setError(null);
        try {
            // The provider assigns final IDs; this pass validates and stamps lifecycle.
            const prepared = materializeGoalSet(review, new Date(), () => crypto.randomUUID());
            const created = createTracker({
                name: prepared.tracker.name,
                purpose: prepared.tracker.purpose,
                cadence: prepared.tracker.cadence,
                color: prepared.tracker.color,
            });
            for (const goal of prepared.goals) {
                const row = createGoal({
                    trackerId: created.id,
                    title: goal.title,
                    notes: goal.notes,
                    // A file from another device can name projects that do not exist here.
                    projectId: goal.projectId !== null && knownProjectIds.has(goal.projectId) ? goal.projectId : null,
                    metric: goal.metric,
                    sortOrder: goal.sortOrder,
                });
                if (goal.lifecycle !== "active") setGoalLifecycle(row.id, goal.lifecycle);
            }
            // Report success only after the provider has written the new rows; a
            // failed save leaves the review open so the import can be retried.
            try {
                await persist();
            } catch (caught) {
                setError(caught instanceof Error && caught.message
                    ? `Could not save the imported goal set: ${caught.message}. The review stays open; retry once saving works.`
                    : "Could not save the imported goal set. The review stays open; retry once saving works.");
                return;
            }
            setReview(null);
            onImported(created.id);
            selectTracker(created.id);
        } catch (caught) {
            setError(caught instanceof Error && caught.message
                ? `Could not import the goal set: ${caught.message}`
                : "Could not import the goal set. Try again.");
        } finally {
            setBusy(null);
        }
    }

    return <section
        aria-label="Goal-set export and import"
        className="flex flex-col gap-2 rounded-md border border-neutral-800/70 bg-neutral-950/30 p-3"
    >
        <div className="flex flex-wrap items-center gap-2">
            <button
                type="button"
                className={action}
                disabled={!tracker || busy !== null || !hasGoals}
                aria-describedby={hasGoals ? undefined : EXPORT_HINT_ID}
                onClick={() => { void runExport(); }}
            >
                {busy === "export" ? "Exporting…" : "Export goals"}
            </button>
            <label className={`${action} cursor-pointer`}>
                Import goals
                <input
                    type="file"
                    accept=".json,application/json"
                    aria-label="Import goals"
                    className="sr-only"
                    disabled={busy !== null}
                    onChange={event => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void readFile(file);
                    }}
                />
            </label>
        </div>

        {!hasGoals && <p id={EXPORT_HINT_ID} className="text-xs text-neutral-500">Add a goal before exporting this tracker.</p>}

        {error && <p role="alert" className="rounded border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-200">{error}</p>}

        {review && <ImportReview
            review={review}
            busy={busy}
            onConfirm={knownProjectIds => { void confirmImport(knownProjectIds); }}
            onCancel={() => setReview(null)}
        />}
    </section>;
};

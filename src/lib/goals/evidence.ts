import type { Goal, GoalCheckIn, PMTask, PomodoroLogEntry, Project, Task } from "../../state/types";
import type { LocalDateKey } from "../todos/types";
import { localDateFromKey, localDateKey, localDateParts } from "../todos/calendar";
import { isGoalDateKey } from "./factories";
import type { PeriodBounds } from "./periods";

export interface EvidenceTaskSuggestion {
    readonly pmTaskId: string;
    readonly appTaskId: string | null;
    readonly title: string;
    readonly completedOn: LocalDateKey;
    readonly accepted: boolean;
}
export interface EvidenceInProgressItem {
    readonly pmTaskId: string;
    readonly title: string;
    readonly sortOrder: number;
}
export interface GoalEvidence {
    readonly completedTasks: EvidenceTaskSuggestion[];
    readonly inProgress: EvidenceInProgressItem[];
    readonly completedTaskCount: number;
    readonly hoursMinutes: number;
    readonly brokenProject: boolean;
}
export interface EvidenceWindowInstants {
    readonly start: number; // epoch milliseconds, inclusive
    readonly end: number;   // epoch milliseconds, exclusive
}
export type EvidenceBoundaryConverter = (period: PeriodBounds) => EvidenceWindowInstants;
export interface EvidenceInput {
    readonly goal: Goal;
    readonly checkIn: Pick<GoalCheckIn, "evidenceTaskIds">;
    readonly period: PeriodBounds;
    readonly projects: readonly Project[];
    readonly pmTasks: readonly PMTask[];
    readonly backendTasks: readonly Task[];
    readonly logs: readonly PomodoroLogEntry[];
    readonly boundaryInstants?: EvidenceBoundaryConverter;
    /** Presentation only for selected suggestions; never window filtering. */
    readonly localDateOf?: (iso: string) => LocalDateKey;
}

/** Local calendar midnight for one date key; each boundary is independent, so DST is safe. */
function localMidnightInstant(key: LocalDateKey): number {
    const [year, month, day] = localDateParts(localDateFromKey(key));
    return new Date(year, month, day).getTime();
}

function defaultBoundaryInstants(period: PeriodBounds): EvidenceWindowInstants {
    return {
        start: localMidnightInstant(period.periodStart),
        end: localMidnightInstant(period.periodEnd),
    };
}

function defaultLocalDateOf(iso: string): LocalDateKey {
    const key = localDateKey(new Date(iso));
    if (!isGoalDateKey(key)) throw new RangeError("Invalid goal evidence date");
    return key;
}

function instantOf(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const instant = new Date(iso).getTime();
    return Number.isFinite(instant) ? instant : null;
}

function emptyEvidence(brokenProject: boolean): GoalEvidence {
    return {
        completedTasks: [],
        inProgress: [],
        completedTaskCount: 0,
        hoursMinutes: 0,
        brokenProject,
    };
}

interface SelectedSuggestion extends EvidenceTaskSuggestion {
    readonly instant: number;
}

/**
 * Best-effort read-only evidence join for one goal and period. A missing
 * backend link or a Done task without a backend completion is invisible; the
 * selector never throws for those gaps. Suggestion content is title-only.
 */
export function buildGoalEvidence(input: EvidenceInput): GoalEvidence {
    const { goal, checkIn, period, projects, pmTasks, backendTasks, logs } = input;
    if (goal.projectId === null) return emptyEvidence(false);
    if (!projects.some(project => project.id === goal.projectId)) return emptyEvidence(true);

    const projectTasks = pmTasks.filter(task => task.projectId === goal.projectId);
    const window = (input.boundaryInstants ?? defaultBoundaryInstants)(period);
    const localDateOf = input.localDateOf ?? defaultLocalDateOf;
    const acceptedIds = new Set(checkIn.evidenceTaskIds);
    const backendById = new Map(backendTasks.map(task => [task.id, task]));

    const completed: SelectedSuggestion[] = [];
    for (const pmTask of projectTasks) {
        if (pmTask.status !== "Done" || !pmTask.appTaskId) continue;
        const backend = backendById.get(pmTask.appTaskId);
        if (!backend || !backend.completed_at) continue;
        const instant = instantOf(backend.completed_at);
        if (instant === null || instant < window.start || instant >= window.end) continue;
        completed.push({
            pmTaskId: pmTask.id,
            appTaskId: pmTask.appTaskId,
            title: pmTask.title,
            completedOn: localDateOf(backend.completed_at),
            accepted: acceptedIds.has(pmTask.id),
            instant,
        });
    }
    completed.sort((left, right) =>
        left.instant - right.instant ||
        left.title.localeCompare(right.title) ||
        left.pmTaskId.localeCompare(right.pmTaskId));

    const inProgress = projectTasks
        .filter(task => task.status === "In Progress")
        .sort((left, right) =>
            left.sortOrder - right.sortOrder ||
            left.title.localeCompare(right.title) ||
            left.id.localeCompare(right.id))
        .map(task => ({ pmTaskId: task.id, title: task.title, sortOrder: task.sortOrder }));

    const projectAppTaskIds = new Set(
        projectTasks
            .map(task => task.appTaskId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    let hoursMinutes = 0;
    for (const log of logs) {
        if (log.was_break || !projectAppTaskIds.has(log.task_id)) continue;
        const instant = instantOf(log.finished_at);
        if (instant === null || instant < window.start || instant >= window.end) continue;
        hoursMinutes += log.duration_minutes;
    }

    return {
        completedTasks: completed.map(row => ({
            pmTaskId: row.pmTaskId,
            appTaskId: row.appTaskId,
            title: row.title,
            completedOn: row.completedOn,
            accepted: row.accepted,
        })),
        inProgress,
        completedTaskCount: completed.length,
        hoursMinutes,
        brokenProject: false,
    };
}

/** One decimal place, omitting a trailing `.0` (`14h`, `14.5h`). */
export function formatEvidenceHours(minutes: number): string {
    const hours = Math.round((minutes / 60) * 10) / 10;
    return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/** Prefill prose for the current bucket; titles joined with `", "`. */
export function evidencePrefillText(items: readonly EvidenceInProgressItem[]): string {
    return items.map(item => item.title).join(", ");
}

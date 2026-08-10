import type {
    PMTask,
    PomodoroLogEntry,
    ProjectManagerState,
    Settings,
    TaskPriority,
} from "../../state/types";

const DAYS_90 = 90;
const MINUTES_IN_DAY = 24 * 60;

export interface PlannerContextInput {
    pmState: Pick<ProjectManagerState, "tasks" | "ui">;
    logs: readonly PomodoroLogEntry[];
    settings: Pick<Settings, "work_minutes">;
    now: Date;
    /** A local HH:mm/HH:mm:ss value or an absolute date-time. */
    workUntil: string | Date;
}

export interface PlannerTaskContext {
    id: string;
    title: string;
    projectId: string | null;
    status: PMTask["status"];
    priority: PMTask["priority"];
    dueDate?: string;
    estimatePomos?: number;
    workedPomos?: number;
    description?: string;
    tags: string[];
    checklist: PMTask["checklist"];
    relatedTo: string[];
    /** Archived tasks are context-only and cannot enter the proposed target. */
    isArchived: boolean;
}

export interface AccuracyAggregate {
    /** Actual worked pomodoros divided by estimated pomodoros. */
    meanRatio: number;
    medianRatio: number;
    sampleCount: number;
}

export interface PlannerAccuracyAggregates extends AccuracyAggregate {
    byPriority: Partial<Record<TaskPriority, AccuracyAggregate>>;
    byTag: Record<string, AccuracyAggregate>;
}

export interface PlannerContext {
    /** ISO timestamp supplied by the caller; this function does not read the clock. */
    now: string;
    /** ISO timestamp for the selected work-until time, or null for invalid input. */
    workUntil: string | null;
    /** Number of whole work sessions that fit before workUntil. */
    workBudgetPomos: number;
    selectedProjectIds: string[];
    /** PM task summaries for the selected project(s), including archived context tasks. */
    tasks: PlannerTaskContext[];
    /** Aggregate-only historical accuracy data. No historical task rows are included. */
    accuracy: PlannerAccuracyAggregates;
}

interface AccuracySample {
    task: PMTask;
    ratio: number;
}

function validDate(value: Date): Date | null {
    return Number.isNaN(value.getTime()) ? null : value;
}

function parseWorkUntil(now: Date, workUntil: string | Date): Date | null {
    if (workUntil instanceof Date) return validDate(new Date(workUntil.getTime()));

    const clockMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(workUntil.trim());
    if (clockMatch) {
        const hours = Number(clockMatch[1]);
        const minutes = Number(clockMatch[2]);
        const seconds = Number(clockMatch[3] ?? 0);
        if (hours > 23 || minutes > 59 || seconds > 59) return null;
        const result = new Date(now.getTime());
        result.setHours(hours, minutes, seconds, 0);
        return result;
    }

    return validDate(new Date(workUntil));
}

function calculateWorkBudget(now: Date, workUntil: Date | null, workMinutes: number): number {
    if (!workUntil || !Number.isFinite(workMinutes) || workMinutes <= 0) return 0;
    const minutesAvailable = (workUntil.getTime() - now.getTime()) / 60000;
    return Math.max(0, Math.floor(minutesAvailable / workMinutes));
}

export function calculatePomodoroBudget(
    now: Date,
    workUntil: string | Date,
    workMinutes: number,
): number {
    const validNow = validDate(new Date(now.getTime()));
    if (!validNow) return 0;
    return calculateWorkBudget(validNow, parseWorkUntil(validNow, workUntil), workMinutes);
}

function aggregate(samples: readonly AccuracySample[]): AccuracyAggregate {
    const ratios = samples.map((sample) => sample.ratio).sort((a, b) => a - b);
    if (ratios.length === 0) {
        return { meanRatio: 0, medianRatio: 0, sampleCount: 0 };
    }

    const meanRatio = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
    const middle = Math.floor(ratios.length / 2);
    const medianRatio = ratios.length % 2 === 0
        ? (ratios[middle - 1] + ratios[middle]) / 2
        : ratios[middle];
    return { meanRatio, medianRatio, sampleCount: ratios.length };
}

function isRecentWork(
    task: PMTask,
    logs: readonly PomodoroLogEntry[],
    windowStart: number,
    windowEnd: number,
): boolean {
    const taskIds = new Set([task.id, task.appTaskId].filter((id): id is string => Boolean(id)));
    const hasRecentLog = logs.some((log) => {
        if (log.was_break || !taskIds.has(log.task_id)) return false;
        const finishedAt = new Date(log.finished_at).getTime();
        return Number.isFinite(finishedAt) && finishedAt >= windowStart && finishedAt <= windowEnd;
    });
    if (hasRecentLog) return true;

    if (!task.lastWorkedAt) return false;
    const lastWorkedAt = new Date(task.lastWorkedAt).getTime();
    return Number.isFinite(lastWorkedAt) && lastWorkedAt >= windowStart && lastWorkedAt <= windowEnd;
}

function buildAccuracy(
    tasks: readonly PMTask[],
    logs: readonly PomodoroLogEntry[],
    now: Date,
): PlannerAccuracyAggregates {
    const windowEnd = now.getTime();
    const windowStart = windowEnd - DAYS_90 * MINUTES_IN_DAY * 60000;
    const samples: AccuracySample[] = [];

    for (const task of tasks) {
        const estimate = task.estimatePomos;
        const worked = task.workedPomos;
        if (
            !Number.isFinite(estimate) ||
            !Number.isFinite(worked) ||
            (estimate as number) <= 0 ||
            (worked as number) <= 0 ||
            !isRecentWork(task, logs, windowStart, windowEnd)
        ) {
            continue;
        }
        samples.push({ task, ratio: (worked as number) / (estimate as number) });
    }

    const byPriority: Partial<Record<TaskPriority, AccuracyAggregate>> = {};
    const byTag: Record<string, AccuracyAggregate> = {};
    for (const priority of ["Low", "Medium", "High"] as const) {
        const group = samples.filter((sample) => sample.task.priority === priority);
        if (group.length > 0) byPriority[priority] = aggregate(group);
    }
    const tags = new Set(samples.flatMap((sample) => sample.task.tags));
    for (const tag of tags) {
        const group = samples.filter((sample) => sample.task.tags.includes(tag));
        byTag[tag] = aggregate(group);
    }

    return { ...aggregate(samples), byPriority, byTag };
}

function toPlannerTask(task: PMTask): PlannerTaskContext {
    return {
        id: task.id,
        title: task.title,
        projectId: task.projectId,
        status: task.status,
        priority: task.priority,
        ...(task.dueDate !== undefined ? { dueDate: task.dueDate } : {}),
        ...(Number.isFinite(task.estimatePomos) ? { estimatePomos: task.estimatePomos } : {}),
        ...(Number.isFinite(task.workedPomos) ? { workedPomos: task.workedPomos } : {}),
        ...(task.description !== undefined ? { description: task.description } : {}),
        tags: [...task.tags],
        checklist: task.checklist.map((item) => ({ ...item })),
        relatedTo: [...task.relatedTo],
        isArchived: task.isArchived,
    };
}

/**
 * Build the model-safe input shared by the agentic planning workflows.
 *
 * The caller supplies `now` so the result is deterministic. The task list
 * includes current and archived tasks in the selected project(s), while
 * historical accuracy is represented only by aggregate statistics.
 */
export function buildPlannerContext(input: PlannerContextInput): PlannerContext {
    const now = validDate(new Date(input.now.getTime()));
    if (!now) throw new RangeError("Planner context requires a valid now date");

    const selectedProjectIds = [...input.pmState.ui.selectedProjectIds];
    const tasks = Object.values(input.pmState.tasks)
        .filter((task) => task.projectId !== null && selectedProjectIds.includes(task.projectId))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const workUntil = parseWorkUntil(now, input.workUntil);

    return {
        now: now.toISOString(),
        workUntil: workUntil?.toISOString() ?? null,
        workBudgetPomos: calculateWorkBudget(now, workUntil, input.settings.work_minutes),
        selectedProjectIds,
        tasks: tasks.map(toPlannerTask),
        accuracy: buildAccuracy(Object.values(input.pmState.tasks), input.logs, now),
    };
}

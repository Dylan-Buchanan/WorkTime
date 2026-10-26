import type { Habit, HabitCompletion, HabitFrequency, PMTask, PomodoroLogEntry, Project, Task } from "../state/types";
import { getBucketKey, isHabitCompleted } from "./habits";
import {
    classifyDueScope,
    collectEligibleProjectionTasks,
    toLocalDateKey,
    type ProjectionEligibilityInput,
} from "./timer";

export type TodayTaskBucket = "overdue" | "today" | "flexible";

export interface TodayTaskEntry {
    id: string;
    title: string;
    projectId: string | null;
    projectName: string | null;
    projectColor: string | null;
    appTaskId: string | null;
    dueDate: string | null;
    dueKey: string | null;
    bucket: TodayTaskBucket;
    estimatePomos: number;
    workedPomos: number;
    remainingPomodoros: number;
    isActive: boolean;
}

export interface TodayTaskList {
    tasks: TodayTaskEntry[];
    remainingPomodoros: number;
}

export interface BuildTodayTasksInput extends ProjectionEligibilityInput {
    reference: Date;
}

const BUCKET_ORDER: Record<TodayTaskBucket, number> = {
    overdue: 0,
    today: 1,
    flexible: 2,
};

function toTodayTask(
    entry: ReturnType<typeof collectEligibleProjectionTasks>[number],
    projects: Readonly<Record<string, Project>>,
    todayKey: string,
): TodayTaskEntry {
    const project = entry.projectId ? projects[entry.projectId] : undefined;
    const bucket: TodayTaskBucket = !entry.dueKey
        ? "flexible"
        : entry.dueKey < todayKey
            ? "overdue"
            : "today";

    return {
        id: entry.task.id,
        title: entry.task.title || "Untitled task",
        projectId: entry.projectId,
        projectName: project?.name ?? null,
        projectColor: project?.color ?? null,
        appTaskId: entry.task.appTaskId ?? null,
        dueDate: entry.dueDate,
        dueKey: entry.dueKey,
        bucket,
        estimatePomos: entry.estimatePomos,
        workedPomos: entry.workedPomos,
        remainingPomodoros: entry.remainingPomodoros,
        isActive: entry.isActive,
    };
}

/**
 * The tasks the projected-finish card counts for today: due today, overdue, and
 * undated/flexible work. Built from the same eligibility rules as the projection.
 */
export function buildTodayTasks(input: BuildTodayTasksInput): TodayTaskList {
    const todayKey = toLocalDateKey(input.reference);
    const tasks = collectEligibleProjectionTasks(input)
        .filter((entry) => {
            const scope = classifyDueScope(entry.dueDate, input.reference);
            return scope === "due" || scope === "unscheduled";
        })
        .map((entry) => toTodayTask(entry, input.projects, todayKey))
        .sort((left, right) => {
            const bucketDelta = BUCKET_ORDER[left.bucket] - BUCKET_ORDER[right.bucket];
            if (bucketDelta !== 0) return bucketDelta;
            const leftKey = left.dueKey ?? "9999-12-31";
            const rightKey = right.dueKey ?? "9999-12-31";
            if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
            return left.title.localeCompare(right.title);
        });

    const remainingPomodoros = tasks.reduce((total, task) => total + task.remainingPomodoros, 0);
    return { tasks, remainingPomodoros };
}

export interface TodayHabitEntry {
    id: string;
    name: string;
    color: string;
    frequency: HabitFrequency;
    /** The current-period bucket the completion state refers to. */
    bucket: string;
    completed: boolean;
}

export interface BuildTodayHabitsInput {
    habits: readonly Habit[];
    completions: readonly Pick<HabitCompletion, "habitId" | "bucket">[];
    reference: Date;
}

/**
 * Habits due in the current period. Weekly and monthly habits use their current
 * week/month bucket and stay in the list so the day is not silently incomplete.
 */
export function buildTodayHabits(input: BuildTodayHabitsInput): TodayHabitEntry[] {
    return input.habits
        .filter((habit) => !habit.isArchived)
        .slice()
        .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt))
        .map((habit) => {
            const bucket = getBucketKey(input.reference, habit.frequency);
            return {
                id: habit.id,
                name: habit.name || "Untitled habit",
                color: habit.color,
                frequency: habit.frequency,
                bucket,
                completed: isHabitCompleted(input.completions, habit.id, bucket),
            };
        });
}

export interface TodayPomodoroSession {
    id: string;
    taskId: string;
    taskTitle: string;
    durationMinutes: number;
    finishedAt: string;
}

export interface TodayPomodoroSummary {
    count: number;
    minutes: number;
    sessions: TodayPomodoroSession[];
}

export interface BuildTodayPomodorosInput {
    logs: readonly PomodoroLogEntry[];
    backendTasks?: Readonly<Record<string, Task>>;
    pmTasks?: readonly PMTask[];
    reference: Date;
}

/**
 * Completed focus work whose local `finished_at` date is today. Breaks are
 * excluded, matching the analytics page's definition of today's pomodoros.
 */
export function buildTodayPomodoros(input: BuildTodayPomodorosInput): TodayPomodoroSummary {
    const todayKey = toLocalDateKey(input.reference);
    const titleByAppTask = new Map<string, string>();
    for (const pmTask of input.pmTasks ?? []) {
        if (!pmTask.appTaskId) continue;
        const title = pmTask.title?.trim();
        if (title && !titleByAppTask.has(pmTask.appTaskId)) titleByAppTask.set(pmTask.appTaskId, title);
    }

    const sessions: TodayPomodoroSession[] = [];
    for (const log of input.logs) {
        if (log.was_break) continue;
        const finished = new Date(log.finished_at);
        if (Number.isNaN(finished.getTime())) continue;
        if (toLocalDateKey(finished) !== todayKey) continue;
        const duration = Number.isFinite(log.duration_minutes) ? Math.max(0, log.duration_minutes) : 0;
        sessions.push({
            id: log.id,
            taskId: log.task_id,
            taskTitle: titleByAppTask.get(log.task_id) ?? input.backendTasks?.[log.task_id]?.name ?? "Unassigned task",
            durationMinutes: duration,
            finishedAt: log.finished_at,
        });
    }

    sessions.sort((left, right) => new Date(right.finishedAt).getTime() - new Date(left.finishedAt).getTime());

    const minutes = sessions.reduce((total, session) => total + session.durationMinutes, 0);
    return { count: sessions.length, minutes, sessions };
}

export interface TodayOverview {
    tasks: TodayTaskEntry[];
    remainingPomodoros: number;
    habits: TodayHabitEntry[];
    habitsCompleted: number;
    pomodoros: TodayPomodoroSummary;
}

export interface BuildTodayOverviewInput extends BuildTodayTasksInput {
    habits: readonly Habit[];
    completions: readonly Pick<HabitCompletion, "habitId" | "bucket">[];
    logs: readonly PomodoroLogEntry[];
}

/** One call that assembles everything the today surface renders. */
export function buildTodayOverview(input: BuildTodayOverviewInput): TodayOverview {
    const taskList = buildTodayTasks(input);
    const habits = buildTodayHabits(input);
    const pomodoros = buildTodayPomodoros(input);
    return {
        tasks: taskList.tasks,
        remainingPomodoros: taskList.remainingPomodoros,
        habits,
        habitsCompleted: habits.filter((habit) => habit.completed).length,
        pomodoros,
    };
}

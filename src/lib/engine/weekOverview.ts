import type { PMTask, Project, WorkableWeekday } from "../../state/types";
import { normalizeProjectSchedule } from "../projectSchedule";
import { getLocalWeekWindow, parseDueDateKey, toLocalDateKey } from "../timer";

export interface WeekOverviewDay {
    dateKey: string;
    duePomodoros: number;
    unscheduledPomodoros: number;
    totalPomodoros: number;
}

export interface WeekOverview {
    startKey: string;
    endKey: string;
    todayKey: string;
    todayIndex: number;
    days: WeekOverviewDay[];
    duePomodoros: number;
    unscheduledPomodoros: number;
    totalPomodoros: number;
}

export interface BuildWeekOverviewInput {
    tasks: readonly PMTask[];
    projects: Readonly<Record<string, Project>>;
    reference: Date;
}

function remainingPomodoros(task: PMTask): number {
    const estimate = typeof task.estimatePomos === "number" && Number.isFinite(task.estimatePomos) && task.estimatePomos > 0
        ? task.estimatePomos
        : 1;
    const worked = typeof task.workedPomos === "number" && Number.isFinite(task.workedPomos)
        ? Math.max(0, task.workedPomos)
        : 0;
    return Math.max(1, Math.ceil(estimate - worked));
}

function buildWeekDays(reference: Date): WeekOverviewDay[] {
    const monday = new Date(reference);
    monday.setHours(12, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + index);
        return {
            dateKey: toLocalDateKey(date),
            duePomodoros: 0,
            unscheduledPomodoros: 0,
            totalPomodoros: 0,
        };
    });
}

/**
 * Build the current Monday-to-Sunday workload from caller-supplied state.
 * Overdue work lands on today. Undated work is balanced, one pomodoro at a
 * time, across the remaining workable days for its project.
 */
export function buildWeekOverview(input: BuildWeekOverviewInput): WeekOverview {
    if (Number.isNaN(input.reference.getTime())) throw new RangeError("Invalid week overview reference date");

    const { startKey, endKey } = getLocalWeekWindow(input.reference);
    const todayKey = toLocalDateKey(input.reference);
    const days = buildWeekDays(input.reference);
    const todayIndex = days.findIndex((day) => day.dateKey === todayKey);
    const unscheduled: Array<{ task: PMTask; remaining: number }> = [];

    const eligibleTasks = input.tasks
        .filter((task) => !task.isArchived && task.status !== "Done")
        .map((task) => ({ task, remaining: remainingPomodoros(task) }))
        .filter(({ remaining }) => remaining > 0)
        .sort((left, right) => left.task.id.localeCompare(right.task.id));

    for (const entry of eligibleTasks) {
        const dueKey = parseDueDateKey(entry.task.dueDate);
        if (!dueKey) {
            unscheduled.push(entry);
            continue;
        }
        if (dueKey > endKey) continue;

        const targetKey = dueKey <= todayKey ? todayKey : dueKey;
        if (targetKey < startKey) continue;
        const target = days.find((day) => day.dateKey === targetKey);
        if (!target) continue;
        target.duePomodoros += entry.remaining;
        target.totalPomodoros += entry.remaining;
    }

    for (const { task, remaining } of unscheduled) {
        const project = task.projectId ? input.projects[task.projectId] : undefined;
        const schedule = normalizeProjectSchedule(project);
        let availableIndexes = days
            .map((day, index) => ({ day, index }))
            .filter(({ day, index }) => index >= todayIndex && schedule.workableDays.includes(new Date(`${day.dateKey}T12:00:00`).getDay() as WorkableWeekday))
            .map(({ index }) => index);
        if (availableIndexes.length === 0) availableIndexes = [todayIndex];

        for (let count = 0; count < remaining; count += 1) {
            const index = availableIndexes.reduce((best, candidate) => {
                if (days[candidate].totalPomodoros < days[best].totalPomodoros) return candidate;
                return best;
            }, availableIndexes[0]);
            days[index].unscheduledPomodoros += 1;
            days[index].totalPomodoros += 1;
        }
    }

    return {
        startKey,
        endKey,
        todayKey,
        todayIndex,
        days,
        duePomodoros: days.reduce((total, day) => total + day.duePomodoros, 0),
        unscheduledPomodoros: days.reduce((total, day) => total + day.unscheduledPomodoros, 0),
        totalPomodoros: days.reduce((total, day) => total + day.totalPomodoros, 0),
    };
}

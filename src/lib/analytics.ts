import { format, parseISO, startOfDay, startOfWeek } from "date-fns";
import { PomodoroLogEntry } from "../state/types";

export interface AnalyticsFilters {
    from: Date;
    to: Date;
    projectIds: string[];
    includeBreaks: boolean;
    workHoursOnly: boolean;
    deepOnly: boolean;
    tags: string[];
    statuses: string[];
}

export interface TaskMeta {
    tags: string[];
    status: string;
    projectId: string | null;
}

/**
 * Apply the Analytics page filters to a log list. Faithful port of the
 * useMemo in AnalyticsPage.tsx lines 89-120.
 * NOTE: a log whose task has no project mapping is kept even when a project
 * filter is active (that is the current behavior).
 */
export function filterLogs(
    logs: PomodoroLogEntry[] | undefined,
    filters: AnalyticsFilters,
    projectByAppTask: Record<string, string | null>,
    taskMetaByAppTask: Record<string, TaskMeta>
): PomodoroLogEntry[] {
    if (!logs) return [];
    return logs.filter((l) => {
        const finished = parseISO(l.finished_at as any);
        if (finished < filters.from || finished > filters.to) return false;
        if (!filters.includeBreaks && l.was_break) return false;
        if (filters.workHoursOnly) {
            const h = finished.getHours();
            if (h < 8 || h > 18) return false;
        }
        if (filters.projectIds.length > 0) {
            const proj = projectByAppTask[l.task_id];
            if (proj && !filters.projectIds.includes(proj)) return false;
        }
        if (filters.tags.length > 0 || filters.statuses.length > 0) {
            const meta = taskMetaByAppTask[l.task_id];
            if (meta) {
                if (
                    filters.tags.length > 0 &&
                    !meta.tags.some((t) => filters.tags.includes(t))
                )
                    return false;
                if (
                    filters.statuses.length > 0 &&
                    !filters.statuses.includes(meta.status)
                )
                    return false;
            }
        }
        return true;
    });
}

/**
 * Detect deep-work sessions: consecutive non-break sessions with <=10m gap.
 * Returns the set of `finished_at` strings that belong to a run of >=2 sessions.
 */
export function computeDeepWorkSessions(
    workSessions: PomodoroLogEntry[]
): Set<string> {
    const sorted = [...workSessions].sort((a, b) =>
        (a.finished_at as any).localeCompare(b.finished_at as any)
    );
    const deepSet = new Set<string>();
    let run: PomodoroLogEntry[] = [];
    for (const s of sorted) {
        if (run.length === 0) {
            run.push(s);
            continue;
        }
        const prev = run[run.length - 1];
        const prevEnd = parseISO(prev.finished_at as any).getTime();
        const curEnd = parseISO(s.finished_at as any).getTime();
        const gap = (curEnd - prevEnd) / 60000; // minutes
        if (gap <= 10) {
            run.push(s);
        } else {
            if (run.length >= 2) run.forEach((r) => deepSet.add(r.finished_at as any));
            run = [s];
        }
    }
    if (run.length >= 2) run.forEach((r) => deepSet.add(r.finished_at as any));
    return deepSet;
}

export interface AnalyticsMetrics {
    todayCount: number;
    weekCount: number;
    todayMinutes: number;
    weekMinutes: number;
    completionRate: number;
    interruptionRate: number;
    avgFocusLength: number;
    streak: number;
    peakHour: string;
    completed: number;
    aborted: number;
    overrunRatio: number;
    breakDiscipline: number;
}

/**
 * Compute the analytics headline metrics. Faithful port of the useMemo in
 * AnalyticsPage.tsx lines 161-269, parameterized by `now` for testability.
 */
export function computeMetrics(
    filtered: PomodoroLogEntry[],
    settings: { work_minutes: number; short_break_minutes: number; long_break_minutes: number },
    now: Date
): AnalyticsMetrics {
    const todayStr = format(now, "yyyy-MM-dd");
    const startOfWeekDate = startOfWeek(now, { weekStartsOn: 1 });
    let todayCount = 0,
        weekCount = 0;
    let todayMinutes = 0,
        weekMinutes = 0;
    const workSessions = filtered.filter((l) => !l.was_break);
    workSessions.forEach((l) => {
        const d = parseISO(l.finished_at as any);
        const dStr = format(d, "yyyy-MM-dd");
        if (dStr === todayStr) {
            todayCount++;
            todayMinutes += l.duration_minutes;
        }
        if (d >= startOfWeekDate) {
            weekCount++;
            weekMinutes += l.duration_minutes;
        }
    });
    // Derive completed vs aborted heuristically using planned work length (>=95% planned considered completed)
    const planned = settings.work_minutes || 25;
    const completedSessions = workSessions.filter(
        (s) => s.duration_minutes >= planned * 0.95
    );
    const abortedSessions = workSessions.filter(
        (s) => s.duration_minutes < planned * 0.95
    );
    const completed = completedSessions.length;
    const aborted = abortedSessions.length;
    const completionRate =
        completed + aborted === 0 ? 0 : completed / (completed + aborted);
    const interruptionRate =
        completed === 0 ? 0 : aborted / (completed + aborted); // proxy
    const avgFocusLength = workSessions.length
        ? workSessions.reduce((a, b) => a + b.duration_minutes, 0) / workSessions.length
        : 0;
    // Streak: consecutive days with >=4 sessions
    const byDay: Record<string, number> = {};
    workSessions.forEach((l) => {
        const d = format(parseISO(l.finished_at as any), "yyyy-MM-dd");
        byDay[d] = (byDay[d] || 0) + 1;
    });
    let streak = 0;
    let cursor = startOfDay(now);
    while (true) {
        const key = format(cursor, "yyyy-MM-dd");
        if ((byDay[key] || 0) >= 4) {
            streak++;
            cursor = new Date(cursor.getTime() - 86400000);
        } else break;
    }
    // Peak hour
    const hours: Record<number, number> = {};
    workSessions.forEach((l) => {
        const d = parseISO(l.finished_at as any);
        hours[d.getHours()] = (hours[d.getHours()] || 0) + 1;
    });
    const peakHour =
        Object.entries(hours).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
    // Overrun ratio (rare with current backend) average actual/planned for completed
    const overrunRatio = completedSessions.length
        ? completedSessions.reduce((a, s) => a + s.duration_minutes / planned, 0) / completedSessions.length
        : 0;
    // Break discipline: focus session followed immediately by a break matching expected type & length tolerance ±20%
    const logsSorted = [...filtered].sort((a, b) =>
        (a.finished_at as any).localeCompare(b.finished_at as any)
    );
    let goodBreaks = 0;
    let focusCount = 0;
    const tol = 0.2;
    for (let i = 0; i < logsSorted.length; i++) {
        const cur = logsSorted[i];
        if (cur.was_break) continue;
        focusCount++;
        const next = logsSorted[i + 1];
        if (!next) continue;
        if (!next.was_break || next.break_skipped) continue;
        const mins = next.duration_minutes;
        const short = settings.short_break_minutes || 5;
        const long = settings.long_break_minutes || 15;
        const isShort = Math.abs(mins - short) <= short * tol;
        const isLong = Math.abs(mins - long) <= long * tol;
        if (isShort || isLong) goodBreaks++;
    }
    const breakDiscipline = focusCount ? goodBreaks / focusCount : 0;
    return {
        todayCount,
        weekCount,
        todayMinutes,
        weekMinutes,
        completionRate,
        interruptionRate,
        avgFocusLength,
        streak,
        peakHour,
        completed,
        aborted,
        overrunRatio,
        breakDiscipline,
    };
}

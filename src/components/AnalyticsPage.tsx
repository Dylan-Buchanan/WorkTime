import React, { useMemo, useState, useCallback } from "react";
import { useAppState } from "../state/AppStateContext";
import { usePM } from "../state/ProjectManagerContext";
import {
    format,
    subWeeks,
    startOfDay,
    parseISO,
    eachDayOfInterval,
    startOfWeek,
} from "date-fns";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
    Legend,
} from "recharts";

// Lightweight utility types for computed metrics
interface Filters {
    from: Date;
    to: Date;
    projectIds: string[]; // PM project filter, maps via task.appTaskId => task.projectId
    includeBreaks: boolean;
    workHoursOnly: boolean; // 8-18 local
    deepOnly: boolean; // sequences >=2 consecutive focus sessions
    tags: string[];
    statuses: string[];
}

export const AnalyticsPage: React.FC = () => {
    const { state: app } = useAppState();
    const { state: pm } = usePM();
    const [range, setRange] = useState<{ from: Date; to: Date }>(() => ({
        from: subWeeks(new Date(), 8),
        to: new Date(),
    }));
    const [includeBreaks, setIncludeBreaks] = useState(false);
    const [workHoursOnly, setWorkHoursOnly] = useState(false);
    const [deepOnly, setDeepOnly] = useState(false);
    const [selectedProjects, setSelectedProjects] = useState<string[]>(
        () => pm.ui.selectedProjectIds
    );
    const [tagFilter, setTagFilter] = useState<string[]>([]);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);

    const filters: Filters = {
        from: range.from,
        to: range.to,
        projectIds: selectedProjects,
        includeBreaks,
        workHoursOnly,
        deepOnly,
        tags: tagFilter,
        statuses: statusFilter,
    };

    const projectByAppTask: Record<string, string | null> = useMemo(() => {
        const map: Record<string, string | null> = {};
        Object.values(pm.tasks).forEach((t) => {
            if (t.appTaskId) map[t.appTaskId] = t.projectId;
        });
        return map;
    }, [pm.tasks]);

    const taskMetaByAppTask: Record<
        string,
        { tags: string[]; status: string; projectId: string | null }
    > = useMemo(() => {
        const map: Record<
            string,
            { tags: string[]; status: string; projectId: string | null }
        > = {};
        Object.values(pm.tasks).forEach((t) => {
            if (t.appTaskId)
                map[t.appTaskId] = {
                    tags: t.tags,
                    status: t.status,
                    projectId: t.projectId,
                };
        });
        return map;
    }, [pm.tasks]);

    const focusLogs = useMemo(() => {
        if (!app) return [] as any[];
        return app.logs.filter((l) => {
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
    }, [app, filters, projectByAppTask, taskMetaByAppTask]);

    // Derive sequences for deep work: consecutive non-break sessions with <=10m gap
    const deepSessionIds = useMemo(() => {
        if (!filters.deepOnly) return new Set<string>();
        const workSessions = focusLogs
            .filter((l: any) => !l.was_break)
            .sort((a: any, b: any) =>
                a.finished_at.localeCompare(b.finished_at)
            );
        const deepSet = new Set<string>();
        let run: any[] = [];
        for (const s of workSessions) {
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
                if (run.length >= 2)
                    run.forEach((r) => deepSet.add(r.finished_at));
                run = [s];
            }
        }
        if (run.length >= 2) run.forEach((r) => deepSet.add(r.finished_at));
        return deepSet;
    }, [focusLogs, filters.deepOnly]);

    const filtered = useMemo(() => {
        if (!filters.deepOnly) return focusLogs;
        return focusLogs.filter((l: any) =>
            l.was_break ? false : deepSessionIds.has(l.finished_at)
        );
    }, [focusLogs, filters.deepOnly, deepSessionIds]);

    // Metrics
    const metrics = useMemo(() => {
        const now = new Date();
        const todayStr = format(now, "yyyy-MM-dd");
        const startOfWeekDate = startOfWeek(now, { weekStartsOn: 1 });
        let todayCount = 0,
            weekCount = 0;
        let todayMinutes = 0,
            weekMinutes = 0;
        const workSessions = filtered.filter((l: any) => !l.was_break);
        workSessions.forEach((l: any) => {
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
        const planned = app?.settings.work_minutes || 25;
        const completedSessions = workSessions.filter(
            (s: any) => s.duration_minutes >= planned * 0.95
        );
        const abortedSessions = workSessions.filter(
            (s: any) => s.duration_minutes < planned * 0.95
        );
        const completed = completedSessions.length;
        const aborted = abortedSessions.length;
        const completionRate =
            completed + aborted === 0 ? 0 : completed / (completed + aborted);
        const interruptionRate =
            completed === 0 ? 0 : aborted / (completed + aborted); // proxy
        const avgFocusLength = workSessions.length
            ? workSessions.reduce(
                  (a: any, b: any) => a + b.duration_minutes,
                  0
              ) / workSessions.length
            : 0;
        // Streak: consecutive days with >=4 sessions
        const byDay: Record<string, number> = {};
        workSessions.forEach((l: any) => {
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
        workSessions.forEach((l: any) => {
            const d = parseISO(l.finished_at as any);
            hours[d.getHours()] = (hours[d.getHours()] || 0) + 1;
        });
        const peakHour =
            Object.entries(hours).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
        // Overrun ratio (rare with current backend) average actual/planned for completed
        const overrunRatio = completedSessions.length
            ? completedSessions.reduce(
                  (a: number, s: any) => a + s.duration_minutes / planned,
                  0
              ) / completedSessions.length
            : 0;
        // Break discipline: focus session followed immediately by a break matching expected type & length tolerance ±20%
        const logsSorted = [...filtered].sort((a: any, b: any) =>
            a.finished_at.localeCompare(b.finished_at)
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
            const short = app?.settings.short_break_minutes || 5;
            const long = app?.settings.long_break_minutes || 15;
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
    }, [filtered, app]);

    // Weekly trend (8 weeks)
    const trendData = useMemo(() => {
        const days = eachDayOfInterval({
            start: filters.from,
            end: filters.to,
        });
        return days.map((d: Date) => {
            const key = format(d, "yyyy-MM-dd");
            const sessions = filtered.filter(
                (l: any) =>
                    format(parseISO(l.finished_at as any), "yyyy-MM-dd") === key
            );
            const focusMins = sessions
                .filter((s: any) => !s.was_break)
                .reduce((a: any, b: any) => a + b.duration_minutes, 0);
            const breakMins = sessions
                .filter((s: any) => s.was_break)
                .reduce((a: any, b: any) => a + b.duration_minutes, 0);
            return { date: format(d, "MM-dd"), focusMins, breakMins };
        });
    }, [filtered, filters.from, filters.to]);

    // Heatmap (weekday vs hour) focused minutes
    const heatmap = useMemo(() => {
        const matrix: Record<string, number> = {};
        filtered
            .filter((l: any) => !l.was_break)
            .forEach((l: any) => {
                const d = parseISO(l.finished_at as any);
                const key = `${d.getDay()}-${d.getHours()}`;
                matrix[key] = (matrix[key] || 0) + l.duration_minutes;
            });
        const max =
            Object.values(matrix).reduce((a, b) => Math.max(a, b), 0) || 1;
        return { matrix, max };
    }, [filtered]);

    // Project Pareto
    const pareto = useMemo(() => {
        const per: Record<string, number> = {};
        filtered
            .filter((l: any) => !l.was_break)
            .forEach((l: any) => {
                const proj = projectByAppTask[l.task_id];
                if (!proj) return;
                per[proj] = (per[proj] || 0) + l.duration_minutes;
            });
        const entries = Object.entries(per).sort((a, b) => b[1] - a[1]);
        const total = entries.reduce((a, b) => a + b[1], 0) || 1;
        let cumulative = 0;
        const rows = entries.map(([pid, mins]) => {
            cumulative += mins;
            return {
                project: pm.projects[pid]?.name || "Unknown",
                mins,
                cumulativePct: (cumulative / total) * 100,
            };
        });
        return { rows, total };
    }, [filtered, projectByAppTask, pm.projects]);

    const scrollTo = useCallback((id: string) => {
        document
            .getElementById(id)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, []);

    const allTags = useMemo(
        () =>
            Array.from(new Set(Object.values(pm.tasks).flatMap((t) => t.tags))),
        [pm.tasks]
    );
    const allStatuses = useMemo(
        () => Array.from(new Set(Object.values(pm.tasks).map((t) => t.status))),
        [pm.tasks]
    );

    const qualityItems = useMemo(() => {
        const colorFor = (
            val: number,
            green: [number, number],
            yellow: [number, number]
        ) => {
            if (val >= green[0] && val <= green[1]) return "text-green-400";
            if (val >= yellow[0] && val <= yellow[1]) return "text-yellow-400";
            return "text-red-400";
        };
        return [
            {
                id: "completion",
                label: "Completion Rate",
                value: metrics.completionRate,
                fmt: (v: number) =>
                    `${Math.round(v * 100)}% (${metrics.completed}/${
                        metrics.completed + metrics.aborted || 0
                    })`,
                color: colorFor(
                    metrics.completionRate,
                    [0.85, 1.1],
                    [0.7, 0.85]
                ),
            },
            {
                id: "interrupt",
                label: "Interruption Rate",
                value: metrics.interruptionRate,
                fmt: (v: number) =>
                    `${Math.round(v * 100)}% (${metrics.aborted}/${
                        metrics.completed + metrics.aborted || 0
                    })`,
                color: colorFor(
                    1 - metrics.interruptionRate,
                    [0.7, 1.1],
                    [0.5, 0.7]
                ),
            },
            {
                id: "overrun",
                label: "Overrun Ratio",
                value: metrics.overrunRatio,
                fmt: (v: number) => (v ? v.toFixed(2) : "0.00"),
                color: colorFor(
                    metrics.overrunRatio,
                    [0.95, 1.1],
                    [0.85, 0.95]
                ),
            },
            {
                id: "break",
                label: "Break Discipline",
                value: metrics.breakDiscipline,
                fmt: (v: number) => `${Math.round(v * 100)}%`,
                color: colorFor(
                    metrics.breakDiscipline,
                    [0.8, 1.1],
                    [0.6, 0.8]
                ),
            },
        ];
    }, [metrics]);

    return (
        <div className="flex flex-col h-full">
            <div className="sticky top-0 z-10 bg-neutral-950/80 backdrop-blur border-b border-neutral-800 p-3 flex flex-wrap gap-3 text-xs">
                <div className="flex flex-col">
                    <label className="text-[10px] opacity-60">From</label>
                    <input
                        type="date"
                        value={format(range.from, "yyyy-MM-dd")}
                        onChange={(e) =>
                            setRange((r) => ({
                                ...r,
                                from: new Date(e.target.value),
                            }))
                        }
                        className="bg-neutral-900 rounded px-2 py-1"
                    />
                </div>
                <div className="flex flex-col">
                    <label className="text-[10px] opacity-60">To</label>
                    <input
                        type="date"
                        value={format(range.to, "yyyy-MM-dd")}
                        onChange={(e) =>
                            setRange((r) => ({
                                ...r,
                                to: new Date(e.target.value + "T23:59:59"),
                            }))
                        }
                        className="bg-neutral-900 rounded px-2 py-1"
                    />
                </div>
                <label className="flex items-center gap-1">
                    <input
                        type="checkbox"
                        checked={includeBreaks}
                        onChange={(e) => setIncludeBreaks(e.target.checked)}
                    />{" "}
                    <span>Include breaks</span>
                </label>
                <label className="flex items-center gap-1">
                    <input
                        type="checkbox"
                        checked={workHoursOnly}
                        onChange={(e) => setWorkHoursOnly(e.target.checked)}
                    />{" "}
                    <span>Work hours</span>
                </label>
                <label className="flex items-center gap-1">
                    <input
                        type="checkbox"
                        checked={deepOnly}
                        onChange={(e) => setDeepOnly(e.target.checked)}
                    />{" "}
                    <span>Deep only</span>
                </label>
                <div className="flex items-center gap-1">
                    <select
                        multiple
                        value={selectedProjects}
                        onChange={(e) => {
                            const opts = Array.from(
                                e.target.selectedOptions
                            ).map((o) => o.value);
                            setSelectedProjects(opts);
                        }}
                        className="bg-neutral-900 rounded px-2 py-1 min-w-[120px]"
                        aria-label="Projects"
                    >
                        {Object.values(pm.projects)
                            .filter((p) => !p.isArchived)
                            .map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                    </select>
                </div>
                <div className="flex items-center gap-1">
                    <select
                        multiple
                        value={tagFilter}
                        onChange={(e) =>
                            setTagFilter(
                                Array.from(e.target.selectedOptions).map(
                                    (o) => o.value
                                )
                            )
                        }
                        className="bg-neutral-900 rounded px-2 py-1 min-w-[100px]"
                        aria-label="Tags"
                    >
                        {allTags.map((t) => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-1">
                    <select
                        multiple
                        value={statusFilter}
                        onChange={(e) =>
                            setStatusFilter(
                                Array.from(e.target.selectedOptions).map(
                                    (o) => o.value
                                )
                            )
                        }
                        className="bg-neutral-900 rounded px-2 py-1 min-w-[100px]"
                        aria-label="Statuses"
                    >
                        {allStatuses.map((s) => (
                            <option key={s} value={s}>
                                {s}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <div
                className="p-4 overflow-auto flex-1 space-y-8 text-xs"
                id="analytics-root"
            >
                <section>
                    <h2 className="text-sm font-semibold mb-2">Overview</h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                        <MetricCard
                            title="Completed Pomodoros"
                            onNavigate={() => scrollTo("weekly-trend")}
                            primary={`${metrics.todayCount}`}
                            secondary={`Today / ${metrics.weekCount} Wk`}
                        />
                        <MetricCard
                            title="Focused Minutes"
                            onNavigate={() => scrollTo("weekly-trend")}
                            primary={`${Math.round(metrics.todayMinutes)}`}
                            secondary={`Today / ${Math.round(
                                metrics.weekMinutes
                            )} Wk`}
                        />
                        <MetricCard
                            title="Completion Rate"
                            onNavigate={() => scrollTo("quality-panel")}
                            primary={`${Math.round(
                                metrics.completionRate * 100
                            )}%`}
                            secondary={`(${metrics.completed}/${
                                metrics.completed + metrics.aborted || 0
                            })`}
                        />
                        <MetricCard
                            title="Interruption Rate"
                            onNavigate={() => scrollTo("quality-panel")}
                            primary={`${Math.round(
                                metrics.interruptionRate * 100
                            )}%`}
                            secondary={`(${metrics.aborted}/${
                                metrics.completed + metrics.aborted || 0
                            })`}
                        />
                        <MetricCard
                            title="Avg Focus Length"
                            onNavigate={() => scrollTo("weekly-trend")}
                            primary={`${metrics.avgFocusLength.toFixed(1)}`}
                            secondary="mins"
                        />
                        <MetricCard
                            title="Streak"
                            onNavigate={() => scrollTo("streaks")}
                            primary={`${metrics.streak}`}
                            secondary="days"
                        />
                    </div>
                </section>
                <section id="weekly-trend" className="space-y-2">
                    <h2 className="text-sm font-semibold">Weekly Trend</h2>
                    <div className="h-56 bg-neutral-900 rounded p-2">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={trendData}>
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke="#333"
                                />
                                <XAxis
                                    dataKey="date"
                                    hide={trendData.length > 120}
                                />
                                <YAxis />
                                <Tooltip
                                    contentStyle={{
                                        background: "#111",
                                        fontSize: 12,
                                    }}
                                />
                                <Legend />
                                <Bar
                                    dataKey="focusMins"
                                    stackId="a"
                                    fill="#6366F1"
                                    name="Focus"
                                />
                                <Bar
                                    dataKey="breakMins"
                                    stackId="a"
                                    fill="#10B981"
                                    name="Break"
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </section>
                <section id="heatmap" className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold">
                            Hour-of-Day Heatmap
                        </h2>
                        <button
                            onClick={() => alert("Schedule Focus Block (stub)")}
                            className="text-[10px] px-2 py-1 bg-neutral-800 rounded"
                        >
                            Schedule Focus Block
                        </button>
                    </div>
                    <Heatmap hours={heatmap} />
                </section>
                <section id="project-pareto" className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold">
                            Project Pareto
                        </h2>
                        <button
                            onClick={() =>
                                alert("Archive/Snooze Long Tail (stub)")
                            }
                            className="text-[10px] px-2 py-1 bg-neutral-800 rounded"
                        >
                            Archive/Snooze Long Tail
                        </button>
                    </div>
                    <div className="bg-neutral-900 rounded p-3 overflow-auto">
                        <table className="w-full text-[10px]">
                            <thead>
                                <tr className="text-neutral-400">
                                    <th className="text-left p-1">Project</th>
                                    <th className="text-right p-1">Minutes</th>
                                    <th className="text-right p-1">
                                        Cumulative%
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {pareto.rows.map((r) => (
                                    <tr key={r.project}>
                                        <td className="p-1">{r.project}</td>
                                        <td className="p-1 text-right">
                                            {Math.round(r.mins)}
                                        </td>
                                        <td
                                            className={`p-1 text-right ${
                                                r.cumulativePct <= 80
                                                    ? "text-green-400"
                                                    : ""
                                            }`}
                                        >
                                            {r.cumulativePct.toFixed(1)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
                <section id="quality-panel" className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold">
                            Quality & Planning
                        </h2>
                        <button
                            onClick={() =>
                                alert("Shorten session length by 5m (stub)")
                            }
                            className="text-[10px] px-2 py-1 bg-neutral-800 rounded"
                        >
                            Shorten session length by 5m
                        </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {qualityItems.map((q) => (
                            <div
                                key={q.id}
                                className={`bg-neutral-900 rounded p-3 flex flex-col gap-1 ${q.color}`}
                            >
                                <span className="text-[10px] uppercase tracking-wide opacity-70">
                                    {q.label}
                                </span>
                                <span className="text-lg font-semibold">
                                    {q.fmt(q.value)}
                                </span>
                            </div>
                        ))}
                    </div>
                    <p className="text-[10px] text-neutral-500">
                        Some metrics heuristic due to limited log schema
                        (interruptions / overruns inferred).
                    </p>
                </section>
                <section id="streaks" className="space-y-2">
                    <h2 className="text-sm font-semibold">
                        Streaks & Capacity
                    </h2>
                    <div className="bg-neutral-900 rounded p-3 flex flex-col gap-2">
                        <div className="text-[11px]">
                            Current streak: <strong>{metrics.streak}</strong>{" "}
                            days (&gt;=4 sessions)
                        </div>
                        <CapacityForecast filtered={filtered} />
                    </div>
                </section>
            </div>
        </div>
    );
};

const MetricCard: React.FC<{
    title: string;
    primary: string;
    secondary?: string;
    onNavigate?: () => void;
}> = ({ title, primary, secondary, onNavigate }) => (
    <button
        onClick={onNavigate}
        className="bg-neutral-900 rounded p-3 flex flex-col gap-1 text-left focus:outline-none focus:ring-2 focus:ring-indigo-500"
        tabIndex={0}
        aria-label={`${title} ${primary} ${secondary || ""}`}
    >
        <span className="text-[10px] uppercase opacity-60 tracking-wide">
            {title}
        </span>
        <span className="text-lg font-semibold">{primary}</span>
        {secondary && (
            <span className="text-[10px] opacity-70">{secondary}</span>
        )}
    </button>
);

// Heatmap component
const Heatmap: React.FC<{
    hours: { matrix: Record<string, number>; max: number };
}> = ({ hours }) => {
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return (
        <div className="overflow-auto">
            <div
                className="grid"
                style={{ gridTemplateColumns: `48px repeat(24, 1fr)` }}
            >
                <div />
                {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h} className="text-center text-[9px] opacity-60">
                        {h}
                    </div>
                ))}
                {weekdays.map((d, dayIdx) => (
                    <React.Fragment key={d}>
                        <div className="text-[10px] pr-1 flex items-center justify-end opacity-60">
                            {d}
                        </div>
                        {Array.from({ length: 24 }).map((_, h) => {
                            const val = hours.matrix[`${dayIdx}-${h}`] || 0;
                            const pct = val / hours.max;
                            const bg =
                                pct === 0
                                    ? "transparent"
                                    : `hsl(${Math.round(180 - pct * 120)},70%,${
                                          30 + pct * 30
                                      }%)`;
                            return (
                                <div
                                    key={h}
                                    title={`${d} ${h}:00 - ${Math.round(
                                        val
                                    )} mins`}
                                    className="h-5 m-[1px] rounded"
                                    style={{ background: bg }}
                                    aria-label={`${d} hour ${h} ${Math.round(
                                        val
                                    )} minutes`}
                                />
                            );
                        })}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};

// Capacity Forecast: simple next 2 weeks forecast = weekday average * upcoming workdays (Mon-Fri)
const CapacityForecast: React.FC<{ filtered: any[] }> = ({ filtered }) => {
    const byWeekday: number[] = Array(7).fill(0);
    const counts: number[] = Array(7).fill(0);
    filtered
        .filter((f) => !f.was_break)
        .forEach((f) => {
            const d = parseISO(f.finished_at as any);
            byWeekday[d.getDay()] += f.duration_minutes;
            counts[d.getDay()]++;
        });
    const avgPerWeekday = byWeekday.map((m, i) =>
        counts[i] ? m / counts[i] : 0
    );
    const next14: Date[] = [];
    const now = new Date();
    for (let i = 1; i <= 14; i++) {
        next14.push(new Date(now.getTime() + i * 86400000));
    }
    let forecastMins = 0;
    next14.forEach((d) => {
        const dow = d.getDay();
        if (dow === 0 || dow === 6) return;
        forecastMins += avgPerWeekday[dow];
    });
    return (
        <div className="text-[11px]">
            Forecast 2 weeks focus capacity:{" "}
            <strong>{Math.round(forecastMins)} mins</strong> (~
            {(forecastMins / 60).toFixed(1)} hrs)
        </div>
    );
};

export default AnalyticsPage;

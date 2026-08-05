import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useAppState } from "../state/AppStateContext";
import { usePM } from "../state/ProjectManagerContext";
import {
    format,
    subWeeks,
    parseISO,
    eachDayOfInterval,
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
import { AnalyticsFilters, filterLogs, computeDeepWorkSessions, computeMetrics } from "../lib/analytics";

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

    const filters: AnalyticsFilters = {
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

    const focusLogs = useMemo(
        () => filterLogs(app?.logs, filters, projectByAppTask, taskMetaByAppTask),
        [app, filters, projectByAppTask, taskMetaByAppTask]
    );

    // Derive sequences for deep work: consecutive non-break sessions with <=10m gap
    const deepSessionIds = useMemo(
        () => (filters.deepOnly ? computeDeepWorkSessions(focusLogs.filter((l: any) => !l.was_break)) : new Set<string>()),
        [focusLogs, filters.deepOnly]
    );

    const filtered = useMemo(() => {
        if (!filters.deepOnly) return focusLogs;
        return focusLogs.filter((l: any) =>
            l.was_break ? false : deepSessionIds.has(l.finished_at)
        );
    }, [focusLogs, filters.deepOnly, deepSessionIds]);

    // Metrics
    const metrics = useMemo(
        () =>
            computeMetrics(filtered, app?.settings ?? { work_minutes: 25, short_break_minutes: 5, long_break_minutes: 15 }, new Date()),
        [filtered, app]
    );

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
                <MultiSelect
                    label="Projects"
                    minWidth="min-w-[120px]"
                    options={Object.values(pm.projects)
                        .filter((p) => !p.isArchived)
                        .map((p) => ({ value: p.id, label: p.name }))}
                    value={selectedProjects}
                    onChange={setSelectedProjects}
                />
                <MultiSelect
                    label="Tags"
                    minWidth="min-w-[100px]"
                    options={allTags.map((t) => ({ value: t, label: t }))}
                    value={tagFilter}
                    onChange={setTagFilter}
                />
                <MultiSelect
                    label="Statuses"
                    minWidth="min-w-[100px]"
                    options={allStatuses.map((s) => ({ value: s, label: s }))}
                    value={statusFilter}
                    onChange={setStatusFilter}
                />
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

export const MultiSelect: React.FC<{
    label: string;
    minWidth?: string;
    options: { value: string; label: string }[];
    value: string[];
    onChange: (next: string[]) => void;
}> = ({ label, minWidth, options, value, onChange }) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDocMouseDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onDocMouseDown);
        return () => document.removeEventListener("mousedown", onDocMouseDown);
    }, [open]);

    const knownValues = useMemo(
        () => new Set(options.map((o) => o.value)),
        [options]
    );
    const selectedCount = options.filter((o) =>
        value.includes(o.value)
    ).length;
    const allSelected =
        options.length > 0 && selectedCount === options.length;
    const summary =
        allSelected
            ? "All selected"
            : selectedCount === 0
              ? label
              : selectedCount === 1
                ? options.find((o) =>
                      value.includes(o.value)
                  )?.label ?? `${selectedCount} selected`
                : `${selectedCount} selected`;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={`bg-neutral-900 rounded px-2 py-1 text-left flex items-center justify-between gap-2 ${minWidth ?? "min-w-[100px]"}`}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={label}
            >
                <span className="truncate">{summary}</span>
                <span className="text-[8px] opacity-60">▼</span>
            </button>
            {open && (
                <div
                    role="listbox"
                    aria-multiselectable
                    aria-label={label}
                    className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded border border-neutral-700 bg-neutral-900 p-1 shadow-xl habit-scroll"
                >
                    {options.length === 0 && (
                        <div className="px-2 py-1 text-[11px] opacity-60">
                            No options
                        </div>
                    )}
                    {options.map((o) => (
                        <label
                            key={o.value}
                            className="flex items-center gap-2 rounded px-2 py-1 text-[11px] cursor-pointer hover:bg-neutral-800"
                        >
                            <input
                                type="checkbox"
                                checked={value.includes(o.value)}
                                onChange={() => {
                                    const next = value.includes(o.value)
                                        ? value.filter((v) => v !== o.value)
                                        : [
                                              ...value.filter((v) =>
                                                  knownValues.has(v)
                                              ),
                                              o.value,
                                          ];
                                    onChange(next);
                                }}
                            />
                            <span className="truncate">{o.label}</span>
                        </label>
                    ))}
                </div>
            )}
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

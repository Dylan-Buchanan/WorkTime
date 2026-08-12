import React, { useMemo } from "react";
import { buildWeekOverview } from "../lib/engine";
import { usePM } from "../state/ProjectManagerContext";
import type { PMTask, Project } from "../state/types";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dateFromKey(key: string): Date {
    return new Date(`${key}T12:00:00`);
}

function formatWeekRange(startKey: string, endKey: string): string {
    const start = dateFromKey(startKey);
    const end = dateFromKey(endKey);
    const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const endLabel = end.toLocaleDateString(undefined, {
        month: start.getMonth() === end.getMonth() ? undefined : "short",
        day: "numeric",
        year: "numeric",
    });
    return `${startLabel} – ${endLabel}`;
}

export const WeekOverviewPage: React.FC = () => {
    const { state } = usePM();
    return (
        <WeekOverviewContent
            tasks={Object.values(state.tasks)}
            projects={state.projects}
            reference={new Date()}
        />
    );
};

export const WeekOverviewContent: React.FC<{
    tasks: readonly PMTask[];
    projects: Readonly<Record<string, Project>>;
    reference: Date;
}> = ({ tasks, projects, reference }) => {
    const overview = useMemo(
        () => buildWeekOverview({ tasks, projects, reference }),
        [tasks, projects, reference],
    );
    const elapsedDays = overview.todayIndex + 1;
    const calendarProgress = Math.round((elapsedDays / 7) * 100);
    const plannedThroughToday = overview.days
        .slice(0, elapsedDays)
        .reduce((total, day) => total + day.totalPomodoros, 0);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950/80 px-4 py-3 backdrop-blur">
                <div>
                    <h1 className="text-base font-semibold">Week overview</h1>
                    <p className="text-[10px] text-neutral-500">{formatWeekRange(overview.startKey, overview.endKey)} · remaining pomodoros</p>
                </div>
                <div className="ml-auto text-right">
                    <p className="text-[10px] uppercase tracking-wide text-neutral-500">Week progress</p>
                    <p className="text-xs font-medium">Day {elapsedDays} of 7</p>
                </div>
            </header>

            <main className="app-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mx-auto max-w-6xl space-y-4">
                    <section className="grid gap-3 sm:grid-cols-3" aria-label="Week totals">
                        <SummaryCard label="Planned" value={overview.totalPomodoros} detail="remaining this week" />
                        <SummaryCard label="Due" value={overview.duePomodoros} detail="dated or overdue" />
                        <SummaryCard label="Flexible" value={overview.unscheduledPomodoros} detail="spread by project schedule" />
                    </section>

                    <section className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3" aria-labelledby="week-progress-title">
                        <div className="flex items-end justify-between gap-3">
                            <div>
                                <h2 id="week-progress-title" className="text-xs font-semibold">Week progress</h2>
                                <p className="mt-0.5 text-[10px] text-neutral-500">{plannedThroughToday} of {overview.totalPomodoros} remaining pomodoros fall on days through today.</p>
                            </div>
                            <span className="text-[11px] font-medium text-indigo-300">{calendarProgress}%</span>
                        </div>
                        <div
                            className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800"
                            role="progressbar"
                            aria-label="Calendar week progress"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={calendarProgress}
                        >
                            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${calendarProgress}%` }} />
                        </div>
                    </section>

                    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7" aria-label="Daily pomodoro plan">
                        {overview.days.map((day, index) => {
                            const isToday = index === overview.todayIndex;
                            const isPast = index < overview.todayIndex;
                            return (
                                <article
                                    key={day.dateKey}
                                    aria-label={`${DAY_NAMES[index]} ${day.dateKey}`}
                                    className={`rounded-lg border p-3 ${isToday ? "border-indigo-500/70 bg-indigo-500/10 ring-1 ring-indigo-500/20" : "border-neutral-800 bg-neutral-900/60"} ${isPast ? "opacity-60" : ""}`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <h2 className="text-xs font-semibold">{DAY_NAMES[index]}</h2>
                                            <p className="text-[10px] text-neutral-500">{dateFromKey(day.dateKey).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                                        </div>
                                        {isToday && <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-medium text-indigo-200">Today</span>}
                                    </div>
                                    <p className="mt-5 text-2xl font-semibold tabular-nums">{day.totalPomodoros}</p>
                                    <p className="text-[9px] uppercase tracking-wide text-neutral-500">pomodoros</p>
                                    <dl className="mt-3 space-y-1 border-t border-neutral-800 pt-2 text-[10px]">
                                        <div className="flex justify-between gap-2"><dt className="text-neutral-500">Due</dt><dd>{day.duePomodoros}</dd></div>
                                        <div className="flex justify-between gap-2"><dt className="text-neutral-500">Flexible</dt><dd>{day.unscheduledPomodoros}</dd></div>
                                    </dl>
                                </article>
                            );
                        })}
                    </section>

                    <p className="text-[10px] text-neutral-500">
                        Flexible work is balanced across the remaining workable days configured for each project. If no workable day remains, it is placed on today.
                    </p>
                </div>
            </main>
        </div>
    );
};

const SummaryCard: React.FC<{ label: string; value: number; detail: string }> = ({ label, value, detail }) => (
    <article className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
        <p className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
        <p className="text-[10px] text-neutral-500">{detail}</p>
    </article>
);

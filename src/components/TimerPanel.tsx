import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../state/AppStateContext";
import { useSounds } from "../hooks/useSounds";
import { usePM } from "../state/ProjectManagerContext";
import { TaskInspector } from "./ProjectManager/TaskInspector";
import {
    EPSILON,
    buildProjectionBacklogs,
    computeElapsedSecs,
    formatDurationMinutes,
    formatMs,
    formatPomodoroCount,
    getLocalWeekWindow,
    toLocalDateKey,
    type ProjectionBacklog,
    type ProjectionBacklogTask,
} from "../lib/timer";
import { useOptionalTodos } from "../state/TodoContext";
import { addProjectedDuration, combinedProjectFinish } from "../lib/projection";
import { CalendarDays, CalendarRange, Check, Clock3, Coffee, Info, Target } from "lucide-react";

const DAILY_PROJECTED_FINISH_RULES = "Includes no due date and due today/overdue. Unfinished tasks at or over estimate count as 1p remaining. Excludes future-due, Done, archived, and no-estimate.";
const WEEKLY_PROJECTED_FINISH_RULES = "Includes no due date, due today/overdue, and due later this week. Unfinished tasks at or over estimate count as 1p remaining. Excludes later-due, Done, archived, and no-estimate.";

type FinishProjection =
    | {
          hasWork: true;
          finishDate: Date;
          finishLabel: string;
          dayLabel: string;
          extendsPastWindow: boolean;
          totalPomodoros: number;
          dueTodayPomodoros: number;
          unscheduledPomodoros: number;
          dueThisWeekPomodoros: number;
          futureDuePomodoros: number;
          totalMinutes: number;
          workMinutes: number;
          breakMinutes: number;
      }
    | {
          hasWork: false;
          totalPomodoros: number;
          dueTodayPomodoros: number;
          unscheduledPomodoros: number;
          dueThisWeekPomodoros: number;
          futureDuePomodoros: number;
      };

interface ProjectionCardProps {
    projection: FinishProjection;
    scope: "daily" | "weekly";
}

const ProjectionCard: React.FC<ProjectionCardProps> = ({ projection, scope }) => {
    const [infoOpen, setInfoOpen] = useState(false);
    const isWeekly = scope === "weekly";
    const title = isWeekly ? "Weekly projected finish" : "Daily projected finish";
    const rules = isWeekly ? WEEKLY_PROJECTED_FINISH_RULES : DAILY_PROJECTED_FINISH_RULES;
    const rulesId = `${scope}-projected-finish-rules`;
    const ScopeIcon = isWeekly ? CalendarRange : CalendarDays;
    const theme = isWeekly
        ? {
              border: "border-fuchsia-400/20",
              glow: "bg-fuchsia-500/10",
              icon: "bg-fuchsia-400/10 text-fuchsia-300 ring-fuchsia-400/20",
              label: "text-fuchsia-300",
              bar: "bg-fuchsia-400",
              chip: "border-fuchsia-400/15 bg-fuchsia-400/5",
          }
        : {
              border: "border-sky-400/20",
              glow: "bg-sky-500/10",
              icon: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
              label: "text-sky-300",
              bar: "bg-sky-400",
              chip: "border-sky-400/15 bg-sky-400/5",
          };

    if (!projection.hasWork) {
        const hasExcludedWork = projection.futureDuePomodoros > EPSILON;
        return (
            <section className={`relative w-full overflow-hidden rounded-xl border bg-neutral-900/75 p-4 text-left shadow-lg shadow-black/10 ${theme.border}`}>
                <div className={`pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full blur-3xl ${theme.glow}`} />
                <div className="relative flex items-start gap-3">
                    <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1 ${hasExcludedWork ? "bg-amber-400/10 text-amber-300 ring-amber-400/20" : "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20"}`}>
                        {hasExcludedWork ? <ScopeIcon size={17} aria-hidden /> : <Check size={17} aria-hidden />}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${theme.label}`}>{title}</div>
                        <div className="mt-1 text-sm leading-snug text-neutral-200">
                            {hasExcludedWork
                                ? isWeekly
                                    ? `No work due this week. ${formatPomodoroCount(projection.futureDuePomodoros)} later-due work remains outside this projection.`
                                    : `No work due today. ${formatPomodoroCount(projection.futureDuePomodoros)} future-due work remains outside this projection.`
                                : isWeekly ? "You're all caught up for this week. Great work!" : "You're all caught up for today. Great work!"}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-200"
                        onClick={() => setInfoOpen((open) => !open)}
                        aria-expanded={infoOpen}
                        aria-controls={rulesId}
                        aria-label="Info"
                    >
                        <Info size={14} aria-hidden />
                    </button>
                </div>
                {infoOpen && <div id={rulesId} className="relative mt-3 border-t border-white/5 pt-3 text-[10px] leading-relaxed text-neutral-500">{rules}</div>}
            </section>
        );
    }

    const focusPercent = projection.totalMinutes > 0 ? Math.min(100, Math.max(0, (projection.workMinutes / projection.totalMinutes) * 100)) : 0;

    return (
        <section className={`relative w-full overflow-hidden rounded-xl border bg-neutral-900/75 p-4 text-left shadow-lg shadow-black/10 ${theme.border}`}>
            <div className={`pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full blur-3xl ${theme.glow}`} />
            <div className="relative flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1 ${theme.icon}`}>
                        <ScopeIcon size={17} aria-hidden />
                    </div>
                    <div>
                        <div className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${theme.label}`}>{title}</div>
                        <div className="mt-0.5 text-[10px] text-neutral-500">{formatPomodoroCount(projection.totalPomodoros)} in scope</div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        className="grid h-7 w-7 place-items-center rounded-full text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-200"
                        onClick={() => setInfoOpen((open) => !open)}
                        aria-expanded={infoOpen}
                        aria-controls={rulesId}
                        aria-label="Info"
                    >
                        <Info size={14} aria-hidden />
                    </button>
                </div>
            </div>

            <div className="relative mt-4 flex items-end justify-between gap-3">
                <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">Finish by</div>
                    <div className="mt-0.5 text-3xl font-semibold tracking-tight text-neutral-50">{projection.finishLabel}</div>
                </div>
                <div className={`mb-1 rounded-full border px-2.5 py-1 text-[10px] font-medium ${theme.chip} ${theme.label}`}>{projection.dayLabel}</div>
            </div>

            <div className="relative mt-4">
                <div className="mb-1.5 flex items-center justify-between text-[10px] text-neutral-500">
                    <span className="inline-flex items-center gap-1"><Target size={11} aria-hidden /> Focus {formatDurationMinutes(projection.workMinutes)}</span>
                    <span className="inline-flex items-center gap-1"><Coffee size={11} aria-hidden /> Breaks {formatDurationMinutes(projection.breakMinutes)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800" aria-label={`${Math.round(focusPercent)}% focus time`}>
                    <div className={`h-full rounded-full ${theme.bar}`} style={{ width: `${focusPercent}%` }} />
                </div>
                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-neutral-500">
                    <Clock3 size={11} aria-hidden />
                    <span>{formatDurationMinutes(projection.totalMinutes)} total</span>
                </div>
            </div>

            <div className="relative mt-3 flex flex-wrap gap-1.5 text-[10px] text-neutral-400">
                {projection.dueTodayPomodoros > EPSILON && <span className="rounded-full border border-white/5 bg-white/[0.03] px-2 py-1">Due now · {formatPomodoroCount(projection.dueTodayPomodoros)}</span>}
                {projection.unscheduledPomodoros > EPSILON && <span className="rounded-full border border-white/5 bg-white/[0.03] px-2 py-1">Flexible · {formatPomodoroCount(projection.unscheduledPomodoros)}</span>}
                {projection.dueThisWeekPomodoros > EPSILON && <span className="rounded-full border border-white/5 bg-white/[0.03] px-2 py-1">Later this week · {formatPomodoroCount(projection.dueThisWeekPomodoros)}</span>}
            </div>
            {projection.extendsPastWindow && (
                <div className="relative mt-3 rounded-md bg-amber-400/5 px-2.5 py-1.5 text-[10px] text-amber-300/90 ring-1 ring-inset ring-amber-400/10">
                    {isWeekly ? "May spill into next week—consider reprioritizing." : "May spill into tomorrow—consider reprioritizing."}
                </div>
            )}
            {infoOpen && <div id={rulesId} className="relative mt-3 border-t border-white/5 pt-3 text-[10px] leading-relaxed text-neutral-500">{rules}</div>}
        </section>
    );
};

const ProjectionSwitcher: React.FC<{ projections: { daily: FinishProjection; weekly: FinishProjection } }> = ({ projections }) => {
    const [scope, setScope] = useState<"daily" | "weekly">("daily");
    const options = [
        { scope: "daily" as const, label: "Today", icon: CalendarDays, projection: projections.daily },
        { scope: "weekly" as const, label: "This week", icon: CalendarRange, projection: projections.weekly },
    ];

    return (
        <div className="w-full">
            <div className="mb-2 grid grid-cols-2 rounded-lg bg-neutral-900/80 p-1 ring-1 ring-inset ring-white/5" aria-label="Projection range">
                {options.map((option) => {
                    const selected = option.scope === scope;
                    const OptionIcon = option.icon;
                    return (
                        <button
                            key={option.scope}
                            type="button"
                            className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[11px] font-medium transition-all ${
                                selected
                                    ? option.scope === "daily"
                                        ? "bg-sky-400/10 text-sky-200 shadow-sm ring-1 ring-inset ring-sky-400/15"
                                        : "bg-fuchsia-400/10 text-fuchsia-200 shadow-sm ring-1 ring-inset ring-fuchsia-400/15"
                                    : "text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-300"
                            }`}
                            onClick={() => setScope(option.scope)}
                            aria-pressed={selected}
                        >
                            <OptionIcon size={13} aria-hidden />
                            <span>{option.label}</span>
                            <span className="text-[9px] opacity-60">{formatPomodoroCount(option.projection.totalPomodoros)}</span>
                        </button>
                    );
                })}
            </div>
            <ProjectionCard scope={scope} projection={projections[scope]} />
        </div>
    );
};

export const TimerPanel: React.FC = () => {
    const app = useAppState();
    const { state, startWork, skipBreak, remainingMs, error, pauseTimer, resumeTimer, isPaused, tick } = app;
    const stopWork = app.stopWork; // preserve existing functionality
    const { play } = useSounds();
    const { state: pmState, setSelectedTask } = usePM();
    const todoContext = useOptionalTodos();
    const pmSelectedId = pmState.ui.selectedTaskId;
    const [detailsOpen, setDetailsOpen] = useState(false);
    const autoSelectedTaskRef = useRef<string | null>(null);
    const timer = state?.timer;
    const ms = remainingMs();
    const isBreak = timer && timer.kind !== "Work";
    const workMinutesSetting = state?.settings?.work_minutes ?? 0;
    const activeWorkPlannedSecs = timer?.kind === "Work" ? timer.planned_secs || workMinutesSetting * 60 : 0;
    const activeRemainingSecs = timer?.kind === "Work" ? ms / 1000 : 0;
    const activeFractionComplete = timer?.kind === "Work" && activeWorkPlannedSecs > 0 ? Math.min(1, Math.max(0, 1 - activeRemainingSecs / activeWorkPlannedSecs)) : 0;

    // Planned total (stable) from backend; fallback to computed if missing
    const plannedSecs = timer?.planned_secs || (timer ? (new Date(timer.ends_at).getTime() - new Date(timer.started_at).getTime()) / 1000 : 0);

    // Elapsed seconds including accumulated (if paused/resumed) + current run segment
    const elapsedSecs = useMemo(() => computeElapsedSecs(timer, Date.now(), plannedSecs), [timer, plannedSecs, tick]);

    const pct = plannedSecs > 0 ? Math.min(1, Math.max(0, elapsedSecs / plannedSecs)) : 0;

    const activeAppTaskId = timer?.task_id ?? state?.active_task ?? null;
    const activeAppTask = activeAppTaskId ? state?.tasks[activeAppTaskId] : null;
    const activeIsTodoTask = Boolean(activeAppTaskId && Object.values(todoContext?.state.todos ?? {})
        .some((todo) => todo.currentTaskId === activeAppTaskId));

    const linkedTask = useMemo(() => {
        if (!activeAppTaskId) return null;
        const tasks = Object.values(pmState.tasks);
        const linked = tasks.find((t) => t.appTaskId === activeAppTaskId);
        if (linked) return linked;
        if (activeAppTask?.name && !activeAppTask.archived && !activeIsTodoTask) {
            const normalized = activeAppTask.name.trim().toLowerCase();
            const byTitle = tasks.find((t) => t.title.trim().toLowerCase() === normalized);
            if (byTitle) return byTitle;
        }
        return null;
    }, [pmState.tasks, activeAppTaskId, activeAppTask?.name, activeIsTodoTask]);
    const linkedTaskId = linkedTask?.id ?? null;

    const inspectorTaskId = linkedTaskId ?? pmSelectedId ?? null;
    const inspectorTask = inspectorTaskId && pmState.tasks[inspectorTaskId] ? pmState.tasks[inspectorTaskId] : null;
    const metadataTask = inspectorTask ?? linkedTask ?? null;

    const pmTaskProject = metadataTask?.projectId && pmState.projects[metadataTask.projectId] ? pmState.projects[metadataTask.projectId] : null;
    const unassigned = !!metadataTask && !pmTaskProject;
    const canShowDetails = Boolean(pmSelectedId || linkedTaskId || activeAppTaskId);

    const openDetails = useCallback(() => {
        const targetId = linkedTaskId ?? pmSelectedId ?? null;
        if (targetId && targetId !== pmSelectedId) {
            setSelectedTask(targetId);
        }
        if (linkedTaskId && linkedTaskId !== pmSelectedId) {
            autoSelectedTaskRef.current = targetId;
        } else {
            autoSelectedTaskRef.current = null;
        }
        setDetailsOpen(true);
    }, [pmSelectedId, linkedTaskId, setSelectedTask]);

    const closeDetails = useCallback(() => {
        const autoId = autoSelectedTaskRef.current;
        setDetailsOpen(false);
        if (autoId && (!pmSelectedId || pmSelectedId === autoId)) {
            setSelectedTask(null);
        }
        autoSelectedTaskRef.current = null;
    }, [pmSelectedId, setSelectedTask]);

    const handleToggleDetails = useCallback(() => {
        if (detailsOpen) {
            closeDetails();
        } else {
            openDetails();
        }
    }, [detailsOpen, closeDetails, openDetails]);

    useEffect(() => {
        if (!detailsOpen) return;
        if (autoSelectedTaskRef.current && pmSelectedId && pmSelectedId !== autoSelectedTaskRef.current) {
            autoSelectedTaskRef.current = null;
        }
    }, [detailsOpen, pmSelectedId]);

    useEffect(() => {
        if (!canShowDetails && detailsOpen) {
            closeDetails();
        }
    }, [canShowDetails, detailsOpen, closeDetails]);

    useEffect(() => {
        if (!detailsOpen) return;
        if (!linkedTaskId) {
            if (autoSelectedTaskRef.current && (!pmSelectedId || pmSelectedId === autoSelectedTaskRef.current)) {
                setSelectedTask(null);
            }
            autoSelectedTaskRef.current = null;
            return;
        }
        if (pmSelectedId === linkedTaskId) {
            return;
        }
        setSelectedTask(linkedTaskId);
        autoSelectedTaskRef.current = linkedTaskId;
    }, [detailsOpen, pmSelectedId, linkedTaskId, setSelectedTask]);

    const kindBadge = timer ? (
        <span
            className={`px-2 py-1 rounded text-[10px] font-medium tracking-wide ${timer.kind === "Work" ? "bg-indigo-600/20 text-indigo-300" : "bg-emerald-600/20 text-emerald-300"} ${
                isPaused ? "animate-pulse" : ""
            }`}
        >
            {isPaused ? "PAUSED" : timer.kind.toUpperCase()}
        </span>
    ) : null;

    const taskName = activeAppTask?.name ?? metadataTask?.title ?? (timer ? "Task" : null);
    const emptyDetailsMessage = pmSelectedId || linkedTaskId || activeAppTaskId ? "Syncing task details…" : "Select or start a task to view details.";

    const finishProjections = useMemo<{ daily: FinishProjection; weekly: FinishProjection } | null>(() => {
        if (!state?.settings) return null;
        const settings = state.settings;
        const workMinutes = settings.work_minutes;
        if (!Number.isFinite(workMinutes) || workMinutes <= 0) return null;

        const backendTasks = state.tasks || {};
        const pmTasks = Object.values(pmState.tasks || {});
        const projectionStart = new Date();
        const todayKey = toLocalDateKey(projectionStart);
        const weekEndKey = getLocalWeekWindow(projectionStart).endKey;
        const workMs = workMinutes * 60000;
        const shortBreakMs = (settings.short_break_minutes || 0) * 60000;
        const longBreakMs = (settings.long_break_minutes || 0) * 60000;
        const segmentLength = Math.max(1, settings.segment_length || 1);
        const activeTimer = timer;
        const eligibleTasks: ProjectionBacklogTask[] = [];

        pmTasks.forEach((pmTask) => {
            if (pmTask.isArchived) return;
            if (pmTask.status === "Done") return;

            const backendTask = pmTask.appTaskId ? backendTasks[pmTask.appTaskId] : undefined;
            if (backendTask?.completed_at) return;
            const estimate = typeof pmTask.estimatePomos === "number" ? pmTask.estimatePomos : (backendTask?.target_pomodoros ?? 0);
            if (!Number.isFinite(estimate) || estimate <= EPSILON) return;

            let worked = backendTask?.completed_pomodoros ?? 0;
            if (pmTask.workedPomos !== undefined) {
                worked = Math.max(worked, pmTask.workedPomos);
            }

            if (activeTimer?.kind === "Work" && pmTask.appTaskId && pmTask.appTaskId === activeTimer.task_id) {
                worked = Math.max(worked, (backendTask?.completed_pomodoros ?? 0) + activeFractionComplete);
            }

            const estimatedRemaining = estimate - worked;
            const remaining = estimatedRemaining > EPSILON ? estimatedRemaining : 1;
            const projectId = pmTask.projectId && pmState.projects[pmTask.projectId] ? pmTask.projectId : null;
            eligibleTasks.push({ dueDate: pmTask.dueDate, remainingPomodoros: remaining, projectId });
        });

        const backlogs = buildProjectionBacklogs(eligibleTasks, projectionStart);

        const createProjection = (backlog: ProjectionBacklog, windowEndKey: string): FinishProjection => {
            const totalRemaining = backlog.totalPomodoros;
            if (totalRemaining <= EPSILON) return {
                hasWork: false,
                totalPomodoros: 0,
                dueTodayPomodoros: backlog.dueTodayOrOverduePomodoros,
                unscheduledPomodoros: backlog.unscheduledPomodoros,
                dueThisWeekPomodoros: backlog.dueThisWeekPomodoros,
                futureDuePomodoros: backlog.excludedFuturePomodoros,
            };

            let totalMs = 0;
            let futurePomodoros = totalRemaining;
            let cycleCount = state.current_cycle_pomodoros || 0;

            if (activeTimer) {
                if (ms > 0) totalMs += ms;
                if (activeTimer.kind === "Work") {
                    const remainingFraction = activeWorkPlannedSecs > 0 ? Math.min(1, Math.max(0, activeRemainingSecs / activeWorkPlannedSecs)) : 0;
                    futurePomodoros = Math.max(0, futurePomodoros - remainingFraction);
                    cycleCount += 1;
                    if (futurePomodoros > EPSILON) {
                        const takeLong = cycleCount >= segmentLength;
                        totalMs += takeLong ? longBreakMs : shortBreakMs;
                        if (takeLong) cycleCount = 0;
                    }
                } else if (activeTimer.kind === "LongBreak") {
                    cycleCount = 0;
                }
            }

            let future = futurePomodoros;
            while (future > EPSILON) {
                const chunk = Math.min(1, future);
                totalMs += chunk * workMs;
                future -= chunk;
                if (future > EPSILON) {
                    if (chunk >= 1 - EPSILON) {
                        cycleCount += 1;
                        const takeLong = cycleCount >= segmentLength;
                        totalMs += takeLong ? longBreakMs : shortBreakMs;
                        if (takeLong) cycleCount = 0;
                    } else {
                        totalMs += shortBreakMs;
                    }
                }
            }

            const assignedWorkloads = [...backlog.remainingByProject.entries()]
                .filter(([projectId]) => projectId !== null)
                .map(([projectId, remaining]) => ({ durationMs: totalMs * (remaining / totalRemaining), schedule: pmState.projects[projectId!] }));
            let finishDate = combinedProjectFinish(projectionStart, assignedWorkloads);
            const unassignedRemaining = backlog.remainingByProject.get(null) ?? 0;
            if (unassignedRemaining > EPSILON) {
                const unassignedFinish = addProjectedDuration(projectionStart, totalMs * (unassignedRemaining / totalRemaining), settings.end_of_day);
                if (unassignedFinish > finishDate) finishDate = unassignedFinish;
            }
            const finishDayKey = toLocalDateKey(finishDate);
            const extendsPastWindow = finishDayKey > windowEndKey;
            const dayLabelFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
            const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

            const totalMinutes = totalMs / 60000;
            const workMinutesTotal = totalRemaining * workMinutes;

            return {
                hasWork: true,
                finishDate,
                finishLabel: timeFormatter.format(finishDate),
                dayLabel: finishDayKey === todayKey ? "Today" : dayLabelFormatter.format(finishDate),
                extendsPastWindow,
                totalPomodoros: totalRemaining,
                dueTodayPomodoros: backlog.dueTodayOrOverduePomodoros,
                unscheduledPomodoros: backlog.unscheduledPomodoros,
                dueThisWeekPomodoros: backlog.dueThisWeekPomodoros,
                futureDuePomodoros: backlog.excludedFuturePomodoros,
                totalMinutes,
                workMinutes: workMinutesTotal,
                breakMinutes: Math.max(0, totalMinutes - workMinutesTotal),
            };
        };

        return {
            daily: createProjection(backlogs.daily, todayKey),
            weekly: createProjection(backlogs.weekly, weekEndKey),
        };
    }, [state?.settings, state?.tasks, state?.current_cycle_pomodoros, pmState.tasks, pmState.projects, timer, ms, tick, activeWorkPlannedSecs, activeRemainingSecs, activeFractionComplete, activeAppTaskId]);

    const activePomodoroSummary = useMemo(() => {
        if (!activeAppTaskId) return null;
        const backend = activeAppTask ?? (activeAppTaskId && state?.tasks ? state.tasks[activeAppTaskId] : null);
        const pmLinked = linkedTask && linkedTask.appTaskId === activeAppTaskId ? linkedTask : null;

        const target = (() => {
            if (pmLinked && typeof pmLinked.estimatePomos === "number") {
                return pmLinked.estimatePomos;
            }
            if (backend) return backend.target_pomodoros;
            return 0;
        })();

        if (!Number.isFinite(target) || target <= EPSILON) return null;

        const backendCompleted = backend?.completed_pomodoros ?? 0;
        let completed = backendCompleted;
        if (pmLinked && typeof pmLinked.workedPomos === "number") {
            completed = Math.max(completed, pmLinked.workedPomos);
        }

        const withActive = Math.max(0, completed, backendCompleted + activeFractionComplete);
        const remaining = Math.max(0, target - withActive);

        return {
            target,
            completed: withActive,
            remaining,
        };
    }, [activeAppTaskId, activeAppTask, state?.tasks, linkedTask, activeFractionComplete]);

    return (
        <div className="w-full min-h-full flex">
            <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 text-center select-none relative">
                <div className="flex flex-col items-center gap-6 max-w-md w-full">
                    <div className="flex flex-col items-center gap-3">
                        <div className="relative w-52 h-52 sm:w-64 sm:h-64 md:w-72 md:h-72">
                            {/* Progress ring */}
                            <div
                                className="absolute inset-0 rounded-full"
                                style={{
                                    background: timer ? `conic-gradient(#6366F1 ${pct * 100}%, #262626 ${pct * 100}%)` : "#1f2937",
                                    transition: "background 0.6s linear",
                                }}
                                aria-hidden
                            />
                            <div className="absolute inset-1.5 rounded-full bg-neutral-950 border border-neutral-800 flex items-center justify-center">
                                <span className="text-4xl sm:text-5xl md:text-6xl font-semibold tabular-nums tracking-tight">{timer ? formatMs(ms) : "READY"}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-center">
                            {kindBadge}
                            {taskName && (
                                <span className="px-2 py-1 rounded bg-neutral-800 text-[10px] max-w-55 truncate" title={taskName}>
                                    {taskName}
                                </span>
                            )}
                            {pmTaskProject && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 text-[10px]">
                                    <span className="w-2 h-2 rounded-full" style={{ background: pmTaskProject.color }} />
                                    {pmTaskProject.name}
                                </span>
                            )}
                            {unassigned && <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 text-[10px]">No Project</span>}
                            {canShowDetails && (
                                <button
                                    className={`px-3 py-2 sm:px-2 sm:py-1 rounded border border-neutral-700 text-[10px] uppercase tracking-wide transition-colors ${
                                        detailsOpen ? "bg-neutral-800" : "bg-neutral-900/60 hover:bg-neutral-800/70"
                                    }`}
                                    onMouseEnter={() => play("hover")}
                                    onClick={() => {
                                        handleToggleDetails();
                                        play("pressSide");
                                    }}
                                    aria-expanded={detailsOpen}
                                    aria-controls="timer-task-details-panel"
                                >
                                    {detailsOpen ? "Hide Details" : "Task Details"}
                                </button>
                            )}
                            {!timer && !taskName && <span className="text-[10px] text-neutral-500">Select or create a task</span>}
                        </div>
                        {error && <div className="text-red-400 text-[10px] font-medium">{error}</div>}
                        {timer && (
                            <div className="text-[10px] text-neutral-500">
                                {/* Show elapsed/planned minutes */}
                                {Math.round(elapsedSecs / 60)}m / {Math.round(plannedSecs / 60)}m
                            </div>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center text-xs">
                        {!timer && (
                            <button
                                className="px-5 py-2.5 sm:px-4 sm:py-2 rounded bg-indigo-600 hover:bg-indigo-500 transition-colors font-medium text-white shadow-sm"
                                onMouseEnter={() => play("hover")}
                                onClick={() => {
                                    startWork();
                                    play("startPomodoro");
                                }}
                            >
                                Start Focus
                            </button>
                        )}
                        {timer && !isPaused && ms > 0 && (
                            <button
                                className="px-4 py-2.5 sm:px-3 sm:py-2 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors"
                                onMouseEnter={() => play("hover")}
                                onClick={() => {
                                    pauseTimer();
                                    play("pressSide");
                                }}
                            >
                                Pause
                            </button>
                        )}
                        {timer && isPaused && (
                            <button
                                className="px-4 py-2.5 sm:px-3 sm:py-2 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors"
                                onMouseEnter={() => play("hover")}
                                onClick={() => {
                                    resumeTimer();
                                    play("pressSide");
                                }}
                            >
                                Resume
                            </button>
                        )}
                        {timer && ms === 0 && <span className="text-emerald-400 text-xs font-medium">Transitioning...</span>}
                        {timer && !isPaused && timer.kind === "Work" && ms > 0 && (
                            <button
                                className="px-4 py-2.5 sm:px-3 sm:py-2 rounded bg-amber-600/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
                                onMouseEnter={() => play("hover")}
                                onClick={() => {
                                    stopWork();
                                    play("pressSide");
                                }}
                            >
                                Stop Early
                            </button>
                        )}
                        {isBreak && timer && ms > 0 && !isPaused && (
                            <button
                                className="px-4 py-2.5 sm:px-3 sm:py-2 rounded bg-emerald-600/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                                onMouseEnter={() => play("hover")}
                                onClick={() => {
                                    skipBreak();
                                    play("pressSide");
                                }}
                            >
                                Skip Break
                            </button>
                        )}
                    </div>
                    {activePomodoroSummary && (
                        <div className="w-full text-[11px] text-neutral-400 bg-neutral-900/50 border border-neutral-800 rounded-md px-3 py-2">
                            Focus progress: <span className="text-neutral-200 font-medium">{formatPomodoroCount(activePomodoroSummary.completed)}</span> done ·
                            <span className="text-neutral-200 font-medium"> {formatPomodoroCount(activePomodoroSummary.remaining)}</span> left
                            <span className="text-neutral-600"> (goal {formatPomodoroCount(activePomodoroSummary.target)})</span>
                        </div>
                    )}
                    {finishProjections && (
                        <ProjectionSwitcher projections={finishProjections} />
                    )}
                    {/* Accessible linear progress */}
                    {/* Removed redundant bottom progress bar */}
                </div>
            </div>
            {detailsOpen && (
                <div
                    className="md:hidden fixed inset-0 z-30 bg-black/50"
                    onClick={closeDetails}
                    aria-hidden
                />
            )}
            <aside
                className={
                    "overflow-hidden bg-neutral-950/95 backdrop-blur " +
                    "md:relative md:z-auto md:self-stretch md:translate-x-0 md:transition-[width] md:duration-200 md:ease-out " +
                    (detailsOpen ? "md:w-80 md:border-l md:border-neutral-800 " : "md:w-0 md:pointer-events-none ") +
                    "max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-[min(20rem,100vw)] max-md:shadow-2xl max-md:transition-transform max-md:duration-200 max-md:ease-out " +
                    (detailsOpen ? "max-md:translate-x-0" : "max-md:translate-x-full max-md:pointer-events-none")
                }
                id="timer-task-details-panel"
                aria-hidden={!detailsOpen}
            >
                {detailsOpen && (
                    <div className="flex flex-col h-full min-h-0">
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800 bg-neutral-900/40">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Task details</span>
                            <button
                                className="text-[10px] px-2.5 py-1.5 rounded bg-neutral-800 text-neutral-200 hover:bg-neutral-700 transition-colors"
                                onMouseEnter={() => play("hover")}
                                onClick={() => {
                                    closeDetails();
                                    play("pressSide");
                                }}
                                title="Close details"
                            >
                                Close
                            </button>
                        </div>
                        {unassigned && (
                            <div className="px-4 py-2 text-[10px] leading-relaxed bg-amber-500/10 text-amber-200 border-b border-amber-500/30">
                                This task isn't assigned to a project yet. Use the selector below to organize it or keep it standalone.
                            </div>
                        )}
                        <div className="flex-1 min-h-0 overflow-y-auto app-scrollbar">
                            {inspectorTask ? (
                                <TaskInspector key={inspectorTask.id} />
                            ) : (
                                <div className="h-full flex items-center justify-center px-6 text-[11px] text-neutral-500">{emptyDetailsMessage}</div>
                            )}
                        </div>
                    </div>
                )}
            </aside>
        </div>
    );
};

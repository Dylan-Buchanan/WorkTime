import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../state/AppStateContext";
import { useSounds } from "../hooks/useSounds";
import { usePM } from "../state/ProjectManagerContext";
import { TaskInspector } from "./ProjectManager/TaskInspector";

function format(ms: number) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60)
        .toString()
        .padStart(2, "0");
    const s = (total % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

const EPSILON = 1e-3;

type FinishProjection =
    | {
          hasWork: true;
          finishDate: Date;
          finishLabel: string;
          dayLabel: string;
          extendsPastToday: boolean;
          totalPomodoros: number;
          dueTodayPomodoros: number;
          unscheduledPomodoros: number;
          totalMinutes: number;
          workMinutes: number;
          breakMinutes: number;
      }
    | {
          hasWork: false;
          totalPomodoros: number;
          dueTodayPomodoros: number;
          unscheduledPomodoros: number;
      };

function toLocalDateKey(date: Date) {
    const offset = date.getTimezoneOffset();
    const adjusted = new Date(date.getTime() - offset * 60000);
    return adjusted.toISOString().slice(0, 10);
}

function parseDueDateKey(raw?: string | null) {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return toLocalDateKey(parsed);
}

function formatPomodoroCount(value: number) {
    if (!Number.isFinite(value) || value <= EPSILON) return "0p";
    if (Math.abs(value - Math.round(value)) < 0.05) {
        return `${Math.round(value)}p`;
    }
    return `${value.toFixed(1)}p`;
}

function formatDurationMinutes(totalMinutes: number) {
    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0m";
    const rounded = Math.max(1, Math.round(totalMinutes));
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
}

export const TimerPanel: React.FC = () => {
    const app = useAppState();
    const { state, startWork, skipBreak, remainingMs, error, pauseTimer, resumeTimer, isPaused, tick } = app;
    const stopWork = app.stopWork; // preserve existing functionality
    const { play } = useSounds();
    const { state: pmState, setSelectedTask } = usePM();
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
    const elapsedSecs = useMemo(() => {
        if (!timer) return 0;
        const accumulated = timer.accumulated_secs || 0;
        if (timer.paused) {
            return accumulated; // when paused, current segment not running
        }
        const start = new Date(timer.started_at).getTime();
        const now = Date.now();
        return Math.min(plannedSecs, accumulated + Math.max(0, now - start) / 1000);
    }, [timer, plannedSecs, timer?.paused, timer?.accumulated_secs, timer?.started_at, tick]);

    const pct = plannedSecs > 0 ? Math.min(1, Math.max(0, elapsedSecs / plannedSecs)) : 0;

    const activeAppTaskId = timer?.task_id ?? state?.active_task ?? null;
    const activeAppTask = activeAppTaskId ? state?.tasks[activeAppTaskId] : null;

    const linkedTask = useMemo(() => {
        if (!activeAppTaskId) return null;
        const tasks = Object.values(pmState.tasks);
        const linked = tasks.find((t) => t.appTaskId === activeAppTaskId);
        if (linked) return linked;
        if (activeAppTask?.name) {
            const normalized = activeAppTask.name.trim().toLowerCase();
            const byTitle = tasks.find((t) => t.title.trim().toLowerCase() === normalized);
            if (byTitle) return byTitle;
        }
        return null;
    }, [pmState.tasks, activeAppTaskId, activeAppTask?.name]);
    const linkedTaskId = linkedTask?.id ?? null;

    const inspectorTaskId = pmSelectedId ?? linkedTaskId ?? null;
    const inspectorTask = inspectorTaskId && pmState.tasks[inspectorTaskId] ? pmState.tasks[inspectorTaskId] : null;
    const metadataTask = inspectorTask ?? linkedTask ?? null;

    const pmTaskProject = metadataTask?.projectId && pmState.projects[metadataTask.projectId] ? pmState.projects[metadataTask.projectId] : null;
    const unassigned = !!metadataTask && !pmTaskProject;
    const canShowDetails = Boolean(pmSelectedId || linkedTaskId || activeAppTaskId);

    const openDetails = useCallback(() => {
        const targetId = pmSelectedId ?? linkedTaskId ?? null;
        if (targetId && targetId !== pmSelectedId) {
            setSelectedTask(targetId);
        }
        if (!pmSelectedId && targetId) {
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
            autoSelectedTaskRef.current = linkedTaskId;
            return;
        }
        if (!pmSelectedId || autoSelectedTaskRef.current) {
            setSelectedTask(linkedTaskId);
            autoSelectedTaskRef.current = linkedTaskId;
        }
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

    const finishProjection = useMemo<FinishProjection | null>(() => {
        if (!state?.settings) return null;
        const settings = state.settings;
        const workMinutes = settings.work_minutes;
        if (!Number.isFinite(workMinutes) || workMinutes <= 0) return null;

        const backendTasks = state.tasks || {};
        const pmTasks = Object.values(pmState.tasks || {});
        if (pmTasks.length === 0) {
            return {
                hasWork: false,
                totalPomodoros: 0,
                dueTodayPomodoros: 0,
                unscheduledPomodoros: 0,
            };
        }

        const todayKey = toLocalDateKey(new Date());
        const workMs = workMinutes * 60000;
        const shortBreakMs = (settings.short_break_minutes || 0) * 60000;
        const longBreakMs = (settings.long_break_minutes || 0) * 60000;
        const segmentLength = Math.max(1, settings.segment_length || 1);

        const activeTimer = timer;

        let totalRemaining = 0;
        let dueTodayRemaining = 0;
        let unscheduledRemaining = 0;

        pmTasks.forEach((pmTask) => {
            if (pmTask.isArchived) return;
            if (pmTask.status === "Done") return;

            const backendTask = pmTask.appTaskId ? backendTasks[pmTask.appTaskId] : undefined;
            if (backendTask?.completed_at) return;
            const estimate = typeof pmTask.estimatePomos === "number" ? pmTask.estimatePomos : backendTask?.target_pomodoros ?? 0;
            if (!Number.isFinite(estimate) || estimate <= EPSILON) return;

            let worked = backendTask?.completed_pomodoros ?? 0;
            if (pmTask.workedPomos !== undefined) {
                worked = Math.max(worked, pmTask.workedPomos);
            }

            if (activeTimer?.kind === "Work" && pmTask.appTaskId && pmTask.appTaskId === activeTimer.task_id) {
                worked = Math.max(worked, (backendTask?.completed_pomodoros ?? 0) + activeFractionComplete);
            }

            const remaining = Math.max(0, estimate - worked);
            if (remaining <= EPSILON) return;

            const dueKey = parseDueDateKey(pmTask.dueDate);
            const include = !dueKey || dueKey <= todayKey; // include tasks with no due date or due today/overdue
            if (!include) return;

            if (dueKey) {
                dueTodayRemaining += remaining;
            } else {
                unscheduledRemaining += remaining;
            }
            totalRemaining += remaining;
        });

        if (totalRemaining <= EPSILON) {
            return {
                hasWork: false,
                totalPomodoros: 0,
                dueTodayPomodoros: dueTodayRemaining,
                unscheduledPomodoros: unscheduledRemaining,
            };
        }

        let totalMs = 0;
        let futurePomodoros = totalRemaining;
        let cycleCount = state.current_cycle_pomodoros || 0;

        if (activeTimer) {
            if (ms > 0) {
                totalMs += ms;
            }
            if (activeTimer.kind === "Work") {
                const remainingFraction = activeWorkPlannedSecs > 0 ? Math.min(1, Math.max(0, activeRemainingSecs / activeWorkPlannedSecs)) : 0;
                futurePomodoros = Math.max(0, futurePomodoros - remainingFraction);
                cycleCount += 1;
                if (futurePomodoros > EPSILON) {
                    const takeLong = cycleCount >= segmentLength;
                    totalMs += takeLong ? longBreakMs : shortBreakMs;
                    if (takeLong) {
                        cycleCount = 0;
                    }
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
            const hasMore = future > EPSILON;
            if (hasMore) {
                const countsAsFull = chunk >= 1 - EPSILON;
                if (countsAsFull) {
                    cycleCount += 1;
                    const takeLong = cycleCount >= segmentLength;
                    totalMs += takeLong ? longBreakMs : shortBreakMs;
                    if (takeLong) {
                        cycleCount = 0;
                    }
                } else {
                    totalMs += shortBreakMs;
                }
            }
        }

        const finishDate = new Date(Date.now() + totalMs);
        const finishDayKey = toLocalDateKey(finishDate);
        const extendsPastToday = finishDayKey !== todayKey;
        const dayLabelFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
        const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

        const totalMinutes = totalMs / 60000;
        const workMinutesTotal = totalRemaining * workMinutes;
        const breakMinutesTotal = Math.max(0, totalMinutes - workMinutesTotal);

        return {
            hasWork: true,
            finishDate,
            finishLabel: timeFormatter.format(finishDate),
            dayLabel: extendsPastToday ? dayLabelFormatter.format(finishDate) : "Today",
            extendsPastToday,
            totalPomodoros: totalRemaining,
            dueTodayPomodoros: dueTodayRemaining,
            unscheduledPomodoros: unscheduledRemaining,
            totalMinutes,
            workMinutes: workMinutesTotal,
            breakMinutes: breakMinutesTotal,
        };
    }, [state?.settings, state?.tasks, state?.current_cycle_pomodoros, pmState.tasks, timer, ms, tick, activeWorkPlannedSecs, activeRemainingSecs, activeFractionComplete, activeAppTaskId]);

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

        let completed = backend?.completed_pomodoros ?? 0;
        if (pmLinked && typeof pmLinked.workedPomos === "number") {
            completed = Math.max(completed, pmLinked.workedPomos);
        }

        const withActive = Math.min(target, Math.max(0, completed + activeFractionComplete));
        const remaining = Math.max(0, target - withActive);

        return {
            target,
            completed: withActive,
            remaining,
        };
    }, [activeAppTaskId, activeAppTask, state?.tasks, linkedTask, activeFractionComplete]);

    return (
        <div className="w-full h-full flex">
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none relative">
                <div className="flex flex-col items-center gap-6 max-w-md w-full">
                    <div className="flex flex-col items-center gap-3">
                        <div className="relative w-72 h-72">
                            {/* Progress ring */}
                            <div
                                className="absolute inset-0 rounded-full"
                                style={{
                                    background: timer ? `conic-gradient(#6366F1 ${pct * 100}%, #262626 ${pct * 100}%)` : "#1f2937",
                                    transition: "background 0.6s linear",
                                }}
                                aria-hidden
                            />
                            <div className="absolute inset-[6px] rounded-full bg-neutral-950 border border-neutral-800 flex items-center justify-center">
                                <span className="text-6xl font-semibold tabular-nums tracking-tight">{timer ? format(ms) : "READY"}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-center">
                            {kindBadge}
                            {taskName && (
                                <span className="px-2 py-1 rounded bg-neutral-800 text-[10px] max-w-[220px] truncate" title={taskName}>
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
                                    className={`px-2 py-1 rounded border border-neutral-700 text-[10px] uppercase tracking-wide transition-colors ${
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
                                className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 transition-colors font-medium text-white shadow-sm"
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
                                className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors"
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
                                className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors"
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
                                className="px-3 py-2 rounded bg-amber-600/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
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
                                className="px-3 py-2 rounded bg-emerald-600/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
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
                    {timer && activePomodoroSummary && (
                        <div className="w-full text-[11px] text-neutral-400 bg-neutral-900/50 border border-neutral-800 rounded-md px-3 py-2">
                            Focus progress: <span className="text-neutral-200 font-medium">{formatPomodoroCount(activePomodoroSummary.completed)}</span> done ·
                            <span className="text-neutral-200 font-medium"> {formatPomodoroCount(activePomodoroSummary.remaining)}</span> left
                            <span className="text-neutral-600"> (goal {formatPomodoroCount(activePomodoroSummary.target)})</span>
                        </div>
                    )}
                    {finishProjection && (
                        <div className="w-full">
                            {finishProjection.hasWork ? (
                                <div className="w-full bg-neutral-900/70 border border-neutral-800 rounded-lg px-4 py-3 text-left shadow-sm">
                                    <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-neutral-500">
                                        <span className="font-medium text-neutral-300">Projected finish</span>
                                        <span>{finishProjection.dayLabel}</span>
                                    </div>
                                    <div className="mt-1 text-2xl font-semibold text-neutral-100">{finishProjection.finishLabel}</div>
                                    <div className="mt-2 text-[11px] text-neutral-400">
                                        ~{formatDurationMinutes(finishProjection.totalMinutes)} remaining
                                        <span className="text-neutral-600"> · </span>
                                        Focus {formatDurationMinutes(finishProjection.workMinutes)}
                                        <span className="text-neutral-600"> + </span>
                                        Breaks {formatDurationMinutes(finishProjection.breakMinutes)}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-neutral-500">
                                        {finishProjection.dueTodayPomodoros > EPSILON && <span>Due today/overdue: {formatPomodoroCount(finishProjection.dueTodayPomodoros)}</span>}
                                        {finishProjection.unscheduledPomodoros > EPSILON && <span>No due date: {formatPomodoroCount(finishProjection.unscheduledPomodoros)}</span>}
                                    </div>
                                    {finishProjection.extendsPastToday && <div className="mt-2 text-[10px] text-amber-300/90">May spill into tomorrow—consider reprioritizing.</div>}
                                </div>
                            ) : (
                                <div className="w-full bg-emerald-600/10 border border-emerald-500/30 text-emerald-200 rounded-lg px-4 py-3 text-left text-[12px]">
                                    You're all caught up for today. Great work!
                                </div>
                            )}
                        </div>
                    )}
                    {/* Accessible linear progress */}
                    {/* Removed redundant bottom progress bar */}
                </div>
            </div>
            <aside
                className={`h-full will-change-[width] transition-[width] duration-200 ease-out overflow-hidden bg-neutral-950/90 backdrop-blur ${
                    detailsOpen ? "w-80 border-l border-neutral-800" : "w-0 pointer-events-none"
                }`}
                id="timer-task-details-panel"
                aria-hidden={!detailsOpen}
            >
                {detailsOpen && (
                    <div className="flex flex-col h-full">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 text-[11px] uppercase tracking-wide">
                            <span className="font-medium text-neutral-300">Task details</span>
                            <button
                                className="text-[10px] px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
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
                            <div className="px-3 py-2 text-[10px] bg-amber-500/10 text-amber-200 border-b border-amber-500/30">
                                This task isn't assigned to a project yet. Use the selector below to organize it or keep it standalone.
                            </div>
                        )}
                        <div className="flex-1 min-h-0 overflow-hidden">
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

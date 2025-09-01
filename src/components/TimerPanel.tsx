import React, { useMemo } from "react";
import { useAppState } from "../state/AppStateContext";
import { useSounds } from "../hooks/useSounds";

function format(ms: number) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60)
        .toString()
        .padStart(2, "0");
    const s = (total % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

export const TimerPanel: React.FC = () => {
    const {
        state,
        startWork,
        skipBreak,
        remainingMs,
        error,
        pauseTimer,
        resumeTimer,
        isPaused,
        tick,
    } = useAppState();
    const stopWork = useAppState().stopWork; // preserve existing functionality
    const { play } = useSounds();
    const timer = state?.timer;
    const ms = remainingMs();
    const isBreak = timer && timer.kind !== "Work";

    // Planned total (stable) from backend; fallback to computed if missing
    const plannedSecs =
        timer?.planned_secs ||
        (timer
            ? (new Date(timer.ends_at).getTime() -
                  new Date(timer.started_at).getTime()) /
              1000
            : 0);

    // Elapsed seconds including accumulated (if paused/resumed) + current run segment
    const elapsedSecs = useMemo(() => {
        if (!timer) return 0;
        const accumulated = timer.accumulated_secs || 0;
        if (timer.paused) {
            return accumulated; // when paused, current segment not running
        }
        const start = new Date(timer.started_at).getTime();
        const now = Date.now();
        return Math.min(
            plannedSecs,
            accumulated + Math.max(0, now - start) / 1000
        );
    }, [
        timer,
        plannedSecs,
        timer?.paused,
        timer?.accumulated_secs,
        timer?.started_at,
        tick,
    ]);

    const pct =
        plannedSecs > 0
            ? Math.min(1, Math.max(0, elapsedSecs / plannedSecs))
            : 0;

    const kindBadge = timer ? (
        <span
            className={`px-2 py-1 rounded text-[10px] font-medium tracking-wide ${
                timer.kind === "Work"
                    ? "bg-indigo-600/20 text-indigo-300"
                    : "bg-emerald-600/20 text-emerald-300"
            } ${isPaused ? "animate-pulse" : ""}`}
        >
            {isPaused ? "PAUSED" : timer.kind.toUpperCase()}
        </span>
    ) : null;

    const taskName = timer
        ? state?.tasks[timer.task_id]?.name || "Task"
        : state?.active_task
        ? state.tasks[state.active_task].name
        : null;

    return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center select-none">
            <div className="flex flex-col items-center gap-6 max-w-md w-full">
                <div className="flex flex-col items-center gap-3">
                    <div className="relative w-72 h-72">
                        {/* Progress ring */}
                        <div
                            className="absolute inset-0 rounded-full"
                            style={{
                                background: timer
                                    ? `conic-gradient(#6366F1 ${
                                          pct * 100
                                      }%, #262626 ${pct * 100}%)`
                                    : "#1f2937",
                                transition: "background 0.6s linear",
                            }}
                            aria-hidden
                        />
                        <div className="absolute inset-[6px] rounded-full bg-neutral-950 border border-neutral-800 flex items-center justify-center">
                            <span className="text-6xl font-semibold tabular-nums tracking-tight">
                                {timer ? format(ms) : "READY"}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-center">
                        {kindBadge}
                        {taskName && (
                            <span
                                className="px-2 py-1 rounded bg-neutral-800 text-[10px] max-w-[220px] truncate"
                                title={taskName}
                            >
                                {taskName}
                            </span>
                        )}
                        {!timer && !taskName && (
                            <span className="text-[10px] text-neutral-500">
                                Select or create a task
                            </span>
                        )}
                    </div>
                    {error && (
                        <div className="text-red-400 text-[10px] font-medium">
                            {error}
                        </div>
                    )}
                    {timer && (
                        <div className="text-[10px] text-neutral-500">
                            {/* Show elapsed/planned minutes */}
                            {Math.round(elapsedSecs / 60)}m /{" "}
                            {Math.round(plannedSecs / 60)}m
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
                    {timer && ms === 0 && (
                        <span className="text-emerald-400 text-xs font-medium">
                            Transitioning...
                        </span>
                    )}
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
                {/* Accessible linear progress */}
                {/* Removed redundant bottom progress bar */}
            </div>
        </div>
    );
};

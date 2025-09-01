import React from "react";
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
    } = useAppState();
    const timer = state?.timer;
    const { play } = useSounds();
    const stopWork = useAppState().stopWork; // Added stopWork
    const ms = remainingMs();
    const isBreak = timer && timer.kind !== "Work";
    return (
        <div style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: 96, margin: 0 }}>
                {timer ? format(ms) : "Ready"}
            </h1>
            <p>
                {timer
                    ? `${timer.kind} (${
                          state?.tasks[timer.task_id]?.name || "Task"
                      })`
                    : state?.active_task
                    ? `Ready: ${state.tasks[state.active_task].name}`
                    : "Select or create a task"}
            </p>
            {error && (
                <div style={{ color: "#ff6b6b", fontSize: 12 }}>{error}</div>
            )}
            {timer && ms > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                    Ends at{" "}
                    {new Date(state!.timer!.ends_at).toLocaleTimeString()}
                </div>
            )}
            <div
                style={{
                    display: "flex",
                    gap: 8,
                    justifyContent: "center",
                    flexWrap: "wrap",
                }}
            >
                {!timer && (
                    <button
                        onMouseEnter={() => play("hover")}
                        onClick={() => {
                            startWork();
                            play("startPomodoro");
                        }}
                    >
                        Start Work
                    </button>
                )}
                {timer && !isPaused && ms > 0 && (
                    <button
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
                    <span style={{ fontSize: 14, color: "#4caf50" }}>
                        Transitioning...
                    </span>
                )}
                {timer && !isPaused && timer.kind === "Work" && ms > 0 && (
                    <button
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
        </div>
    );
};

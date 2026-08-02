import type { ActiveTimer, AppStateData } from "../../state/types";
import {
    appendLog,
    cloneAppState,
    EngineError,
    EngineResult,
} from "./core";

/** Rust: pause_timer */
export function pauseTimer(state: AppStateData, now: Date): EngineResult<ActiveTimer> {
    const next = cloneAppState(state);
    const timer = next.timer;
    if (!timer) throw new EngineError("No active timer");
    if (timer.paused) throw new EngineError("Already paused");
    if (now.getTime() >= new Date(timer.ends_at).getTime()) throw new EngineError("Timer already finished");

    const segmentElapsed = Math.max(0, Math.trunc((now.getTime() - new Date(timer.started_at).getTime()) / 1000));
    timer.accumulated_secs = (timer.accumulated_secs ?? 0) + segmentElapsed;
    const remaining = timer.planned_secs && timer.planned_secs > 0
        ? Math.max(0, timer.planned_secs - timer.accumulated_secs)
        : Math.max(0, Math.trunc((new Date(timer.ends_at).getTime() - now.getTime()) / 1000));
    timer.paused = true;
    timer.paused_remaining_secs = remaining;
    return { state: next, value: { ...timer } };
}

/** Rust: resume_timer */
export function resumeTimer(state: AppStateData, now: Date): EngineResult<ActiveTimer> {
    const next = cloneAppState(state);
    const timer = next.timer;
    if (!timer) throw new EngineError("No active timer");
    if (!timer.paused) throw new EngineError("Timer not paused");

    const remaining = timer.paused_remaining_secs ?? 0;
    timer.paused = false;
    timer.started_at = now.toISOString();
    timer.ends_at = new Date(now.getTime() + remaining * 1000).toISOString();
    timer.paused_remaining_secs = 0;
    return { state: next, value: { ...timer } };
}

/** Rust: skip_break */
export function skipBreak(state: AppStateData, now: Date, logId: string): EngineResult<AppStateData> {
    const next = cloneAppState(state);
    const timer = next.timer;
    if (!timer) throw new EngineError("No active break");
    if (timer.kind === "Work") throw new EngineError("Not on a break");

    const task = next.tasks[timer.task_id];
    if (task) task.break_skips += 1;
    appendLog(next, timer.task_id, 0, now, true, logId, true);
    next.timer = null;
    return { state: next, value: cloneAppState(next) };
}

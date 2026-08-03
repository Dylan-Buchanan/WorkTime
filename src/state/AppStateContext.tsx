import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AppStateData, Settings, Task, TimerKind, ActiveTimer } from "./types";
import { useSounds } from "../hooks/useSounds";
import { computeRemainingMs } from "../lib/timer";
import { useData } from "./DataContext";
import { useSync } from "./SyncContext";
import type { EngineResult } from "../lib/engine";
import type { ReconciledTimer } from "../lib/data/DataAccess";

let notify: ((opts: { title: string; body?: string }) => void) | null = null;
export function resetNotifyForTesting(): void {
    notify = null;
}
async function ensureNotification() {
    if (notify) return;
    try {
        const mod: any = await import("@tauri-apps/plugin-notification");
        if (mod) {
            if (mod.isPermissionGranted && !(await mod.isPermissionGranted())) await mod.requestPermission?.();
            notify = (opts) => mod.sendNotification?.(opts);
        }
    } catch {
        if (typeof window !== "undefined" && "Notification" in window) {
            try {
                if ((window as any).Notification?.permission === "default") await (window as any).Notification.requestPermission?.();
                if ((window as any).Notification?.permission === "granted") notify = ({ title, body }) => new (window as any).Notification(title, { body });
            } catch { /* notifications are optional */ }
        }
    }
}

interface AppContextShape {
    state: AppStateData | null;
    refresh: () => Promise<AppStateData>;
    createTask: (name: string, target: number) => Promise<Task>;
    setActiveTask: (id: string) => Promise<void>;
    startWork: () => Promise<void>;
    startBreak: () => Promise<void>;
    completeTimer: () => Promise<void>;
    stopWork: () => Promise<void>;
    skipBreak: () => Promise<void>;
    updateSettings: (s: Settings) => Promise<void>;
    remainingMs: () => number;
    error: string | null;
    finalizeTask: (id: string) => Promise<void>;
    pauseTimer: () => void;
    resumeTimer: () => void;
    isPaused: boolean;
    tick: number;
    resetAll: () => Promise<void>;
}

const AppStateContext = createContext<AppContextShape | undefined>(undefined);

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const data = useData();
    // SyncProvider owns the bootstrap/focus/visibility lifecycle triggers. This
    // provider only consumes the revision so it can re-read its staged local
    // view after any same-tab or cross-tab write.
    const { revision } = useSync();
    const [state, setState] = useState<AppStateData | null>(null);
    const [tick, setTick] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const progressing = useRef(false);
    const stateRef = useRef<AppStateData | null>(null);
    const queuedReconciliationRef = useRef<{ timer: ReconciledTimer; state: AppStateData } | null>(null);
    let soundApi: { play: (k: any) => void } | null = null;
    try { soundApi = useSounds(); } catch { /* optional sound setup */ }
    stateRef.current = state;

    // Same-tab commands already adopt their staged result, so the revision
    // effect's follow-up fetch usually returns an identical view. Skip the
    // redundant setState (and its extra render) while still returning the fresh
    // clone for progression/reconciliation callers.
    const fetchAndSetState = useCallback(async () => {
        const result = await data.fetchState();
        setState((current) => {
            if (current && JSON.stringify(current) === JSON.stringify(result.state)) return current;
            return result.state;
        });
        return result;
    }, [data]);

    const maybeNotifyTimerEnd = useCallback(async (kind: TimerKind, taskId?: string) => {
        try {
            const hidden = typeof document !== "undefined" ? document.hidden : false;
            const hasFocus = typeof document !== "undefined" && typeof document.hasFocus === "function" ? document.hasFocus() : !hidden;
            if (!hidden && hasFocus) return;
            await ensureNotification();
            if (!notify) return;
            if (kind === "Work") {
                const taskName = taskId && stateRef.current?.tasks[taskId]?.name;
                notify({ title: "Pomodoro Complete", body: taskName ? `Finished: ${taskName}` : "Time for a break" });
            } else notify({ title: "Break Over", body: "Time to focus" });
        } catch { /* notifications are optional */ }
    }, []);

    const runProgression = useCallback(async (finishedTimer?: ActiveTimer, reconciliation?: { timer: ReconciledTimer; state: AppStateData }) => {
        if (progressing.current) return;
        progressing.current = true;
        try {
            let applied = true;
            let after: AppStateData;
            if (reconciliation) {
                after = reconciliation.state;
                applied = reconciliation.timer.applied;
            } else {
                if (!finishedTimer) return;
                const completion = await data.completeTimer(finishedTimer);
                applied = completion.applied;
                after = completion.state;
            }

            if (applied) {
                soundApi?.play(finishedTimer?.kind === "Work" || reconciliation?.timer.kind === "Work" ? "pomodoroFinish" : "breakOver");
                const kind = finishedTimer?.kind ?? reconciliation?.timer.kind;
                const taskId = finishedTimer?.task_id ?? reconciliation?.timer.taskId;
                if (kind) await maybeNotifyTimerEnd(kind, taskId);
            } else {
                // A race loser must adopt the winner's state before deciding whether to start a timer.
                after = (await fetchAndSetState()).state;
            }
            setState(after);

            if (!after.timer) {
                const kind = finishedTimer?.kind ?? reconciliation?.timer.kind;
                if (kind === "Work") {
                    try {
                        const started = await data.startBreakTimer();
                        setState(started.state);
                    } catch (err) { console.warn("Failed to auto-start break timer", err); }
                } else if (after.active_task) {
                    try {
                        const started = await data.startWorkTimer();
                        setState(started.state);
                    } catch (err) { console.warn("Failed to auto-start work timer", err); }
                }
            }
            // A storage/sync revision arriving mid-progression may have left
            // another expired timer to reconcile. Capture it from the local
            // store so the guard below replays it instead of starting a second
            // progression loop.
            const final = await fetchAndSetState();
            if (final.reconciledTimer) queuedReconciliationRef.current = { timer: final.reconciledTimer, state: final.state };
        } catch (err: any) {
            setError(err?.message || err?.toString?.() || "Unknown error");
        } finally {
            progressing.current = false;
            const queued = queuedReconciliationRef.current;
            queuedReconciliationRef.current = null;
            if (queued) void runProgression(undefined, queued);
        }
    }, [data, fetchAndSetState, maybeNotifyTimerEnd]);

    const refresh = useCallback(async (): Promise<AppStateData> => {
        try {
            setError(null);
            const result = await fetchAndSetState();
            if (result.reconciledTimer) await runProgression(undefined, { timer: result.reconciledTimer, state: result.state });
            return result.state;
        } catch (err: any) {
            setError(err?.message || err?.toString?.() || "Unknown error");
            throw err;
        }
    }, [fetchAndSetState, runProgression]);

    // Read the staged local view on mount and after every same-tab or cross-tab
    // write (revision bump). SyncProvider owns the focus/visibility/pagehide
    // triggers, so this provider never registers them.
    useEffect(() => {
        void refresh().catch(() => undefined);
    }, [refresh, revision]);

    useEffect(() => {
        const id = setInterval(() => setTick((value) => value + 1), 1000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        const timer = state?.timer;
        if (!timer || timer.paused || new Date(timer.ends_at).getTime() > Date.now()) return;
        void runProgression(timer);
    }, [state?.timer, tick, runProgression]);

    useEffect(() => { void ensureNotification(); }, []);

    // Runs a local command and adopts its EngineResult state directly. No
    // follow-up fetch and no sync call: the staged result is the new view.
    // Errors leave React state untouched (last persisted state stays visible)
    // and surface in `error`.
    const adoptResult = async (run: () => Promise<EngineResult<unknown>>) => {
        try {
            setError(null);
            const result = await run();
            setState(result.state);
        } catch (err: any) {
            setError(err?.message || err?.toString?.() || "Unknown error");
        }
    };

    const createTask = async (name: string, target: number) => {
        try {
            setError(null);
            const result = await data.createTask(name, target);
            setState(result.state);
            return result.value;
        } catch (err: any) {
            setError(err?.message || err?.toString?.() || "Unknown error");
            throw err;
        }
    };

    const setActiveTask = (id: string) => adoptResult(() => data.setActiveTask(id));
    const ensureActiveTask = async () => {
        if (!state?.active_task) {
            const tasks = Object.values(state?.tasks || {}).filter((task) => !task.archived);
            if (tasks.length === 1) await data.setActiveTask(tasks[0].id);
            else if (tasks.length === 0) throw new Error("Create a task first");
            else throw new Error("Select a task first");
        }
    };
    const startWork = async () => { try { await ensureActiveTask(); await adoptResult(() => data.startWorkTimer()); } catch (err: any) { setError(err?.message || err?.toString?.() || "Unknown error"); } };
    const startBreak = async () => { try { await ensureActiveTask(); await adoptResult(() => data.startBreakTimer()); } catch (err: any) { setError(err?.message || err?.toString?.() || "Unknown error"); } };

    const completeTimer = async () => {
        const captured = state?.timer;
        if (!captured) return;
        await runProgression(captured);
    };
    const stopWork = () => adoptResult(() => data.stopWorkTimer());
    const skipBreak = () => adoptResult(() => data.skipBreak());
    const updateSettings = (settings: Settings) => adoptResult(() => data.updateSettings(settings));
    const finalizeTask = (id: string) => adoptResult(() => data.finalizeTask(id));
    const pauseTimer = () => { if (state?.timer && !state.timer.paused) void adoptResult(() => data.pauseTimer()); };
    const resumeTimer = () => { if (state?.timer?.paused) void adoptResult(() => data.resumeTimer()); };
    const resetAll = async () => {
        try {
            setError(null);
            const result = await data.resetAppState();
            setState(result.state);
        } catch (err: any) {
            setError(err?.message || err?.toString?.() || "Failed to reset");
        }
    };

    return <AppStateContext.Provider value={{ state, refresh, createTask, setActiveTask, startWork, startBreak, completeTimer, stopWork, skipBreak, updateSettings, remainingMs: () => computeRemainingMs(state?.timer, Date.now()), error, finalizeTask, pauseTimer, resumeTimer, isPaused: !!state?.timer?.paused, tick, resetAll }}>{children}</AppStateContext.Provider>;
};

export const useAppState = () => {
    const ctx = useContext(AppStateContext);
    if (!ctx) throw new Error("useAppState must be inside provider");
    return ctx;
};

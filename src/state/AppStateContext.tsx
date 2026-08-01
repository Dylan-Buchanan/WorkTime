import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { AppStateData, Settings, Task } from "./types";
import { useSounds } from "../hooks/useSounds";
import { computeRemainingMs } from "../lib/timer";
import { invoke } from "@tauri-apps/api/core";
// We lazy import notification functions to avoid type resolution issues if plugin not yet built
let notify: ((opts: { title: string; body?: string }) => void) | null = null;
async function ensureNotification() {
    if (notify) return;
    try {
        const mod: any = await import("@tauri-apps/plugin-notification");
        if (mod) {
            // request permission
            if (mod.isPermissionGranted && !(await mod.isPermissionGranted())) {
                await mod.requestPermission?.();
            }
            notify = (opts) => mod.sendNotification?.(opts);
        }
    } catch {
        // Fallback to Web Notification API when running in browser (vite dev / non-tauri)
        if (typeof window !== "undefined" && "Notification" in window) {
            try {
                if ((window as any).Notification?.permission === "default") {
                    await (window as any).Notification.requestPermission?.();
                }
                if ((window as any).Notification?.permission === "granted") {
                    notify = ({ title, body }) => {
                        try {
                            new (window as any).Notification(title, { body });
                        } catch {}
                    };
                }
            } catch {}
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
    tick: number; // increments every second for live UI updates
    resetAll: () => Promise<void>;
}

const AppStateContext = createContext<AppContextShape | undefined>(undefined);

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, setState] = useState<AppStateData | null>(null);
    const [tick, setTick] = useState(0);
    const [error, setError] = useState<string | null>(null);
    // Pause handled by backend (timer.paused flag)
    let soundApi: { play: (k: any) => void } | null = null;
    try {
        soundApi = useSounds();
    } catch {
        /* ignore sound init errors */
    }

    const refresh = useCallback(async (): Promise<AppStateData> => {
        const s = await invoke<AppStateData>("get_state");
        setState(s);
        return s;
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 1000);
        return () => clearInterval(id);
    }, []);

    // Auto progression robust loop
    const progressing = useRef(false);
    useEffect(() => {
        if (!state?.timer || state.timer.paused) {
            progressing.current = false;
            return;
        }
        const end = new Date(state.timer.ends_at).getTime();
        const remaining = end - Date.now();
        if (remaining <= 0 && !progressing.current) {
            progressing.current = true;
            (async () => {
                try {
                    const finishedKind = state.timer?.kind;
                    const finishedTaskId = state.timer?.task_id;
                    await invoke("complete_timer");
                    if (finishedKind === "Work") {
                        soundApi?.play("pomodoroFinish");
                    } else {
                        soundApi?.play("breakOver");
                    }
                    if (finishedKind) {
                        await maybeNotifyTimerEnd(finishedKind as any, finishedTaskId);
                    }
                    const afterComplete = await refresh();
                    if (finishedKind === "Work") {
                        await invoke("start_break_timer");
                    } else if (afterComplete.active_task) {
                        try {
                            await invoke("start_work_timer");
                        } catch (err) {
                            console.warn("Failed to auto-start work timer", err);
                        }
                    }
                    await refresh();
                } finally {
                    progressing.current = false;
                }
            })();
        }
    }, [tick, state?.timer, refresh]);

    useEffect(() => {
        // Proactively request notification permission early
        ensureNotification();
    }, []);

    const wrapVoid = async (fn: () => Promise<any>) => {
        try {
            setError(null);
            await fn();
            await refresh();
        } catch (e: any) {
            setError(e?.message || e?.toString?.() || "Unknown error");
        }
    };

    const createTask = async (name: string, target: number) => {
        try {
            setError(null);
            const task: any = await invoke("create_task", {
                payload: { name, target_pomodoros: target },
            });
            await refresh();
            return task;
        } catch (e: any) {
            setError(e?.message || e?.toString?.() || "Unknown error");
            throw e;
        }
    };

    const setActiveTask = (id: string) => wrapVoid(() => invoke("set_active_task", { task_id: id, taskId: id }));

    const ensureActiveTask = async () => {
        if (!state?.active_task) {
            const tasks = Object.values(state?.tasks || {}).filter((t) => !t.archived);
            if (tasks.length === 1) {
                await invoke("set_active_task", {
                    task_id: tasks[0].id,
                    taskId: tasks[0].id,
                });
            } else if (tasks.length === 0) {
                throw new Error("Create a task first");
            } else {
                throw new Error("Select a task first");
            }
        }
    };

    const startWork = async () => {
        try {
            await ensureActiveTask();
            await wrapVoid(() => invoke("start_work_timer"));
        } catch (e: any) {
            setError(e?.message || e?.toString?.());
        }
    };

    const startBreak = async () => {
        try {
            await ensureActiveTask();
            await wrapVoid(() => invoke("start_break_timer"));
        } catch (e: any) {
            setError(e?.message || e?.toString?.());
        }
    };
    // Fire a desktop notification when a timer finishes if window not focused (even if visible) or tab hidden
    const maybeNotifyTimerEnd = async (kind: "Work" | "ShortBreak" | "LongBreak", taskId?: string) => {
        try {
            if (typeof document !== "undefined") {
                const hidden: boolean = (document as any).hidden;
                const hasFocus = typeof document.hasFocus === "function" ? document.hasFocus() : !hidden;
                // Only skip if clearly focused and visible
                if (!hidden && hasFocus) return;
            }
            await ensureNotification();
            if (!notify) return;
            if (kind === "Work") {
                const taskName = taskId && state?.tasks[taskId]?.name;
                notify({
                    title: "Pomodoro Complete",
                    body: taskName ? `Finished: ${taskName}` : "Time for a break",
                });
            } else {
                notify({ title: "Break Over", body: "Time to focus" });
            }
        } catch {
            // ignore
        }
    };

    const completeTimer = () =>
        wrapVoid(async () => {
            const kind = state?.timer?.kind || "Work";
            const taskId = state?.timer?.task_id;
            await invoke("complete_timer");
            await maybeNotifyTimerEnd(kind as any, taskId);
        });
    const stopWork = () => wrapVoid(() => invoke("stop_work_timer"));
    const skipBreak = () => wrapVoid(() => invoke("skip_break"));
    const updateSettings = (s: Settings) => wrapVoid(() => invoke("update_settings", { settings: s }));

    const finalizeTask = (id: string) =>
        wrapVoid(async () => {
            await invoke("finalize_task", { task_id: id, taskId: id });
        });

    const remainingMs = () => computeRemainingMs(state?.timer, Date.now());
    const pauseTimer = () => {
        if (!state?.timer || state.timer.paused) return;
        wrapVoid(() => invoke("pause_timer"));
    };
    const resumeTimer = () => {
        if (!state?.timer || !state.timer.paused) return;
        wrapVoid(() => invoke("resume_timer"));
    };

    const resetAll = async () => {
        try {
            setError(null);
            await invoke("reset_app_state");
            await refresh();
        } catch (e: any) {
            setError(e?.message || e?.toString?.() || "Failed to reset");
        }
    };

    return (
        <AppStateContext.Provider
            value={{
                state,
                refresh,
                createTask,
                setActiveTask,
                startWork,
                startBreak,
                completeTimer,
                stopWork,
                skipBreak,
                updateSettings,
                remainingMs,
                error,
                finalizeTask,
                pauseTimer,
                resumeTimer,
                isPaused: !!state?.timer?.paused,
                tick,
                resetAll,
            }}
        >
            {children}
        </AppStateContext.Provider>
    );
};

export const useAppState = () => {
    const ctx = useContext(AppStateContext);
    if (!ctx) throw new Error("useAppState must be inside provider");
    return ctx;
};

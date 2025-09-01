import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    useCallback,
    useRef,
} from "react";
import { AppStateData, Settings } from "./types";
import { usePM } from "./ProjectManagerContext";
import { useSounds } from "../hooks/useSounds";
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
    refresh: () => Promise<void>;
    createTask: (name: string, target: number) => Promise<void>;
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
}

const AppStateContext = createContext<AppContextShape | undefined>(undefined);

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
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

    const refresh = useCallback(async () => {
        const s = await invoke<AppStateData>("get_state");
        setState(s);
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
                        await maybeNotifyTimerEnd(
                            finishedKind as any,
                            finishedTaskId
                        );
                    }
                    await refresh();
                    if (finishedKind === "Work") {
                        await invoke("start_break_timer");
                    } else {
                        await ensureActiveTask().catch(() => {});
                        await invoke("start_work_timer");
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
            // auto-select the newly created task
            await invoke("set_active_task", {
                task_id: task.id,
                taskId: task.id,
            });
            await refresh();
        } catch (e: any) {
            setError(e?.message || e?.toString?.() || "Unknown error");
        }
    };

    const setActiveTask = (id: string) =>
        wrapVoid(() => invoke("set_active_task", { task_id: id, taskId: id }));

    const ensureActiveTask = async () => {
        if (!state?.active_task) {
            const tasks = Object.values(state?.tasks || {}).filter(
                (t) => !t.archived
            );
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
    const maybeNotifyTimerEnd = async (
        kind: "Work" | "ShortBreak" | "LongBreak",
        taskId?: string
    ) => {
        try {
            if (typeof document !== "undefined") {
                const hidden: boolean = (document as any).hidden;
                const hasFocus =
                    typeof document.hasFocus === "function"
                        ? document.hasFocus()
                        : !hidden;
                // Only skip if clearly focused and visible
                if (!hidden && hasFocus) return;
            }
            await ensureNotification();
            if (!notify) return;
            if (kind === "Work") {
                const taskName = taskId && state?.tasks[taskId]?.name;
                notify({
                    title: "Pomodoro Complete",
                    body: taskName
                        ? `Finished: ${taskName}`
                        : "Time for a break",
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
    const updateSettings = (s: Settings) =>
        wrapVoid(() => invoke("update_settings", { settings: s }));

    const { state: pmState, updateTask: pmUpdateTask } = (() => {
        try {
            return usePM();
        } catch {
            return { state: null, updateTask: () => {} } as any;
        }
    })();

    const moveRelatedPMTasksToDone = (appTaskId: string) => {
        if (!pmState) return;
        const appTask = state?.tasks[appTaskId];
        Object.values(pmState.tasks)
            .filter((t: any) => {
                if (t.status === "Done") return false;
                if (t.appTaskId === appTaskId) return true;
                // Fallback: match by normalized title/name if not linked yet
                if (appTask) {
                    const aName = appTask.name.trim().toLowerCase();
                    const tName = (t.title || "").trim().toLowerCase();
                    if (aName && tName && aName === tName) return true;
                }
                return false;
            })
            .forEach((t: any) =>
                pmUpdateTask(t.id, {
                    status: "Done",
                    appTaskId: t.appTaskId || appTaskId,
                } as any)
            );
    };

    const finalizeTask = (id: string) =>
        wrapVoid(async () => {
            await invoke("finalize_task", { task_id: id, taskId: id });
            moveRelatedPMTasksToDone(id);
        });

    // Passive sync: if backend marks tasks completed/archived we auto move related PM tasks to Done
    useEffect(() => {
        if (!state || !pmState) return;
        Object.values(state.tasks).forEach((t) => {
            if (t.archived || t.completed_at) {
                moveRelatedPMTasksToDone(t.id);
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state?.tasks, pmState]);

    // Sync time spent & worked pomodoros to linked PM tasks
    useEffect(() => {
        if (!state || !pmState) return;
        const nowMs = Date.now();
        // Aggregate completed work minutes from logs
        const workMinutes: Record<string, number> = {};
        state.logs.forEach((log) => {
            if (!log.was_break) {
                workMinutes[log.task_id] =
                    (workMinutes[log.task_id] || 0) + log.duration_minutes;
            }
        });
        // Add live in-progress work for active timer
        const active = state.timer;
        if (active && active.kind === "Work" && !active.paused) {
            const start = new Date(active.started_at).getTime();
            const end = new Date(active.ends_at).getTime();
            const elapsedMins =
                Math.max(0, Math.min(nowMs, end) - start) / 60000;
            workMinutes[active.task_id] =
                (workMinutes[active.task_id] || 0) + elapsedMins;
        }
        Object.values(pmState.tasks).forEach((pt: any) => {
            if (!pt.appTaskId) return;
            const minsFromLogs = workMinutes[pt.appTaskId];
            if (minsFromLogs === undefined) return;
            // Cross-check with backend task's completed_pomodoros * configured work length
            const backendTask = state.tasks[pt.appTaskId];
            let mins = minsFromLogs;
            if (backendTask) {
                const expected =
                    backendTask.completed_pomodoros *
                    state.settings.work_minutes;
                // If our accumulated logs under-report by more than half a minute, trust expected
                if (expected - mins > 0.5) {
                    mins = expected;
                }
            }
            const workedPomos = +(mins / state.settings.work_minutes).toFixed(
                2
            );
            if (
                Math.abs((pt.timeSpentMinutes || 0) - mins) > 0.05 ||
                Math.abs((pt.workedPomos || 0) - workedPomos) > 0.01
            ) {
                pmUpdateTask(pt.id, {
                    timeSpentMinutes: +mins.toFixed(2),
                    workedPomos,
                    lastWorkedAt: new Date().toISOString(),
                } as any);
            }
        });
    }, [state?.logs, state?.timer, tick, pmState, pmUpdateTask]);

    // Proactively link active app task to a single matching PM task by title (if not already linked)
    useEffect(() => {
        if (!state || !pmState) return;
        const activeId = state.active_task;
        if (!activeId) return;
        const appTask = state.tasks[activeId];
        if (!appTask) return;
        const titleNorm = appTask.name.trim().toLowerCase();
        // Find PM tasks that match title and are unlinked
        const candidates = Object.values(pmState.tasks as any).filter(
            (t: any) =>
                !t.appTaskId && t.title.trim().toLowerCase() === titleNorm
        );
        if (candidates.length === 1) {
            pmUpdateTask((candidates[0] as any).id, {
                appTaskId: activeId,
            } as any);
        }
    }, [state?.active_task, state?.tasks, pmState, pmUpdateTask]);

    const remainingMs = () => {
        if (!state?.timer) return 0;
        if (state.timer.paused) {
            return (state.timer.paused_remaining_secs || 0) * 1000;
        }
        const end = new Date(state.timer.ends_at).getTime();
        return Math.max(0, end - Date.now());
    };
    const pauseTimer = () => {
        if (!state?.timer || state.timer.paused) return;
        wrapVoid(() => invoke("pause_timer"));
    };
    const resumeTimer = () => {
        if (!state?.timer || !state.timer.paused) return;
        wrapVoid(() => invoke("resume_timer"));
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

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    useCallback,
    useRef,
} from "react";
import { AppStateData, Settings } from "./types";
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
        // ignore if plugin not available yet
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
}

const AppStateContext = createContext<AppContextShape | undefined>(undefined);

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const [state, setState] = useState<AppStateData | null>(null);
    const [tick, setTick] = useState(0);
    const [error, setError] = useState<string | null>(null);
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
        if (!state?.timer) {
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
                    await invoke("complete_timer");
                    if (finishedKind === "Work") {
                        soundApi?.play("pomodoroFinish");
                    } else {
                        soundApi?.play("breakOver");
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
    const completeTimer = () =>
        wrapVoid(async () => {
            await invoke("complete_timer");
            await ensureNotification();
            notify?.({ title: "Timer Finished", body: "Session complete." });
        });
    const stopWork = () => wrapVoid(() => invoke("stop_work_timer"));
    const skipBreak = () => wrapVoid(() => invoke("skip_break"));
    const updateSettings = (s: Settings) =>
        wrapVoid(() => invoke("update_settings", { settings: s }));

    const finalizeTask = (id: string) =>
        wrapVoid(() => invoke("finalize_task", { task_id: id, taskId: id }));

    const remainingMs = () => {
        if (!state?.timer) return 0;
        const end = new Date(state.timer.ends_at).getTime();
        return Math.max(0, end - Date.now());
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

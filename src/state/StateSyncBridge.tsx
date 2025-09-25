import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppState } from "./AppStateContext";
import { usePM } from "./ProjectManagerContext";
import { TaskStatus, PMTask } from "./types";

export const StateSyncBridge: React.FC = () => {
    const {
        state: appState,
        refresh,
        createTask: createAppTask,
        setActiveTask,
    } = useAppState();
    const {
        state: pmState,
        updateTask,
        ensureMetadataForAppTask,
    } = usePM();

    // Ensure every backend task has corresponding PM metadata entry.
    useEffect(() => {
        if (!appState || !pmState) return;
        Object.values(appState.tasks).forEach((task) => {
            ensureMetadataForAppTask(task.id, {
                title: task.name,
                estimatePomos: task.target_pomodoros,
            });
        });
    }, [appState, pmState, ensureMetadataForAppTask]);

    // Auto-create backend tasks for PM entries missing linkage (legacy data).
    useEffect(() => {
        if (!pmState || !appState) return;
        const unlinked = Object.values(pmState.tasks).filter(
            (t) => !t.isArchived && !t.appTaskId
        );
        if (unlinked.length === 0) return;
        let cancelled = false;
        (async () => {
            const activeBefore = appState.active_task;
            for (const pmTask of unlinked) {
                try {
                    const created = await createAppTask(
                        pmTask.title || "Untitled",
                        Math.max(1, pmTask.estimatePomos || 1)
                    );
                    if (cancelled) return;
                    updateTask(pmTask.id, { appTaskId: created.id });
                    if (activeBefore && activeBefore !== created.id) {
                        try {
                            await setActiveTask(activeBefore);
                        } catch {}
                    }
                    await refresh();
                } catch (err) {
                    console.warn("Failed to create backend task for PM entry", pmTask.id, err);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [pmState?.tasks, appState?.active_task, createAppTask, setActiveTask, refresh, updateTask]);

    // Sync time spent & worked pomodoros to PM metadata.
    useEffect(() => {
        if (!appState || !pmState) return;
        const nowMs = Date.now();
        const workMinutes: Record<string, number> = {};
        appState.logs.forEach((log) => {
            if (!log.was_break) {
                workMinutes[log.task_id] =
                    (workMinutes[log.task_id] || 0) + log.duration_minutes;
            }
        });
        const active = appState.timer;
        if (active && active.kind === "Work" && !active.paused) {
            const start = new Date(active.started_at).getTime();
            const end = new Date(active.ends_at).getTime();
            const elapsedMins = Math.max(0, Math.min(nowMs, end) - start) / 60000;
            workMinutes[active.task_id] =
                (workMinutes[active.task_id] || 0) + elapsedMins;
        }
        Object.values(pmState.tasks).forEach((pmTask) => {
            if (!pmTask.appTaskId) return;
            const minsFromLogs = workMinutes[pmTask.appTaskId];
            if (minsFromLogs === undefined) return;
            const backendTask = appState.tasks[pmTask.appTaskId];
            let mins = minsFromLogs;
            if (backendTask) {
                const expected =
                    backendTask.completed_pomodoros *
                    appState.settings.work_minutes;
                if (expected - mins > 0.5) {
                    mins = expected;
                }
            }
            const workedPomos = +(mins / appState.settings.work_minutes).toFixed(2);
            const patch: Partial<PMTask> = {};
            if (
                Math.abs((pmTask.timeSpentMinutes || 0) - mins) > 0.05 ||
                Math.abs((pmTask.workedPomos || 0) - workedPomos) > 0.01
            ) {
                patch.timeSpentMinutes = +mins.toFixed(2);
                patch.workedPomos = workedPomos;
                patch.lastWorkedAt = new Date().toISOString();
            }
            if (
                typeof pmTask.estimatePomos === "number" &&
                workedPomos > pmTask.estimatePomos + 0.0001
            ) {
                patch.estimatePomos = Math.ceil(workedPomos);
            }
            if (Object.keys(patch).length > 0) {
                updateTask(pmTask.id, patch);
            }
        });
    }, [appState?.logs, appState?.timer, appState?.settings, pmState?.tasks, updateTask]);

    // Propagate estimate changes from PM -> backend targets.
    useEffect(() => {
        if (!pmState || !appState) return;
        const backendTargets: Record<string, number> = {};
        Object.values(appState.tasks).forEach((task) => {
            backendTargets[task.id] = task.target_pomodoros;
        });
        let cancelled = false;
        (async () => {
            for (const pmTask of Object.values(pmState.tasks)) {
                if (!pmTask.appTaskId) continue;
                if (typeof pmTask.estimatePomos !== "number") continue;
                const current = backendTargets[pmTask.appTaskId];
                if (current === undefined) continue;
                if (pmTask.estimatePomos !== current) {
                    try {
                        await invoke("set_task_target", {
                            task_id: pmTask.appTaskId,
                            taskId: pmTask.appTaskId,
                            target: pmTask.estimatePomos,
                        });
                        if (cancelled) return;
                        await refresh();
                    } catch (err) {
                        console.warn("Failed to push estimate to backend", err);
                    }
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [pmState?.tasks, appState?.tasks, refresh]);

    // Mark PM tasks done when backend tasks complete.
    useEffect(() => {
        if (!pmState || !appState) return;
        Object.values(pmState.tasks).forEach((pmTask) => {
            if (!pmTask.appTaskId) return;
            const backend = appState.tasks[pmTask.appTaskId];
            if (!backend) return;
            if (backend.completed_at && pmTask.status !== "Done") {
                updateTask(pmTask.id, { status: "Done" as TaskStatus });
            }
        });
    }, [pmState?.tasks, appState?.tasks, updateTask]);

    // Auto-link PM entries without linkage when names match active backend task.
    useEffect(() => {
        if (!pmState || !appState) return;
        const activeId = appState.active_task;
        if (!activeId) return;
        const appTask = appState.tasks[activeId];
        if (!appTask) return;
        const titleNorm = appTask.name.trim().toLowerCase();
        const candidates = Object.values(pmState.tasks).filter(
            (pmTask) => !pmTask.appTaskId && pmTask.title.trim().toLowerCase() === titleNorm
        );
        if (candidates.length === 1) {
            updateTask(candidates[0].id, { appTaskId: activeId });
        }
    }, [appState?.active_task, appState?.tasks, pmState?.tasks, updateTask]);

    return null;
};

export default StateSyncBridge;

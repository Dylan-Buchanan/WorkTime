import { useEffect, useRef } from "react";
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

    const pendingTargetsRef = useRef<Record<string, number>>({});

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
        const workMinutesSetting = appState.settings.work_minutes;
        const active = appState.timer;
        let activeExtraPomos = 0;
        let activeTaskId: string | null = null;
        if (
            active &&
            active.kind === "Work" &&
            !active.paused &&
            workMinutesSetting > 0
        ) {
            const start = new Date(active.started_at).getTime();
            const end = new Date(active.ends_at).getTime();
            const now = Date.now();
            const elapsedMs = Math.max(0, Math.min(now, end) - start);
            activeExtraPomos = elapsedMs / 60000 / workMinutesSetting;
            activeTaskId = active.task_id;
        }

        Object.values(pmState.tasks).forEach((pmTask) => {
            if (!pmTask.appTaskId) return;
            const backendTask = appState.tasks[pmTask.appTaskId];
            if (!backendTask) return;
            let worked = backendTask.completed_pomodoros || 0;
            if (pmTask.appTaskId === activeTaskId && activeExtraPomos > 0) {
                worked += Math.min(1, activeExtraPomos);
            }
            const workedRounded = +worked.toFixed(2);
            const minutes = +(
                workedRounded * Math.max(workMinutesSetting, 0)
            ).toFixed(2);
            const patch: Partial<PMTask> = {};
            let touchedProgress = false;
            if (Math.abs((pmTask.workedPomos || 0) - workedRounded) > 0.01) {
                patch.workedPomos = workedRounded;
                touchedProgress = true;
            }
            if (Math.abs((pmTask.timeSpentMinutes || 0) - minutes) > 0.05) {
                patch.timeSpentMinutes = minutes;
                touchedProgress = true;
            }
            const pendingTarget = pmTask.appTaskId
                ? pendingTargetsRef.current[pmTask.appTaskId]
                : undefined;
            const shouldSkipEstimateUpdate =
                pendingTarget !== undefined &&
                backendTask.target_pomodoros !== pendingTarget;
            if (
                pendingTarget !== undefined &&
                backendTask.target_pomodoros === pendingTarget &&
                pmTask.appTaskId
            ) {
                delete pendingTargetsRef.current[pmTask.appTaskId];
            }
            if (
                !shouldSkipEstimateUpdate &&
                pmTask.estimatePomos !== backendTask.target_pomodoros
            ) {
                patch.estimatePomos = backendTask.target_pomodoros;
            }
            if (touchedProgress) {
                patch.lastWorkedAt = new Date().toISOString();
            }
            if (Object.keys(patch).length > 0) {
                updateTask(pmTask.id, patch);
            }
        });
    }, [
        appState?.tasks,
        appState?.timer,
        appState?.settings.work_minutes,
        pmState?.tasks,
        updateTask,
    ]);

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
                const backendTask = appState.tasks[pmTask.appTaskId];
                const completed = backendTask?.completed_pomodoros ?? 0;
                const minTarget = Math.max(1, Math.ceil(completed));
                let desired = Math.round(pmTask.estimatePomos);
                if (!Number.isFinite(desired)) {
                    desired = minTarget;
                }
                if (desired < minTarget) {
                    desired = minTarget;
                }
                if (desired !== pmTask.estimatePomos) {
                    updateTask(pmTask.id, { estimatePomos: desired });
                }
                if (desired !== current) {
                    if (pmTask.appTaskId) {
                        pendingTargetsRef.current[pmTask.appTaskId] = desired;
                    }
                    try {
                        await invoke("set_task_target", {
                            task_id: pmTask.appTaskId,
                            taskId: pmTask.appTaskId,
                            target: desired,
                        });
                        if (cancelled) return;
                        await refresh();
                    } catch (err) {
                        console.warn("Failed to push estimate to backend", err);
                        if (pmTask.appTaskId) {
                            const pendingTarget =
                                pendingTargetsRef.current[pmTask.appTaskId];
                            if (pendingTarget === desired) {
                                delete pendingTargetsRef.current[pmTask.appTaskId];
                            }
                        }
                    }
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [pmState?.tasks, appState?.tasks, refresh, updateTask]);

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

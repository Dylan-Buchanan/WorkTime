import { useEffect, useRef, useState } from "react";
import { useAppState } from "./AppStateContext";
import { usePM } from "./ProjectManagerContext";
import { TaskStatus, PMTask } from "./types";
import { useData } from "./DataContext";
import { useSync } from "./SyncContext";

/** One backend task whose estimate diverges from its PM metadata estimate. */
interface PropagationTarget {
    appTaskId: string;
    pmTaskId: string;
    estimatePomos: number;
    desired: number;
    /** True only when the desired target differs from the current backend value. */
    push: boolean;
}

/**
 * Pure divergence scan for the estimate-propagation effect. For every PM task
 * with an app link and a numeric estimate, computes the normalized desired
 * backend target (an integer of at least one). A task only needs a
 * push when its desired target differs from the current backend value; the
 * estimate normalization itself applies on the main path even when no push is
 * needed.
 */
function collectPropagationTargets(
    pmState: { tasks: Record<string, PMTask> },
    appState: { tasks: Record<string, { id: string; target_pomodoros: number; completed_pomodoros: number }> },
): PropagationTarget[] {
    const backendTargets: Record<string, number> = {};
    for (const task of Object.values(appState.tasks)) {
        backendTargets[task.id] = task.target_pomodoros;
    }
    const targets: PropagationTarget[] = [];
    for (const pmTask of Object.values(pmState.tasks)) {
        if (!pmTask.appTaskId) continue;
        if (typeof pmTask.estimatePomos !== "number") continue;
        const current = backendTargets[pmTask.appTaskId];
        if (current === undefined) continue;
        let desired = Math.round(pmTask.estimatePomos);
        if (!Number.isFinite(desired)) desired = 1;
        desired = Math.max(1, desired);
        targets.push({
            appTaskId: pmTask.appTaskId,
            pmTaskId: pmTask.id,
            estimatePomos: pmTask.estimatePomos,
            desired,
            push: desired !== current,
        });
    }
    return targets;
}

export const StateSyncBridge: React.FC = () => {
    const { state: appState, refresh } = useAppState();
    const { state: pmState, updateTask, ensureMetadataForAppTask } = usePM();
    const { sync } = useSync();
    const data = useData();

    // Keep a stable reference to updateTask for effects that should only react to app state changes.
    const updateTaskRef = useRef(updateTask);
    useEffect(() => {
        updateTaskRef.current = updateTask;
    }, [updateTask]);

    const pendingTargetsRef = useRef<Record<string, number>>({});
    // Linking a legacy PM task creates a backend task, which changes
    // appState.tasks and reruns this effect before the PM appTaskId patch has
    // necessarily landed. Keep the PM id in flight across effect reruns so
    // that state transition cannot create a second backend task.
    const linkingTaskIdsRef = useRef(new Set<string>());
    const pendingAppTaskLinksRef = useRef(new Map<string, string>());
    // Non-null while an estimate propagation batch is running. New effect runs
    // return early so staged writes can never start a second overlapping batch.
    const batchInFlightRef = useRef<Promise<void> | null>(null);
    // Set when a bail-out observed a still-divergent target while a batch was
    // running. The batch's completion schedules one more pass so that edit is
    // propagated instead of silently dropped (React does not re-run an effect
    // just because a ref changed).
    const rerunPendingRef = useRef(false);
    const [rerunTick, setRerunTick] = useState(0);
    const mountedRef = useRef(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Propagate estimate changes from PM -> backend targets. Runs before the
    // metadata/progress effects so its pending targets are pre-seeded before
    // they can overwrite a divergent estimate. Every divergent target is staged
    // locally as one batch, the local app view refreshes once, then one bridge
    // sync pushes the batch. A cleanup cancels the remaining work on unmount;
    // a divergent edit observed during the batch schedules one follow-up pass.
    useEffect(() => {
        let cancelled = false;
        const cleanup = () => {
            // Dependency changes re-run this effect while the same batch is
            // notifying AppStateProvider. Only the component's unmount should
            // cancel the detached work; the lifecycle effect runs first and
            // marks mountedRef false during an actual unmount.
            if (!mountedRef.current) cancelled = true;
        };
        if (!pmState || !appState) return cleanup;
        if (batchInFlightRef.current) {
            if (collectPropagationTargets(pmState, appState).some((target) => target.push)) {
                rerunPendingRef.current = true;
            }
            const inFlight = batchInFlightRef.current;
            void inFlight.then(() => {
                if (!cancelled && mountedRef.current && rerunPendingRef.current) {
                    rerunPendingRef.current = false;
                    setRerunTick((value) => value + 1);
                }
            });
            return cleanup;
        }

        const targets = collectPropagationTargets(pmState, appState);
        if (targets.length === 0) return cleanup;

        for (const target of targets) {
            if (target.desired !== target.estimatePomos) {
                updateTaskRef.current(target.pmTaskId, { estimatePomos: target.desired });
            }
            if (target.push) {
                // Pre-seed the pending target before any await so the
                // metadata/progress effects defer to this propagation.
                pendingTargetsRef.current[target.appTaskId] = target.desired;
            }
        }
        const plan = targets.filter((target) => target.push);
        if (plan.length === 0) return cleanup;

        const batch = (async () => {
            let changed = false;
            for (const { appTaskId, desired } of plan) {
                if (cancelled || !mountedRef.current) return;
                try {
                    await data.setTaskTarget(appTaskId, desired);
                    changed = true;
                } catch (err) {
                    console.warn("Failed to push estimate to backend", err);
                    // Clear only the pending entry that still holds the
                    // attempted value; a later edit that rekeyed the pending
                    // target survives.
                    if (pendingTargetsRef.current[appTaskId] === desired) {
                        delete pendingTargetsRef.current[appTaskId];
                    }
                }
            }
            if (!changed) return;
            if (cancelled || !mountedRef.current) return;
            try {
                await refresh();
            } catch (err) {
                console.warn("[bridge] failed to refresh the app view", err);
            }
            if (cancelled || !mountedRef.current) return;
            try {
                await sync({ reason: "bridge" });
            } catch (err) {
                console.warn("[bridge] estimate sync failed", err);
            }
        })()
            .catch((err) => {
                console.warn("[bridge] unexpected propagation failure", err);
            })
            .finally(() => {
                batchInFlightRef.current = null;
                // Re-check any divergence that arrived while the batch ran.
                if (!cancelled && mountedRef.current && rerunPendingRef.current) {
                    rerunPendingRef.current = false;
                    setRerunTick((value) => value + 1);
                }
            });
        batchInFlightRef.current = batch;
        return cleanup;
    }, [pmState?.tasks, appState?.tasks, refresh, sync, data, updateTask, rerunTick]);

    // Ensure every backend task has corresponding PM metadata entry.
    useEffect(() => {
        if (!appState) return;
        Object.values(appState.tasks).forEach((task) => {
            // The legacy-linking effect has created this backend UUID and will
            // attach it to its original PM row. It is not missing metadata.
            if (pendingAppTaskLinksRef.current.has(task.id)) return;
            const pending = pendingTargetsRef.current[task.id];
            const includeEstimate = pending === undefined || pending === task.target_pomodoros;
            ensureMetadataForAppTask(task.id, {
                title: task.name,
                ...(includeEstimate ? { estimatePomos: task.target_pomodoros } : {}),
            });
        });
    }, [appState?.tasks, ensureMetadataForAppTask]);

    // Auto-create backend tasks for PM entries missing linkage (legacy data).
    useEffect(() => {
        if (!pmState || !appState) return;
        // A reservation lives until React observes the completed PM link. Store
        // revision notifications can otherwise expose the old unlinked snapshot
        // between the backend write and the PM provider's state update.
        for (const pmTaskId of linkingTaskIdsRef.current) {
            const appTaskId = pmState.tasks[pmTaskId]?.appTaskId;
            if (!pmState.tasks[pmTaskId] || appTaskId) {
                linkingTaskIdsRef.current.delete(pmTaskId);
                if (appTaskId) pendingAppTaskLinksRef.current.delete(appTaskId);
            }
        }
        const unlinked = Object.values(pmState.tasks).filter(
            (t) => !t.isArchived && !t.appTaskId && !linkingTaskIdsRef.current.has(t.id),
        );
        if (unlinked.length === 0) return;
        // Reserve the entire snapshot before the first await. Creating one task
        // can rerender the bridge while the rest of this batch is still queued;
        // per-item reservation lets those later entries be claimed again.
        unlinked.forEach((task) => linkingTaskIdsRef.current.add(task.id));
        (async () => {
            for (const pmTask of unlinked) {
                let backendCreated = false;
                try {
                    // Stage directly through the data layer. Updating AppState
                    // here would run the metadata effect before this PM row is
                    // linked and create a second PM entry for the same task.
                    const result = await data.createTask(pmTask.title || "Untitled", Math.max(1, pmTask.estimatePomos || 1));
                    if (!mountedRef.current) return;
                    backendCreated = true;
                    pendingAppTaskLinksRef.current.set(result.value.id, pmTask.id);
                    // Persist the relationship before creating the next backend
                    // task. Task staging emits a store revision; relying only on
                    // a React state patch lets that revision reload the previous
                    // unlinked PM snapshot and discard the relationship.
                    const latestPM = await data.loadPMState();
                    const latestTask = latestPM?.tasks[pmTask.id];
                    if (!latestPM || !latestTask) throw new Error(`PM task ${pmTask.id} disappeared while linking`);
                    await data.savePMState({
                        ...latestPM,
                        tasks: {
                            ...latestPM.tasks,
                            [pmTask.id]: {
                                ...latestTask,
                                appTaskId: result.value.id,
                                updatedAt: new Date().toISOString(),
                            },
                        },
                    });
                } catch (err) {
                    console.warn("Failed to create or link backend task for PM entry", pmTask.id, err);
                } finally {
                    if (!backendCreated) linkingTaskIdsRef.current.delete(pmTask.id);
                }
            }
            // Commands are local and adopt their staged results, so collapse the
            // repeated per-item refreshes into one post-loop view refresh. No
            // per-item sync; the explicit sync action remains the only write path.
            if (mountedRef.current) {
                try {
                    await refresh();
                } catch (err) {
                    console.warn("Failed to refresh after linking PM entries", err);
                }
            }
        })().catch((err) => {
            console.warn("[bridge] unexpected metadata propagation failure", err);
        });
    }, [pmState?.tasks, appState, data, refresh, updateTask]);

    // Sync time spent & worked pomodoros to PM metadata.
    useEffect(() => {
        if (!appState || !pmState) return;
        const workMinutesSetting = appState.settings.work_minutes;
        const active = appState.timer;
        let activeExtraPomos = 0;
        let activeTaskId: string | null = null;
        if (active && active.kind === "Work" && !active.paused && workMinutesSetting > 0) {
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
            const minutes = +(workedRounded * Math.max(workMinutesSetting, 0)).toFixed(2);
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
            const pendingTarget = pmTask.appTaskId ? pendingTargetsRef.current[pmTask.appTaskId] : undefined;
            const shouldSkipEstimateUpdate = pendingTarget !== undefined && backendTask.target_pomodoros !== pendingTarget;
            if (pendingTarget !== undefined && backendTask.target_pomodoros === pendingTarget && pmTask.appTaskId) {
                delete pendingTargetsRef.current[pmTask.appTaskId];
            }
            if (!shouldSkipEstimateUpdate && typeof pmTask.estimatePomos !== "number") {
                patch.estimatePomos = backendTask.target_pomodoros;
            }
            if (touchedProgress) {
                patch.lastWorkedAt = new Date().toISOString();
            }
            if (Object.keys(patch).length > 0) {
                updateTaskRef.current(pmTask.id, patch);
            }
        });
    }, [appState?.tasks, appState?.timer, appState?.settings.work_minutes]);

    // Mark PM tasks done when backend tasks complete.
    useEffect(() => {
        if (!pmState || !appState) return;
        Object.values(pmState.tasks).forEach((pmTask) => {
            if (!pmTask.appTaskId) return;
            const backend = appState.tasks[pmTask.appTaskId];
            if (!backend) return;
            if (backend.completed_at && pmTask.status !== "Done") {
                updateTaskRef.current(pmTask.id, { status: "Done" as TaskStatus });
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
        const candidates = Object.values(pmState.tasks).filter((pmTask) => !pmTask.appTaskId && pmTask.title.trim().toLowerCase() === titleNorm);
        if (candidates.length === 1) {
            updateTaskRef.current(candidates[0].id, { appTaskId: activeId });
        }
    }, [appState?.active_task, appState?.tasks, pmState?.tasks, updateTask]);

    return null;
};

export default StateSyncBridge;

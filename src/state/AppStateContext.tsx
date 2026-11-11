import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AppStateData, Settings, Task, TimerKind, ActiveTimer } from "./types";
import { useSounds } from "../hooks/useSounds";
import { computeRemainingMs } from "../lib/timer";
import { useData } from "./DataContext";
import { useSync } from "./SyncContext";
import { windowStartedAt, workStartOccupation } from "../lib/engine";
import type { EngineResult } from "../lib/engine";
import { ownsWorkWindow, partitionPendingFinalizes } from "../lib/engine/pendingFinalize";
import type { ReconciledTimer } from "../lib/data/DataAccess";
import type { TimerTransitionEvent } from "./timerTransitions";

type CompletionNotice = ReconciledTimer & { windowId?: string };
type FinalizeMode = "finalize" | "archive";
type PendingFinalize = { id: string; mode: FinalizeMode };
type PauseEpisode = {
    taskId: string; windowId: string; at: string; handoff: boolean;
    accumulatedSecs: ActiveTimer["accumulated_secs"];
    pausedRemainingSecs: ActiveTimer["paused_remaining_secs"];
    startedAt: ActiveTimer["started_at"];
    endsAt: ActiveTimer["ends_at"];
};

function sameTimerOccupant(left: ActiveTimer | null | undefined, right: ActiveTimer | null | undefined): boolean {
    if (!left || !right) return !left && !right;
    return left.task_id === right.task_id && left.kind === right.kind && windowStartedAt(left) === windowStartedAt(right);
}

let notify: ((opts: { title: string; body?: string }) => void) | null = null;
let notificationSetup: Promise<void> | null = null;
export function resetNotifyForTesting(): void {
    notify = null;
    notificationSetup = null;
}
async function ensureNotification() {
    if (notify) return;
    if (!notificationSetup) {
        notificationSetup = (async () => {
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
        })();
        try {
            await notificationSetup;
        } finally {
            if (!notify) notificationSetup = null;
        }
    } else await notificationSetup;
}

/** Shared notification entry point for timer and app-open reminder sources. */
export async function notifyNow(opts: { title: string; body?: string }): Promise<boolean> {
    try {
        await ensureNotification();
        if (!notify) return false;
        notify(opts);
        return true;
    } catch {
        return false;
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
    /** Finalize now, or queue it when `taskId` owns the current Work window. Memory-only. */
    requestFinalize: (taskId: string, options?: { mode?: "finalize" | "archive" }) => Promise<"finalized" | "deferred">;
    /** Backend task ids awaiting a deferred finalize, in enqueue order. Memory-only. */
    pendingFinalizeTaskIds: readonly string[];
    archiveTask: (id: string) => Promise<void>;
    startTaskWork: (id: string) => Promise<"started" | "joined">;
    subscribeTaskCompletions: (listener: (taskId: string) => void) => () => void;
    subscribeTimerTransitions: (listener: (event: TimerTransitionEvent) => void) => () => void;
    pauseTimer: () => Promise<void>;
    resumeTimer: (options?: { handoff?: boolean }) => Promise<void>;
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
    const pendingFinalizeRef = useRef<PendingFinalize[]>([]);
    const inFlightFinalizeRef = useRef(new Set<string>());
    const finalizeRunRef = useRef<Promise<void> | null>(null);
    const reflushRef = useRef(false);
    const [pendingFinalizeTaskIds, setPendingFinalizeTaskIds] = useState<readonly string[]>([]);
    const progressing = useRef(false);
    const lastNotifiedWindowRef = useRef<string | null>(null);
    const startTaskWorkQueueRef = useRef<Promise<unknown>>(Promise.resolve());
    const stateRef = useRef<AppStateData | null>(null);
    const queuedReconciliationRef = useRef<{ timer: CompletionNotice; state: AppStateData } | null>(null);
    const taskCompletionListenersRef = useRef(new Set<(taskId: string) => void>());
    const timerTransitionListenersRef = useRef(new Set<(event: TimerTransitionEvent) => void>());
    const pauseEpisodeRef = useRef<PauseEpisode | null>(null);
    // Only command adoptions supersede an in-flight publisher. A revision read
    // can expose that command's own committed result before its await resumes.
    const commandAdoptionSeqRef = useRef(0);
    // Wrappers read their own adoption observation without changing adoptResult's
    // void/error contract or serializing independent commands.
    const commandAdoptionsRef = useRef(new WeakMap<EngineResult<unknown>, {
        current: boolean;
    }>());
    const terminalTaskIdsRef = useRef(new Set<string>());
    let soundApi: { play: (k: any) => void } | null = null;
    try { soundApi = useSounds(); } catch { /* optional sound setup */ }
    stateRef.current = state;

    const commandIsCurrent = useCallback((seq: number, before: ActiveTimer | null | undefined, after: ActiveTimer | null) => {
        const observed = stateRef.current?.timer;
        return commandAdoptionSeqRef.current === seq &&
            (sameTimerOccupant(observed, before) || sameTimerOccupant(observed, after));
    }, []);

    const publishTimerTransition = useCallback((event: TimerTransitionEvent) => {
        for (const listener of [...timerTransitionListenersRef.current]) {
            try { listener(event); } catch { /* consumers cannot fail a command */ }
        }
    }, []);
    const replacePauseEpisode = useCallback((episode: PauseEpisode | null) => {
        pauseEpisodeRef.current = episode;
    }, []);
    const consumePauseHandoff = useCallback(() => {
        // Other commands consume a carried episode; the command adoption
        // sequence also invalidates any in-flight attempt to carry one.
        replacePauseEpisode(pauseEpisodeRef.current?.handoff ? null : pauseEpisodeRef.current);
    }, [replacePauseEpisode]);
    const reconcilePauseEpisode = useCallback((timer: ActiveTimer | null) => {
        const episode = pauseEpisodeRef.current;
        // Snapshot adoption may invalidate identity, but can never create a pause
        // reference. A handoff's running timer still owns its carried episode.
        if (episode && (timer?.kind !== "Work" || timer.task_id !== episode.taskId ||
            windowStartedAt(timer) !== episode.windowId || (!timer.paused && !episode.handoff) ||
            (timer.paused && (timer.accumulated_secs !== episode.accumulatedSecs ||
                timer.paused_remaining_secs !== episode.pausedRemainingSecs ||
                timer.started_at !== episode.startedAt || timer.ends_at !== episode.endsAt)))) {
            replacePauseEpisode(null);
        }
    }, [replacePauseEpisode]);
    const subscribeTimerTransitions = useCallback((listener: (event: TimerTransitionEvent) => void) => {
        timerTransitionListenersRef.current.add(listener);
        return () => { timerTransitionListenersRef.current.delete(listener); };
    }, []);
    useEffect(() => () => { timerTransitionListenersRef.current.clear(); }, []);

    // Same-tab commands already adopt their staged result, so the revision
    // effect's follow-up fetch usually returns an identical view. Skip the
    // redundant setState (and its extra render) while still returning the fresh
    // clone for progression/reconciliation callers.
    const fetchAndSetState = useCallback(async () => {
        const captured = stateRef.current?.timer;
        const fetched = await data.fetchState();
        const reconciled = fetched.reconciledTimer;
        const windowId = reconciled?.kind === "Work"
            ? captured?.kind === "Work" && captured.task_id === reconciled.taskId
                ? windowStartedAt(captured)
                : [...fetched.state.logs].reverse().find(log => !log.was_break && log.task_id === reconciled.taskId && log.work_window_id)?.work_window_id ?? undefined
            : undefined;
        const result = { ...fetched, reconciledTimer: reconciled ? { ...reconciled, windowId } : null };
        stateRef.current = result.state;
        setState((current) => {
            if (current && JSON.stringify(current) === JSON.stringify(result.state)) return current;
            return result.state;
        });
        reconcilePauseEpisode(result.state.timer);
        return result;
    }, [data, reconcilePauseEpisode]);

    const maybeNotifyTimerEnd = useCallback(async (kind: TimerKind, taskId?: string) => {
        try {
            const hidden = typeof document !== "undefined" ? document.hidden : false;
            const hasFocus = typeof document !== "undefined" && typeof document.hasFocus === "function" ? document.hasFocus() : !hidden;
            if (!hidden && hasFocus) return;
            if (kind === "Work") {
                const taskName = taskId && stateRef.current?.tasks[taskId]?.name;
                await notifyNow({ title: "Pomodoro Complete", body: taskName ? `Finished: ${taskName}` : "Time for a break" });
            } else await notifyNow({ title: "Break Over", body: "Time to focus" });
        } catch { /* notifications are optional */ }
    }, []);

    const flushPendingFinalizes = useCallback((): Promise<void> => {
        if (finalizeRunRef.current) {
            reflushRef.current = true;
            return finalizeRunRef.current;
        }
        let resolveRun!: () => void;
        let rejectRun!: (error: unknown) => void;
        const active = new Promise<void>((resolve, reject) => {
            resolveRun = resolve;
            rejectRun = reject;
        });
        // Install the promise before even an empty pass can reach teardown.
        finalizeRunRef.current = active;
        const run = async () => {
            try {
                do {
                    reflushRef.current = false;
                    const queued = pendingFinalizeRef.current;
                    const { flush, keep } = partitionPendingFinalizes(
                        queued.map(entry => entry.id), stateRef.current?.timer ?? null, stateRef.current?.tasks ?? {},
                    );
                    const claimed = flush.map(id => queued.find(entry => entry.id === id)!);
                    // Claim the whole pass synchronously, preserving each entry's mode.
                    pendingFinalizeRef.current = queued.filter(entry => keep.includes(entry.id));
                    setPendingFinalizeTaskIds(keep);
                    for (const { id } of claimed) inFlightFinalizeRef.current.add(id);
                    for (const entry of claimed) {
                        const { id, mode } = entry;
                        try {
                            const result = await (mode === "archive" ? data.archiveDeferredTask(id) : data.finalizeDeferredTask(id));
                            if (result.value === "finalized") {
                                commandAdoptionSeqRef.current += 1;
                                stateRef.current = result.state;
                                setState(result.state);
                                reconcilePauseEpisode(result.state.timer);
                            } else if (result.value === "owner" && !pendingFinalizeRef.current.some(pending => pending.id === id)) {
                                const pending = [...pendingFinalizeRef.current, entry];
                                pendingFinalizeRef.current = pending;
                                setPendingFinalizeTaskIds(pending.map(item => item.id));
                            }
                        } catch (err: any) {
                            setError(err?.message || err?.toString?.() || "Unknown error");
                        } finally {
                            inFlightFinalizeRef.current.delete(id);
                        }
                    }
                } while (reflushRef.current);
            } finally {
                // Exit and clear in one synchronous segment, leaving no lost-reflush gap.
                if (finalizeRunRef.current === active) finalizeRunRef.current = null;
            }
        };
        void run().then(resolveRun, rejectRun);
        return active;
    }, [data, reconcilePauseEpisode]);

    const runProgression = useCallback(async (finishedTimer?: ActiveTimer, reconciliation?: { timer: CompletionNotice; state: AppStateData }) => {
        if (progressing.current) {
            if (reconciliation) queuedReconciliationRef.current = reconciliation;
            return;
        }
        progressing.current = true;
        try {
            setError(null);
            let applied = true;
            let after: AppStateData;
            if (reconciliation) {
                // A queued handoff may have been overtaken by the tick winner.
                // Read the current view before deciding whether a break is needed.
                after = (await fetchAndSetState()).state;
                applied = reconciliation.timer.applied;
            } else {
                if (!finishedTimer) return;
                const completion = await data.completeTimer(finishedTimer);
                applied = completion.applied;
                after = completion.state;
            }

            const windowId = finishedTimer?.kind === "Work" ? windowStartedAt(finishedTimer) : reconciliation?.timer.windowId;
            const alreadyNotified = windowId !== undefined && lastNotifiedWindowRef.current === windowId;
            if (applied && !alreadyNotified) {
                if (windowId !== undefined) lastNotifiedWindowRef.current = windowId;
                soundApi?.play(finishedTimer?.kind === "Work" || reconciliation?.timer.kind === "Work" ? "pomodoroFinish" : "breakOver");
                const kind = finishedTimer?.kind ?? reconciliation?.timer.kind;
                const taskId = finishedTimer?.task_id ?? reconciliation?.timer.taskId;
                if (kind) await maybeNotifyTimerEnd(kind, taskId);
            } else {
                // A race loser must adopt the winner's state before deciding whether to start a timer.
                after = (await fetchAndSetState()).state;
            }
            if (!reconciliation && applied && !alreadyNotified) commandAdoptionSeqRef.current += 1;
            stateRef.current = after;
            setState(after);
            reconcilePauseEpisode(after.timer);

            if (!after.timer) {
                const kind = finishedTimer?.kind ?? reconciliation?.timer.kind;
                if (kind === "Work") {
                    try {
                        // Finalize clears the selection, but the completed task
                        // still owns the ensuing break. Maintenance clears this
                        // archived selection again after the break has opened.
                        const taskId = finishedTimer?.task_id ?? reconciliation?.timer.taskId;
                        if (!after.active_task && taskId && after.tasks[taskId]) await data.setActiveTask(taskId);
                        const started = await data.startBreakTimer();
                        commandAdoptionSeqRef.current += 1;
                        stateRef.current = started.state;
                        setState(started.state);
                    } catch (err: any) { setError(err?.message || err?.toString?.() || "Failed to start break timer"); }
                } else if (after.active_task) {
                    try {
                        const before = stateRef.current?.timer;
                        const capturedSeq = commandAdoptionSeqRef.current;
                        const started = await data.startWorkTimer();
                        const at = new Date().toISOString();
                        const current = commandIsCurrent(capturedSeq, before, started.state.timer);
                        commandAdoptionSeqRef.current += 1;
                        stateRef.current = started.state;
                        setState(started.state);
                        if (current) consumePauseHandoff();
                        reconcilePauseEpisode(started.state.timer);
                        const timer = started.state.timer;
                        if (current && !reconciliation && finishedTimer && finishedTimer.kind !== "Work" &&
                            applied && !alreadyNotified && timer?.kind === "Work" && timer.task_id === after.active_task) {
                            publishTimerTransition({ type: "enter", taskId: timer.task_id, reason: "break-end", at, windowId: windowStartedAt(timer) });
                        }
                    } catch (err: any) { setError(err?.message || err?.toString?.() || "Failed to start work timer"); }
                }
            }
            await flushPendingFinalizes();
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
    }, [data, fetchAndSetState, maybeNotifyTimerEnd, publishTimerTransition, reconcilePauseEpisode, consumePauseHandoff, commandIsCurrent, flushPendingFinalizes]);

    const refresh = useCallback(async (): Promise<AppStateData> => {
        try {
            const result = await fetchAndSetState();
            if (result.reconciledTimer) await runProgression(undefined, { timer: result.reconciledTimer, state: result.state });
            if (pendingFinalizeRef.current.length || inFlightFinalizeRef.current.size) await flushPendingFinalizes();
            return result.state;
        } catch (err: any) {
            setError(err?.message || err?.toString?.() || "Unknown error");
            throw err;
        }
    }, [fetchAndSetState, runProgression, flushPendingFinalizes]);

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

    useEffect(() => {
        if (!state) return;
        const terminal = new Set(Object.values(state.tasks)
            .filter((task) => task.archived || task.completed_at !== null)
            .map((task) => task.id));
        for (const taskId of terminal) {
            if (!terminalTaskIdsRef.current.has(taskId)) {
                for (const listener of taskCompletionListenersRef.current) listener(taskId);
            }
        }
        terminalTaskIdsRef.current = terminal;
    }, [state]);

    // Runs a local command and adopts its EngineResult state directly. No
    // follow-up fetch and no sync call: the staged result is the new view.
    // Errors leave React state untouched (last persisted state stays visible)
    // and surface in `error`.
    const adoptResult = async (run: () => Promise<EngineResult<unknown>>, rethrow = false) => {
        const before = stateRef.current?.timer;
        const capturedSeq = commandAdoptionSeqRef.current;
        try {
            setError(null);
            const result = await run();
            // Task transitions already adopted and published before returning.
            // Re-adoption here would supersede a listener's deferred command.
            if (commandAdoptionsRef.current.has(result)) return;
            const current = commandIsCurrent(capturedSeq, before, result.state.timer);
            commandAdoptionSeqRef.current += 1;
            stateRef.current = result.state;
            setState(result.state);
            // Any successful generic command consumes a carried episode. Resume
            // explicitly restores it below only for a matching handoff resume.
            if (current) consumePauseHandoff();
            reconcilePauseEpisode(result.state.timer);
            commandAdoptionsRef.current.set(result, { current });
        } catch (err: any) {
            setError(err?.message || err?.toString?.() || "Unknown error");
            if (rethrow) throw err;
        }
    };

    const createTask = async (name: string, target: number) => {
        try {
            setError(null);
            const result = await data.createTask(name, target);
            commandAdoptionSeqRef.current += 1;
            stateRef.current = result.state;
            setState(result.state);
            consumePauseHandoff();
            reconcilePauseEpisode(result.state.timer);
            return result.value;
        } catch (err: any) {
            setError(err?.message || err?.toString?.() || "Unknown error");
            throw err;
        }
    };

    const adoptTaskTransition = async (run: () => Promise<EngineResult<unknown>>) => {
        const before = stateRef.current;
        const capturedSeq = commandAdoptionSeqRef.current;
        const result = await run();
        const at = new Date().toISOString();
        const current = commandIsCurrent(capturedSeq, before?.timer, result.state.timer);
        commandAdoptionSeqRef.current += 1;
        stateRef.current = result.state;
        setState(result.state);
        const outgoing = before?.timer;
        const incoming = result.state.timer;
        const episode = pauseEpisodeRef.current;
        // Completion grows logs too, but has no incoming Work occupant.
        if (current && before && outgoing?.kind === "Work" && incoming?.kind === "Work" && outgoing.task_id !== incoming.task_id) {
            const windowId = windowStartedAt(outgoing);
            const previousIds = new Set(before.logs.map(log => log.id));
            const gainedWork = result.state.logs.length > before.logs.length &&
                result.state.logs.slice(before.logs.length).some(log => !previousIds.has(log.id) &&
                    log.task_id === outgoing.task_id && !log.was_break && log.work_window_id === windowId);
            const pausedAt = episode && episode.taskId === outgoing.task_id && episode.windowId === windowId &&
                (outgoing.paused || episode.handoff) ? episode.at : undefined;
            replacePauseEpisode(null);
            if (gainedWork) publishTimerTransition({ type: "leave", taskId: outgoing.task_id, reason: "switch", at, windowId, ...(pausedAt ? { pausedAt } : {}) });
            publishTimerTransition({ type: "enter", taskId: incoming.task_id, reason: "switch", at, windowId, fromTaskId: outgoing.task_id });
        } else {
            if (current) consumePauseHandoff();
        }
        reconcilePauseEpisode(incoming);
        if (before?.timer?.kind === "Work" && !result.state.timer &&
            result.state.current_cycle_pomodoros > before.current_cycle_pomodoros) {
            await runProgression(undefined, {
                timer: { kind: "Work", taskId: before.timer.task_id, applied: true, windowId: windowStartedAt(before.timer) },
                state: result.state,
            });
        }
        const adopted = { ...result, state: stateRef.current ?? result.state };
        commandAdoptionsRef.current.set(adopted, { current });
        return adopted;
    };
    const setActiveTask = async (id: string) => {
        await adoptResult(() => adoptTaskTransition(() => data.setActiveTask(id)), true);
        await flushPendingFinalizes();
    };
    const ensureActiveTask = async () => {
        if (!state?.active_task) {
            const tasks = Object.values(state?.tasks || {}).filter((task) => !task.archived);
            if (tasks.length === 1) await data.setActiveTask(tasks[0].id);
            else if (tasks.length === 0) throw new Error("Create a task first");
            else throw new Error("Select a task first");
        }
    };
    const startWork = async () => {
        try {
            await ensureActiveTask();
            // adoptResult intentionally swallows start failures. Only the closure
            // reaching this assignment proves that a command actually succeeded.
            let success: { result: EngineResult<unknown>; at: string } | undefined;
            await adoptResult(async () => {
                const result = await data.startWorkTimer();
                success = { result, at: new Date().toISOString() };
                return result;
            });
            const timer = success?.result.state.timer;
            if (success && commandAdoptionsRef.current.get(success.result)?.current && timer?.kind === "Work") publishTimerTransition({ type: "enter", taskId: timer.task_id, reason: "start", at: success.at, windowId: windowStartedAt(timer) });
        } catch (err: any) { setError(err?.message || err?.toString?.() || "Unknown error"); }
    };
    const startBreak = async () => { try { await ensureActiveTask(); await adoptResult(() => data.startBreakTimer()); } catch (err: any) { setError(err?.message || err?.toString?.() || "Unknown error"); } };

    const completeTimer = async () => {
        const captured = state?.timer;
        if (!captured) return;
        await runProgression(captured);
    };
    const stopWork = async () => {
        const before = stateRef.current;
        const episode = pauseEpisodeRef.current;
        let success: { result: EngineResult<unknown>; at: string } | undefined;
        await adoptResult(async () => {
            const result = await data.stopWorkTimer();
            success = { result, at: new Date().toISOString() };
            return result;
        });
        const timer = before?.timer;
        if (success && commandAdoptionsRef.current.get(success.result)?.current && timer?.kind === "Work" && !success.result.state.timer) {
            const windowId = windowStartedAt(timer);
            const pausedAt = timer.paused && episode?.taskId === timer.task_id && episode.windowId === windowId ? episode.at : undefined;
            replacePauseEpisode(null);
            publishTimerTransition({ type: "leave", taskId: timer.task_id, reason: "stop", at: success.at, windowId, ...(pausedAt ? { pausedAt } : {}) });
        }
        await flushPendingFinalizes();
    };
    const skipBreak = () => adoptResult(() => data.skipBreak());
    const updateSettings = (settings: Settings) => adoptResult(() => data.updateSettings(settings));
    const finalizeTask = (id: string) => {
        const pending = pendingFinalizeRef.current.filter(entry => entry.id !== id);
        pendingFinalizeRef.current = pending;
        setPendingFinalizeTaskIds(pending.map(entry => entry.id));
        return adoptResult(() => adoptTaskTransition(() => data.finalizeTask(id)));
    };
    const requestFinalize = async (taskId: string, options?: { mode?: "finalize" | "archive" }): Promise<"finalized" | "deferred"> => {
        const mode = options?.mode ?? "finalize";
        const queued = pendingFinalizeRef.current.find(entry => entry.id === taskId);
        if (queued) {
            if (mode === "finalize" && queued.mode === "archive") {
                pendingFinalizeRef.current = pendingFinalizeRef.current.map(entry => entry.id === taskId ? { ...entry, mode } : entry);
                setPendingFinalizeTaskIds(pendingFinalizeRef.current.map(entry => entry.id));
            }
            return "deferred";
        }
        if (inFlightFinalizeRef.current.has(taskId)) return "deferred";
        if (ownsWorkWindow(stateRef.current?.timer, taskId)) {
            const pending = [...pendingFinalizeRef.current, { id: taskId, mode }];
            pendingFinalizeRef.current = pending;
            setPendingFinalizeTaskIds(pending.map(entry => entry.id));
            return "deferred";
        }
        if (mode === "archive") await archiveTask(taskId);
        else await adoptResult(() => adoptTaskTransition(() => data.finalizeTask(taskId)), true);
        return "finalized";
    };
    const archiveTask = async (id: string) => {
        try {
            setError(null);
            const result = await data.archiveTask(id);
            commandAdoptionSeqRef.current += 1;
            stateRef.current = result.state;
            setState(result.state);
            consumePauseHandoff();
            reconcilePauseEpisode(result.state.timer);
        } catch (err: any) {
            setError(err?.message || err?.toString?.() || "Unknown error");
            throw err;
        }
    };
    const startTaskWork = (id: string): Promise<"started" | "joined"> => {
        // Serialize the full free -> select -> start sequence. Rechecking after
        // an await alone still lets two free callers race before start commits.
        const pending = startTaskWorkQueueRef.current.then(async (): Promise<"started" | "joined"> => {
            try {
                setError(null);
                const occupation = workStartOccupation(stateRef.current?.timer ?? null);
                if (occupation === "blocked") throw new Error("A break is running");
                await adoptTaskTransition(() => data.setActiveTask(id));
                if (occupation === "join") {
                    await flushPendingFinalizes();
                    return "joined";
                }
                const currentOccupation = workStartOccupation(stateRef.current?.timer ?? null);
                if (currentOccupation === "blocked") throw new Error("A break is running");
                if (currentOccupation === "join") {
                    await flushPendingFinalizes();
                    return "joined";
                }
                const before = stateRef.current?.timer;
                const capturedSeq = commandAdoptionSeqRef.current;
                const started = await data.startWorkTimer();
                const at = new Date().toISOString();
                const current = commandIsCurrent(capturedSeq, before, started.state.timer);
                commandAdoptionSeqRef.current += 1;
                stateRef.current = started.state;
                setState(started.state);
                if (current) replacePauseEpisode(null);
                reconcilePauseEpisode(started.state.timer);
                const timer = started.state.timer;
                if (current && timer?.kind === "Work") publishTimerTransition({ type: "enter", taskId: timer.task_id, reason: "start", at, windowId: windowStartedAt(timer) });
                await flushPendingFinalizes();
                return "started";
            } catch (err: any) {
                setError(err?.message || err?.toString?.() || "Unknown error");
                throw err;
            }
        });
        startTaskWorkQueueRef.current = pending.catch(() => undefined);
        return pending;
    };
    const subscribeTaskCompletions = useCallback((listener: (taskId: string) => void) => {
        taskCompletionListenersRef.current.add(listener);
        return () => taskCompletionListenersRef.current.delete(listener);
    }, []);
    const pauseTimer = async () => {
        const before = stateRef.current;
        if (!before?.timer || before.timer.paused) return;
        let success: { result: EngineResult<unknown>; at: string } | undefined;
        await adoptResult(async () => {
            const result = await data.pauseTimer();
            success = { result, at: new Date().toISOString() };
            return result;
        }, true);
        const timer = success?.result.state.timer;
        if (success && commandAdoptionsRef.current.get(success.result)?.current && before.timer.kind === "Work" && timer?.kind === "Work" && timer.paused &&
            timer.task_id === before.timer.task_id && windowStartedAt(timer) === windowStartedAt(before.timer)) {
            const windowId = windowStartedAt(timer);
            replacePauseEpisode({ taskId: timer.task_id, windowId, at: success.at, handoff: false,
                accumulatedSecs: timer.accumulated_secs, pausedRemainingSecs: timer.paused_remaining_secs,
                startedAt: timer.started_at, endsAt: timer.ends_at });
            publishTimerTransition({ type: "leave", taskId: timer.task_id, reason: "pause", at: success.at, windowId });
        }
    };
    const resumeTimer = async (options?: { handoff?: boolean }) => {
        const before = stateRef.current;
        if (!before?.timer?.paused) return;
        const episode = pauseEpisodeRef.current;
        const capturedSeq = commandAdoptionSeqRef.current;
        let success: { result: EngineResult<unknown>; at: string } | undefined;
        await adoptResult(async () => {
            const result = await data.resumeTimer();
            success = { result, at: new Date().toISOString() };
            return result;
        }, true);
        if (!success) return;
        const adoption = commandAdoptionsRef.current.get(success.result);
        if (!adoption?.current) return;
        // A revision refresh can reconcile away this command's paused episode
        // after seeing its running result. Only another command invalidates the
        // captured carry; the matching task/window check below still applies.
        const canCarryEpisode = commandAdoptionSeqRef.current === capturedSeq + 1;
        replacePauseEpisode(null);
        const timer = success.result.state.timer;
        if (before.timer.kind === "Work" && timer?.kind === "Work" && !timer.paused &&
            timer.task_id === before.timer.task_id && windowStartedAt(timer) === windowStartedAt(before.timer)) {
            const windowId = windowStartedAt(timer);
            if (options?.handoff) {
                if (canCarryEpisode && episode?.taskId === timer.task_id && episode.windowId === windowId) replacePauseEpisode({ ...episode, handoff: true });
            } else publishTimerTransition({ type: "enter", taskId: timer.task_id, reason: "resume", at: success.at, windowId });
        }
    };
    const resetAll = async () => {
        pendingFinalizeRef.current = [];
        setPendingFinalizeTaskIds([]);
        try {
            setError(null);
            const result = await data.resetAppState();
            commandAdoptionSeqRef.current += 1;
            stateRef.current = result.state;
            setState(result.state);
            replacePauseEpisode(null);
        } catch (err: any) {
            setError(err?.message || err?.toString?.() || "Failed to reset");
        }
    };

    return <AppStateContext.Provider value={{ state, refresh, createTask, setActiveTask, startWork, startBreak, completeTimer, stopWork, skipBreak, updateSettings, remainingMs: () => computeRemainingMs(state?.timer, Date.now()), error, finalizeTask, requestFinalize, pendingFinalizeTaskIds, archiveTask, startTaskWork, subscribeTaskCompletions, subscribeTimerTransitions, pauseTimer, resumeTimer, isPaused: !!state?.timer?.paused, tick, resetAll }}>{children}</AppStateContext.Provider>;
};

export const useAppState = () => {
    const ctx = useContext(AppStateContext);
    if (!ctx) throw new Error("useAppState must be inside provider");
    return ctx;
};

export const useOptionalAppState = () => useContext(AppStateContext);

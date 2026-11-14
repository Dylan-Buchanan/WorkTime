import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppState } from "./AppStateContext";
import { usePM } from "./ProjectManagerContext";
import { useOptionalResumeMemo } from "./ResumeMemoContext";
import { windowRemainingSecs, windowStartedAt } from "../lib/engine";
import { findPMTaskByAppTaskId } from "../lib/pm/workStart";
import { waitingOf } from "../lib/pm/waiting";
import { classifyWhatsNextAvailability, rankWhatsNext, type WhatsNextAvailability } from "../lib/whatsNext";
import { useWindowHandoff } from "../hooks/useWindowHandoff";
import { SwitchSheet } from "../components/SwitchSheet";

export interface TaskCompletionContextValue {
    completeTask: (pmTaskId: string) => Promise<void>;
    completeAppTask: (appTaskId: string) => Promise<void>;
    openSwitchSheet: (mode: "switch" | "waiting") => void;
    busy: boolean;
}

const TaskCompletionContext = createContext<TaskCompletionContextValue | null>(null);
type Sheet = { mode: "switch" | "waiting"; reference: Date; occupantId: string | null; emptyMessage?: string };

function emptyMessage(availability: WhatsNextAvailability): string | undefined {
    const reason = availability.dominantReason;
    if (!reason) return undefined;
    const count = availability.counts[reason];
    const subject = count === 1 ? "1 task is" : `${count} tasks are`;
    const explanation = {
        "project-not-workable": "in projects not scheduled for today",
        blocked: "blocked",
        waiting: "waiting on someone",
        "backend-closed": "already finished on the timer",
    }[reason];
    return `Nothing to switch to right now: ${subject} ${explanation}.`;
}

export function TaskCompletionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
    const app = useAppState();
    const pm = usePM();
    const memo = useOptionalResumeMemo();
    const latest = useRef({ app, pm, memo });
    useLayoutEffect(() => { latest.current = { app, pm, memo }; });
    const mounted = useRef(true);
    // Claim IDs at enqueue time, covering both queued and running completions.
    const inFlight = useRef(new Set<string>());
    const queue = useRef<Array<{ taskId: string; resolve: () => void; reject: (error: unknown) => void }>>([]);
    const running = useRef(false);
    const holds = useRef(new Set<() => void>());
    const sheetHold = useRef<(() => void) | null>(null);
    const [completing, setCompleting] = useState(false);
    const [sheet, setSheet] = useState<Sheet | null>(null);
    const releaseSheetHold = () => {
        sheetHold.current?.();
        sheetHold.current = null;
    };
    const handoff = useWindowHandoff(() => {
        releaseSheetHold();
        setSheet(null);
    }, sheet ?? undefined);
    useEffect(() => {
        mounted.current = true;
        const activeHolds = holds.current;
        return () => {
            mounted.current = false;
            for (const release of activeHolds) release();
        };
    }, []);

    const closeSheet = () => {
        handoff.cancel();
        releaseSheetHold();
        setSheet(null);
    };
    const openSwitchSheet = (mode: "switch" | "waiting") => {
        if (inFlight.current.size) return;
        const reference = new Date();
        const { app, pm } = latest.current;
        const timer = app.state?.timer;
        const occupant = timer?.kind === "Work" ? findPMTaskByAppTaskId(pm.state.tasks, timer.task_id) : null;
        handoff.cancel();
        if (mode === "waiting" && occupant) {
            pm.updateTask(occupant.id, { waiting: { type: "agent", since: reference.toISOString() } });
        }
        setSheet({ mode, reference, occupantId: occupant?.id ?? null });
    };
    const complete = async (appTaskId: string, refreshState: boolean) => {
        if (!mounted.current) return;
        // React may batch the previous sequence's adoption until after this
        // continuation. Read its committed view before deciding the next branch.
        const state = refreshState ? await latest.current.app.refresh() : latest.current.app.state;
        if (!mounted.current || !state?.tasks[appTaskId]) return;
        const reference = new Date();
        let release: (() => void) | undefined;
        try {
            const { pm } = latest.current;
            const timer = state.timer;
            if (timer?.kind !== "Work" || timer.task_id !== appTaskId || windowRemainingSecs(timer, reference) <= 0) {
                await latest.current.app.finalizeTask(appTaskId, { rethrow: true });
                return;
            }
            const occupantId = findPMTaskByAppTaskId(pm.state.tasks, timer.task_id)?.id ?? null;
            const availability = classifyWhatsNextAvailability({
                pmTasks: Object.values(pm.state.tasks), backendTasks: state.tasks,
                projects: pm.state.projects, currentOccupantId: occupantId, reference,
            });
            if (!availability.hasAnything) {
                await latest.current.app.finalizeTask(appTaskId, { rethrow: true });
                return;
            }
            const expect = { taskId: appTaskId, windowStartedAt: windowStartedAt(timer) };
            const stillOccupant = () => {
                const current = latest.current.app.state?.timer;
                return current?.kind === "Work" && current.task_id === expect.taskId &&
                    windowStartedAt(current) === expect.windowStartedAt;
            };
            const releaseMemo = latest.current.memo?.holdMemoPresentation();
            const releaseHold = () => {
                if (!holds.current.delete(releaseHold)) return;
                releaseMemo?.();
            };
            release = releaseHold;
            holds.current.add(releaseHold);
            if (!timer.paused) await latest.current.app.pauseTimer({ expect });
            if (!mounted.current) return;
            if (!stillOccupant()) {
                await latest.current.app.finalizeTask(appTaskId, { rethrow: true });
                return;
            }
            await latest.current.app.completeTaskKeepingWindow(appTaskId);
            if (!mounted.current || !stillOccupant()) return;
            handoff.cancel();
            releaseSheetHold();
            sheetHold.current = release;
            release = undefined;
            setSheet({ mode: "switch", reference, occupantId,
                emptyMessage: availability.hasWorkable ? undefined : emptyMessage(availability) });
        } finally {
            release?.();
        }
    };
    const drain = async () => {
        running.current = true;
        let refreshState = false;
        while (queue.current.length) {
            const entry = queue.current.shift()!;
            try {
                await complete(entry.taskId, refreshState);
                entry.resolve();
            } catch (error) {
                entry.reject(error);
            } finally {
                refreshState = true;
                inFlight.current.delete(entry.taskId);
                if (mounted.current) setCompleting(inFlight.current.size > 0);
            }
        }
        running.current = false;
    };
    const enqueue = (appTaskId: string): Promise<void> => {
        if (!mounted.current || inFlight.current.has(appTaskId)) return Promise.resolve();
        inFlight.current.add(appTaskId);
        setCompleting(true);
        return new Promise<void>((resolve, reject) => {
            queue.current.push({ taskId: appTaskId, resolve, reject });
            if (!running.current) void drain();
        });
    };
    const completeTask = async (pmTaskId: string) => {
        const appTaskId = latest.current.pm.state.tasks[pmTaskId]?.appTaskId;
        if (appTaskId) await enqueue(appTaskId);
    };
    const completeAppTask = (appTaskId: string) => enqueue(appTaskId);
    const timer = app.state?.timer;
    const occupantId = timer?.kind === "Work" ? findPMTaskByAppTaskId(pm.state.tasks, timer.task_id)?.id ?? null : null;
    const sheetOccupant = sheet?.occupantId ? pm.state.tasks[sheet.occupantId] : undefined;
    const waiting = sheetOccupant ? waitingOf(sheetOccupant) : null;

    return <TaskCompletionContext.Provider value={{ completeTask, completeAppTask, openSwitchSheet,
        busy: completing || handoff.busyTaskId !== null }}>
        {children}
        {sheet && <SwitchSheet mode={sheet.mode} result={rankWhatsNext({
            pmTasks: Object.values(pm.state.tasks), backendTasks: app.state?.tasks ?? {}, projects: pm.state.projects,
            currentOccupantId: occupantId, reference: sheet.reference,
        })} projects={pm.state.projects} emptyMessage={sheet.emptyMessage}
            linkStateOf={handoff.linkStateOf} linkErrorOf={handoff.linkErrorOf}
            waitingType={waiting?.type} onSetWaitingType={(type) => {
                if (sheet.occupantId && waiting) pm.updateTask(sheet.occupantId, { waiting: { ...waiting, type } });
            }}
            onSelect={handoff.select} onRetryLink={handoff.retry} onClose={closeSheet}
            busyTaskId={handoff.busyTaskId} notice={handoff.notice} error={handoff.error} />}
    </TaskCompletionContext.Provider>;
}

export function useTaskCompletion(): TaskCompletionContextValue {
    const context = useOptionalTaskCompletion();
    if (!context) throw new Error("useTaskCompletion must be inside provider");
    return context;
}

export function useOptionalTaskCompletion(): TaskCompletionContextValue | null {
    return useContext(TaskCompletionContext);
}

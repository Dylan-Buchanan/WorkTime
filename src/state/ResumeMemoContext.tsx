import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ResumeMemoSheet, type ResumeMemoSheetProps } from "../components/ResumeMemoSheet";
import { dismissResumeNote, getResumeNote, saveResumeNote } from "../lib/resume";
import { findPMTaskByAppTaskId } from "../lib/pm/workStart";
import { useAppState } from "./AppStateContext";
import { usePM } from "./ProjectManagerContext";
import type { TimerTransitionEvent } from "./timerTransitions";

export interface ResumeMemoContextValue {
    lastEnter: TimerTransitionEvent & { type: "enter" } | null;
    openMemo: (taskId: string) => void;
    notesVersion: number;
    dismissNote: (taskId: string) => void;
    emptyCardDismissal: { taskId: string; at: string } | null;
    dismissEmptyCard: (taskId: string) => void;
    /** Internal overlay coordination. Returns an idempotent release function. */
    holdMemoPresentation: () => () => void;
}

type Leave = Extract<TimerTransitionEvent, { type: "leave" }>;
type Request = { taskId: string; leave?: Leave; incomingId?: string };
type Capture = Pick<ResumeMemoSheetProps, "mode" | "outgoing" | "incoming"> & { id: number };
const ResumeMemoContext = createContext<ResumeMemoContextValue | undefined>(undefined);

/** Surface-local capture only. Cross-tab policy is last writer wins by savedAt;
 * freshness is eventual on read, with the resume store as the only writer. */
export function ResumeMemoProvider({ children }: { children: ReactNode }) {
    const app = useAppState();
    const pm = usePM();
    const latest = useRef({ app, pm });
    useLayoutEffect(() => { latest.current = { app, pm }; });
    const [lastEnter, setLastEnter] = useState<ResumeMemoContextValue["lastEnter"]>(null);
    const recordedEnter = useRef<ResumeMemoContextValue["lastEnter"]>(null);
    const [emptyCardDismissal, setEmptyCardDismissal] = useState<ResumeMemoContextValue["emptyCardDismissal"]>(null);
    const [notesVersion, setNotesVersion] = useState(0);
    const [active, setActive] = useState<Capture | null>(null);
    const activeRef = useRef<Capture | null>(null);
    const [error, setError] = useState<string | null>(null);
    const queue = useRef<Request[]>([]);
    const pendingSwitch = useRef<Leave | null>(null);
    const holds = useRef(0);
    const sequence = useRef(0);
    const mounted = useRef(false);
    const scheduled = useRef<ReturnType<typeof setTimeout> | null>(null);
    const present = useRef<() => void>(() => {});

    // A scheduled pass is explicit UI work, never part of command dispatch.
    const schedule = useCallback(() => {
        if (!mounted.current || scheduled.current !== null) return;
        scheduled.current = setTimeout(() => {
            scheduled.current = null;
            if (mounted.current) present.current();
        }, 0);
    }, []);
    const eligible = (taskId: string) => {
        const { app: currentApp, pm: currentPM } = latest.current;
        const task = currentApp.state?.tasks[taskId];
        return task && task.completed_at === null && !task.archived &&
            !findPMTaskByAppTaskId(currentPM.state.tasks, taskId)?.isArchived ? task : null;
    };
    present.current = () => {
        setLastEnter(recordedEnter.current);
        if (holds.current || activeRef.current) return;
        while (queue.current.length) {
            const request = queue.current.shift()!;
            const task = eligible(request.taskId);
            if (!task) continue;
            const memo = getResumeNote(task.id);
            const alreadyCaptured = memo != null && request.leave?.pausedAt !== undefined &&
                Date.parse(memo.savedAt) >= Date.parse(request.leave.pausedAt);
            if (request.leave?.reason === "stop" && alreadyCaptured) continue;
            const incomingTask = request.incomingId ? latest.current.app.state?.tasks[request.incomingId] : undefined;
            const capture: Capture = {
                id: ++sequence.current,
                mode: request.incomingId ? "switch" : "leave",
                outgoing: { taskId: task.id, taskName: task.name, memo, alreadyCaptured },
                ...(request.incomingId ? { incoming: {
                    taskId: request.incomingId,
                    taskName: incomingTask?.name ?? request.incomingId,
                    memo: getResumeNote(request.incomingId),
                } } : {}),
            };
            activeRef.current = capture;
            setError(null);
            setActive(capture);
            break;
        }
    };

    useEffect(() => {
        mounted.current = true;
        const unsubscribe = app.subscribeTimerTransitions((published) => {
            const event = { ...published };
            recordedEnter.current = event.type === "enter" ? event : null;
            const pending = pendingSwitch.current;
            pendingSwitch.current = null;
            if (event.type === "leave") {
                if (event.reason === "switch") pendingSwitch.current = event;
                else queue.current.push({ taskId: event.taskId, leave: event });
            } else if (event.reason === "switch" && pending && pending.windowId === event.windowId &&
                pending.at === event.at && pending.taskId === event.fromTaskId) {
                queue.current.push({ taskId: pending.taskId, leave: pending, incomingId: event.taskId });
            }
            schedule();
        });
        schedule();
        return () => {
            mounted.current = false;
            unsubscribe();
            if (scheduled.current !== null) clearTimeout(scheduled.current);
            scheduled.current = null;
        };
    }, [app.subscribeTimerTransitions, schedule]);

    const openMemo = useCallback((taskId: string) => {
        queue.current.push({ taskId });
        schedule();
    }, [schedule]);
    const holdMemoPresentation = useCallback(() => {
        holds.current += 1;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            holds.current -= 1;
            if (!holds.current) schedule();
        };
    }, [schedule]);
    const dismissNote = useCallback((taskId: string) => {
        if (dismissResumeNote(taskId, new Date().toISOString())) setNotesVersion((value) => value + 1);
    }, []);
    const dismissEmptyCard = useCallback((taskId: string) => {
        const enter = recordedEnter.current;
        if (enter?.taskId === taskId) setEmptyCardDismissal({ taskId, at: enter.at });
    }, []);
    const close = () => {
        activeRef.current = null;
        setActive(null);
        setError(null);
        schedule();
    };
    const save: ResumeMemoSheetProps["onSave"] = async (taskId, input) => {
        if (!eligible(taskId)) { close(); return; }
        const whereIAm = input.whereIAm.trim();
        const nextAction = input.nextAction.trim();
        const blocker = input.blocker?.trim();
        if (!whereIAm && !nextAction && !blocker) { close(); return; }
        const result = saveResumeNote(taskId, {
            whereIAm, nextAction, ...(blocker ? { blocker } : {}), savedAt: new Date().toISOString(),
        });
        if (!result.ok) {
            setError("Could not save your note. Please try again.");
            return;
        }
        setNotesVersion((value) => value + 1);
        close();
    };

    return <ResumeMemoContext.Provider value={{ lastEnter, openMemo, notesVersion, dismissNote, emptyCardDismissal, dismissEmptyCard, holdMemoPresentation }}>
        {children}
        {active && <ResumeMemoSheet key={active.id} {...active} onSave={save} onDismiss={close} error={error} />}
    </ResumeMemoContext.Provider>;
}

export function useOptionalResumeMemo(): ResumeMemoContextValue | undefined {
    return useContext(ResumeMemoContext);
}

export function useResumeMemo(): ResumeMemoContextValue {
    const context = useOptionalResumeMemo();
    if (!context) throw new Error("useResumeMemo must be used within ResumeMemoProvider");
    return context;
}

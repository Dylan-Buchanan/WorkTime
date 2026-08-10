import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { TaskChange } from "../lib/engine/diffEngine";
import type { PMTask } from "./types";
import { applyTaskChange } from "../lib/agent/applyTaskChange";
import { usePM } from "./ProjectManagerContext";

export type AgentMode = "start-of-day" | "end-of-day" | "chat";
export type AgentWorkflowStatus = "idle" | "reviewing" | "replanning" | "completed" | "error";

export interface AgentReplanInput {
    projectId: string;
    mode: AgentMode;
    workingTasks: PMTask[];
    approvedChanges: TaskChange[];
    rejectedChange: TaskChange;
}

export interface StartAgentReviewInput {
    projectId: string;
    mode: AgentMode;
    changes: TaskChange[];
    summary?: string;
    replan: (input: AgentReplanInput) => Promise<TaskChange[]>;
    onComplete?: (input: AgentReviewCompletionInput) => void | Promise<void>;
}

export interface AgentReviewCompletionInput {
    projectId: string;
    mode: AgentMode;
    summary: string | null;
    approvedChanges: TaskChange[];
}

interface AgentApprovalContextShape {
    mode: AgentMode | null;
    status: AgentWorkflowStatus;
    summary: string | null;
    projectId: string | null;
    changes: TaskChange[];
    currentIndex: number;
    currentChange: TaskChange | null;
    approvedChanges: TaskChange[];
    error: string | null;
    showRevert: boolean;
    selectMode: (mode: AgentMode) => void;
    startReview: (input: StartAgentReviewInput) => boolean;
    approveCurrent: () => Promise<void>;
    rejectCurrent: () => Promise<void>;
    revert: (confirmationToken?: string) => ReturnType<ReturnType<typeof usePM>["revertAgentSnapshot"]>;
    dismissRevert: () => void;
    reset: () => void;
}

const AgentApprovalContext = createContext<AgentApprovalContextShape | undefined>(undefined);

function messageFrom(error: unknown): string {
    return error instanceof Error && error.message ? error.message : "The agent workflow could not continue.";
}

export const AgentApprovalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const pm = usePM();
    const [mode, setMode] = useState<AgentMode | null>(null);
    const [status, setStatus] = useState<AgentWorkflowStatus>("idle");
    const [summary, setSummary] = useState<string | null>(null);
    const [projectId, setProjectId] = useState<string | null>(null);
    const [changes, setChanges] = useState<TaskChange[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [approvedChanges, setApprovedChanges] = useState<TaskChange[]>([]);
    const [error, setError] = useState<string | null>(null);
    // Workflow state is intentionally ephemeral, but the snapshot survives an
    // app restart so the manual revert path must remain discoverable.
    const [showRevert, setShowRevert] = useState(() => Boolean(pm.getAgentSnapshot()));
    const [replanner, setReplanner] = useState<StartAgentReviewInput["replan"] | null>(null);
    const [completer, setCompleter] = useState<StartAgentReviewInput["onComplete"] | null>(null);
    const reviewActiveRef = useRef(false);
    const actionInFlightRef = useRef(false);
    const completionFiredRef = useRef(false);
    const currentChange = changes[currentIndex] ?? null;

    const notifyComplete = useCallback(async (
        callback: StartAgentReviewInput["onComplete"] | null,
        completion: AgentReviewCompletionInput,
    ) => {
        if (completionFiredRef.current) return;
        completionFiredRef.current = true;
        try {
            await callback?.(completion);
        } catch (caught) {
            setError(messageFrom(caught));
        } finally {
            reviewActiveRef.current = false;
            actionInFlightRef.current = false;
        }
    }, []);

    const finishIfLast = useCallback(async (nextIndex: number, total: number, nextApproved: TaskChange[]) => {
        if (nextIndex >= total) {
            setStatus("completed");
            setShowRevert(true);
            if (projectId && mode) {
                await notifyComplete(completer, {
                    projectId,
                    mode,
                    summary,
                    approvedChanges: [...nextApproved],
                });
            }
        } else {
            setCurrentIndex(nextIndex);
            setStatus("reviewing");
        }
    }, [completer, mode, notifyComplete, projectId, summary]);

    const startReview = useCallback((input: StartAgentReviewInput): boolean => {
        if (reviewActiveRef.current) return false;
        const snapshot = pm.captureAgentSnapshot(input.projectId);
        if (!snapshot) {
            setError("Select an existing project before starting an agent review.");
            setStatus("error");
            return false;
        }
        reviewActiveRef.current = true;
        actionInFlightRef.current = false;
        completionFiredRef.current = false;
        setMode(input.mode);
        setProjectId(input.projectId);
        setSummary(input.summary?.trim() || null);
        setChanges([...input.changes]);
        setCurrentIndex(0);
        setApprovedChanges([]);
        setReplanner(() => input.replan);
        setCompleter(() => input.onComplete ?? null);
        setError(null);
        setShowRevert(input.changes.length === 0);
        setStatus(input.changes.length === 0 ? "completed" : "reviewing");
        if (input.changes.length === 0) {
            void notifyComplete(input.onComplete ?? null, {
                projectId: input.projectId,
                mode: input.mode,
                summary: input.summary?.trim() || null,
                approvedChanges: [],
            });
        }
        return true;
    }, [notifyComplete, pm.captureAgentSnapshot]);

    const approveCurrent = useCallback(async () => {
        if (actionInFlightRef.current || !currentChange || !mode || !projectId || (status !== "reviewing" && status !== "error")) return;
        actionInFlightRef.current = true;
        setStatus("reviewing");
        setError(null);
        try {
            await applyTaskChange(currentChange, projectId, pm);
            const nextApproved = [...approvedChanges, currentChange];
            setApprovedChanges(nextApproved);
            await finishIfLast(currentIndex + 1, changes.length, nextApproved);
        } catch (caught) {
            setError(messageFrom(caught));
            setStatus("error");
        } finally {
            actionInFlightRef.current = false;
        }
    }, [approvedChanges, changes.length, currentChange, currentIndex, finishIfLast, mode, pm, projectId, status]);

    const rejectCurrent = useCallback(async () => {
        if (actionInFlightRef.current || !currentChange || !mode || !projectId || !replanner || (status !== "reviewing" && status !== "error")) return;
        actionInFlightRef.current = true;
        setError(null);
        setStatus("replanning");
        try {
            const workingTasks = Object.values(pm.state.tasks)
                .filter((task) => task.projectId === projectId && !task.isArchived)
                .map((task) => ({ ...task, tags: [...task.tags], links: [...task.links], checklist: task.checklist.map((item) => ({ ...item })), relatedTo: [...task.relatedTo] }));
            const replanned = await replanner({ projectId, mode, workingTasks, approvedChanges: [...approvedChanges], rejectedChange: currentChange });
            setChanges([...approvedChanges, ...replanned]);
            setCurrentIndex(approvedChanges.length);
            if (replanned.length === 0) {
                setStatus("completed");
                setShowRevert(true);
                await notifyComplete(completer, {
                    projectId,
                    mode,
                    summary,
                    approvedChanges: [...approvedChanges],
                });
            } else {
                setStatus("reviewing");
            }
        } catch (caught) {
            setError(messageFrom(caught));
            setStatus("error");
        } finally {
            actionInFlightRef.current = false;
        }
    }, [approvedChanges, completer, currentChange, mode, notifyComplete, pm.state.tasks, projectId, replanner, status, summary]);

    const revert = useCallback((confirmationToken?: string) => {
        const result = pm.revertAgentSnapshot(confirmationToken);
        if (result.status === "reverted") {
            pm.clearAgentSnapshot();
            reviewActiveRef.current = false;
            actionInFlightRef.current = false;
            completionFiredRef.current = false;
            setShowRevert(false);
            setStatus("idle");
            setCompleter(null);
        }
        return result;
    }, [pm.clearAgentSnapshot, pm.revertAgentSnapshot]);

    const reset = useCallback(() => {
        reviewActiveRef.current = false; actionInFlightRef.current = false; completionFiredRef.current = false;
        setStatus("idle"); setSummary(null); setProjectId(null); setChanges([]); setCurrentIndex(0);
        setApprovedChanges([]); setError(null); setShowRevert(false); setReplanner(null); setCompleter(null);
    }, []);

    const value = useMemo<AgentApprovalContextShape>(() => ({
        mode, status, summary, projectId, changes, currentIndex, currentChange, approvedChanges, error, showRevert,
        selectMode: setMode, startReview, approveCurrent, rejectCurrent, revert,
        dismissRevert: () => setShowRevert(false), reset,
    }), [approvedChanges, approveCurrent, changes, currentChange, currentIndex, error, mode, projectId, rejectCurrent, reset, revert, showRevert, startReview, status, summary]);

    return <AgentApprovalContext.Provider value={value}>{children}</AgentApprovalContext.Provider>;
};

export function useAgentApproval(): AgentApprovalContextShape {
    const context = useContext(AgentApprovalContext);
    if (!context) throw new Error("useAgentApproval must be used within AgentApprovalProvider");
    return context;
}

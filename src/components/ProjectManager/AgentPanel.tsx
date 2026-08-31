import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronDown, RotateCcw, Send, Settings2, Sparkles, X } from "lucide-react";
import { Link } from "react-router-dom";
import { getAgentApiKey, subscribeToAgentApiKey } from "../../lib/agent/apiKey";
import { saveAgentStartOfDayPlan } from "../../lib/agent/startOfDayPlanStore";
import {
    runEndOfDayWorkflow,
    type EndOfDayWorkflowResult,
} from "../../lib/agent/endOfDayWorkflow";
import {
    runStartOfDayWorkflow,
    summarizeStartOfDayApprovedChanges,
    type StartOfDayPhase,
    type StartOfDayProgressEvent,
    type StartOfDayWorkflowResult,
} from "../../lib/agent/startOfDayWorkflow";
import {
    runChatWorkflow,
    type AgentChatMessage,
} from "../../lib/agent/chatWorkflow";
import { type AgentMode, useAgentApproval } from "../../state/AgentApprovalContext";
import { useAppState } from "../../state/AppStateContext";
import { usePM } from "../../state/ProjectManagerContext";
import { useHabits } from "../../state/HabitContext";
import type { TaskChange } from "../../lib/engine/diffEngine";
import { AgentApprovalCard } from "./AgentApprovalCard";
import type { GoogleCalendarDataAccess, GoogleCalendarInterval } from "../../lib/data/GoogleCalendarDataAccess";
import { resolvePlannerWorkUntil } from "../../lib/engine/plannerContext";

const MODES: { id: AgentMode; label: string; description: string }[] = [
    { id: "start-of-day", label: "Start of Day", description: "Prioritize and shape today's plan" },
    { id: "end-of-day", label: "End of Day", description: "Review progress and prepare tomorrow" },
    { id: "chat", label: "Chat", description: "Plan through a focused conversation" },
];

const PROGRESS_EVENT_LIMIT = 20;
const PHASE_LABELS: Record<StartOfDayPhase, string> = {
    "building-context": "Building context",
    planning: "Planning",
    "validating-plan": "Validating plan",
    writing: "Writing",
    "validating-copy": "Validating copy",
    diffing: "Preparing changes",
    completed: "Plan ready",
};
const PROGRESS_STEPS = ["Context", "Plan", "Write", "Finalize"] as const;

const StartOfDayPlanPreview: React.FC<{ plan: StartOfDayWorkflowResult }> = ({ plan }) => (
    <section aria-label="Today's recommended order" className="mb-3 rounded-xl border border-violet-400/30 bg-violet-500/10 p-3">
        <div className="flex items-start justify-between gap-3">
            <div>
                <h2 className="font-semibold text-violet-100">Today’s recommended order</h2>
                <p className="mt-0.5 text-[10px] text-violet-200/70">
                    Work top to bottom within the {plan.workBudgetPomos}-pomodoro window ending at {plan.workUntil.slice(11, 16)}.
                </p>
            </div>
            <span className="shrink-0 rounded-full bg-violet-400/15 px-2 py-1 text-[10px] font-medium text-violet-100">{plan.orderedTasks.length} tasks</span>
        </div>
        {plan.summary && <p className="mt-2 rounded-lg bg-neutral-950/40 p-2 text-[11px] leading-relaxed text-neutral-200">{plan.summary}</p>}
        <ol className="mt-3 space-y-2">
            {plan.orderedTasks.map((task, index) => (
                <li key={`${task.taskId ?? task.splitsFrom ?? "new"}-${index}`} className="flex items-start gap-2 rounded-lg bg-neutral-950/50 px-2.5 py-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-400/20 text-[10px] font-semibold text-violet-100">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                            <span className="font-medium leading-snug text-neutral-100">{task.title}</span>
                            <span className="shrink-0 text-[10px] font-medium text-violet-200">{task.plannedPomos}p</span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-neutral-500">
                            {task.rollover ? `Roll over after ${task.plannedPomos} of ${task.estimatePomos ?? task.plannedPomos}p` : "Complete this task before moving on"}
                        </div>
                    </div>
                </li>
            ))}
        </ol>
    </section>
);

const EndOfDayPreview: React.FC<{ result: EndOfDayWorkflowResult }> = ({ result }) => (
    <section aria-label="Tomorrow overview" className="mb-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
        <div className="flex items-start justify-between gap-3">
            <div>
                <h2 className="font-semibold text-emerald-100">Tomorrow overview</h2>
                <p className="mt-0.5 text-[10px] text-emerald-200/70">
                    {result.comparison.completedCount} completed, {result.comparison.partialCount} partial, {result.comparison.notStartedCount} not started from today&apos;s plan.
                </p>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-1 text-[10px] font-medium text-emerald-100">{result.tomorrowTasks.length} remaining</span>
        </div>
        <p className="mt-2 rounded-lg bg-neutral-950/40 p-2 text-[11px] leading-relaxed text-neutral-200">{result.summary}</p>
        {result.tomorrowTasks.length > 0 && <ol className="mt-3 space-y-1.5">
            {result.tomorrowTasks.map((task, index) => <li key={task.taskId} className="flex items-center gap-2 rounded-lg bg-neutral-950/50 px-2.5 py-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-[10px] font-semibold text-emerald-100">{index + 1}</span><span className="min-w-0 flex-1 truncate font-medium text-neutral-100">{task.title}</span><span className="text-[10px] text-neutral-500">{task.priority}</span></li>)}
        </ol>}
    </section>
);

function phaseStep(phase: StartOfDayPhase): number {
    if (phase === "building-context") return 0;
    if (phase === "planning" || phase === "validating-plan") return 1;
    if (phase === "writing" || phase === "validating-copy") return 2;
    return 3;
}

function latestPhase(events: readonly StartOfDayProgressEvent[]): StartOfDayPhase {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.type === "phase") return event.phase;
    }
    return "building-context";
}

function durationLabel(durationMs: number): string {
    return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`;
}

function progressEventLabel(event: StartOfDayProgressEvent, detailed = false): string {
    const run = event.run === "replan" ? "Replan · " : "";
    if (event.type === "phase") return `${run}${PHASE_LABELS[event.phase]}`;
    const role = event.role === "planner" ? "Planner" : "Writer";
    const outcome = event.outcome === "valid"
        ? "valid"
        : event.outcome === "transport-error"
            ? "transport error"
            : event.responseKind?.replace(/-/g, " ") ?? "invalid";
    const base = `${run}${role} · ${event.model} · attempt ${event.attempt}/${event.maxAttempts} · ${durationLabel(event.durationMs)} · ${outcome}`;
    if (!detailed) return base;
    return [
        base,
        event.validationError ? `Error: ${event.validationError}` : null,
        event.retryFeedback ? `Retry feedback: ${event.retryFeedback}` : null,
    ].filter(Boolean).join(" · ");
}

const AgentProgress = React.memo(function AgentProgress({ events, onClear }: {
    events: StartOfDayProgressEvent[];
    onClear: () => void;
}) {
    if (events.length === 0) return null;
    const phase = latestPhase(events);
    const currentStep = phaseStep(phase);
    const complete = phase === "completed";
    const latest = events[events.length - 1];
    return (
        <section aria-label="Agent activity" className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900/80 p-3">
            <ol aria-label="Planning phases" className="grid grid-cols-4 gap-1">
                {PROGRESS_STEPS.map((label, index) => {
                    const finished = complete || index < currentStep;
                    const current = !complete && index === currentStep;
                    return <li key={label} className="flex flex-col items-center gap-1 text-[9px] text-neutral-500"><span aria-hidden className={`h-2 w-2 rounded-full ${finished ? "bg-emerald-400" : current ? "bg-violet-400 ring-2 ring-violet-400/20" : "bg-neutral-700"}`} /><span className={finished || current ? "text-neutral-300" : undefined}>{label}</span></li>;
                })}
            </ol>
            <p aria-live="polite" aria-atomic="true" className="mt-2 min-h-4 text-[11px] text-violet-200">{progressEventLabel(latest)}</p>
            <details className="mt-2 border-t border-neutral-800 pt-2 text-[10px] text-neutral-400">
                <summary className="cursor-pointer select-none text-neutral-300">Details ({events.length})</summary>
                <div className="mt-2 flex justify-end">
                    <button type="button" onClick={onClear} className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800">Clear activity</button>
                </div>
                <ol className="mt-2 max-h-36 space-y-1 overflow-y-auto" aria-label="Agent activity log">
                    {events.map((event, index) => <li key={`${event.type}-${index}`} className="break-words rounded bg-neutral-950/60 px-2 py-1">{progressEventLabel(event, true)}</li>)}
                </ol>
            </details>
        </section>
    );
});

function initialWorkUntil(): string {
    const date = new Date();
    const targetHour = date.getHours() < 17 ? 17 : Math.min(23, date.getHours() + 2);
    return `${String(targetHour).padStart(2, "0")}:00`;
}

function rejectionFeedback(change: TaskChange): string {
    const title = change.after?.title ?? change.before?.title ?? change.taskId ?? "the proposal";
    return `The user rejected the ${change.type} change for "${title}". Keep already applied work and produce a different valid target.`;
}

export const AgentPanel: React.FC<{
    runStartOfDay?: typeof runStartOfDayWorkflow;
    runEndOfDay?: typeof runEndOfDayWorkflow;
    runChat?: typeof runChatWorkflow;
    googleCalendarDataAccess?: GoogleCalendarDataAccess;
}> = ({ runStartOfDay = runStartOfDayWorkflow, runEndOfDay = runEndOfDayWorkflow, runChat = runChatWorkflow, googleCalendarDataAccess }) => {
    const agent = useAgentApproval();
    const pm = usePM();
    const app = useAppState();
    const habits = useHabits();
    const [open, setOpen] = useState(false);
    const [hasKey, setHasKey] = useState(() => Boolean(getAgentApiKey()));
    const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
    const [conflictCount, setConflictCount] = useState(0);
    const [revertMessage, setRevertMessage] = useState<string | null>(null);
    const [workUntil, setWorkUntil] = useState(initialWorkUntil);
    const [generating, setGenerating] = useState(false);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [calendarRefreshing, setCalendarRefreshing] = useState(false);
    const [calendarFeedback, setCalendarFeedback] = useState<string | null>(null);
    const [progressEvents, setProgressEvents] = useState<StartOfDayProgressEvent[]>([]);
    const [planPreview, setPlanPreview] = useState<StartOfDayWorkflowResult | null>(null);
    const [endOfDayPreview, setEndOfDayPreview] = useState<EndOfDayWorkflowResult | null>(null);
    const [chatDraft, setChatDraft] = useState("");
    const [chatMessages, setChatMessages] = useState<AgentChatMessage[]>([]);
    const latestWorkflow = useRef<StartOfDayWorkflowResult | null>(null);
    const latestEndOfDayWorkflow = useRef<EndOfDayWorkflowResult | null>(null);
    const generationInFlightRef = useRef(false);
    const pmStateRef = useRef(pm.state);
    const appStateRef = useRef(app.state);
    const workUntilRef = useRef(workUntil);
    const chatMessagesRef = useRef(chatMessages);
    const habitStateRef = useRef(habits.state);
    const approveCurrentRef = useRef(agent.approveCurrent);
    const rejectCurrentRef = useRef(agent.rejectCurrent);
    pmStateRef.current = pm.state;
    appStateRef.current = app.state;
    workUntilRef.current = workUntil;
    chatMessagesRef.current = chatMessages;
    habitStateRef.current = habits.state;
    approveCurrentRef.current = agent.approveCurrent;
    rejectCurrentRef.current = agent.rejectCurrent;
    const appendProgress = useCallback((event: StartOfDayProgressEvent) => {
        setProgressEvents((current) => [...current, event].slice(-PROGRESS_EVENT_LIMIT));
    }, []);
    const clearProgress = useCallback(() => setProgressEvents([]), []);
    useEffect(() => subscribeToAgentApiKey((key) => setHasKey(Boolean(key))), []);
    useEffect(() => { if (agent.status === "reviewing" || agent.status === "replanning") setOpen(true); }, [agent.status]);

    const handleRevert = () => {
        const result = agent.revert(confirmationToken ?? undefined);
        if (result.status === "conflicts") {
            setConfirmationToken(result.confirmationToken);
            setConflictCount(result.conflicts.length);
            return;
        }
        setConfirmationToken(null);
        setConflictCount(0);
        setRevertMessage(result.status === "reverted" ? "Agent changes reverted." : result.status === "no-snapshot" ? "No agent snapshot is available." : "The snapshot project no longer exists.");
    };

    const fetchCalendarBusy = async (now: Date, selectedWorkUntil: string, report: boolean): Promise<GoogleCalendarInterval[]> => {
        if (!googleCalendarDataAccess) return [];
        const absoluteWorkUntil = resolvePlannerWorkUntil(now, selectedWorkUntil);
        if (!absoluteWorkUntil || absoluteWorkUntil <= now) return [];
        const settings = await googleCalendarDataAccess.loadSettings();
        if (!settings) {
            if (report) setCalendarFeedback("Connect Google Calendar in Integrations to include busy time.");
            return [];
        }
        if (settings.selectedCalendarIds.length === 0) {
            if (report) setCalendarFeedback("Select at least one busy-time calendar in Integrations.");
            return [];
        }
        const result = await googleCalendarDataAccess.fetchBusyIntervals({
            timeMin: now.toISOString(),
            timeMax: absoluteWorkUntil.toISOString(),
        });
        if (report) {
            const minutes = Math.round(result.intervals.reduce((sum, interval) =>
                sum + new Date(interval.end).getTime() - new Date(interval.start).getTime(), 0) / 60_000);
            setCalendarFeedback(`Calendar refreshed: ${minutes} busy minute${minutes === 1 ? "" : "s"}.`);
        }
        return result.intervals;
    };

    const handleCalendarRefresh = async () => {
        if (calendarRefreshing || !workUntil) return;
        setCalendarRefreshing(true);
        setCalendarFeedback(null);
        setGenerationError(null);
        try { await fetchCalendarBusy(new Date(), workUntil, true); }
        catch (error) { setGenerationError(error instanceof Error ? error.message : "Calendar refresh failed."); }
        finally { setCalendarRefreshing(false); }
    };

    const handleStartOfDay = async () => {
        if (generationInFlightRef.current) return;
        const projectId = pm.state.ui.selectedProjectIds[0];
        if (!projectId) {
            setGenerationError("Select a project before planning the day.");
            return;
        }
        if (!app.state) {
            setGenerationError("Timer data is still loading. Try again in a moment.");
            return;
        }
        generationInFlightRef.current = true;
        setGenerating(true);
        setGenerationError(null);
        setProgressEvents([]);
        setPlanPreview(null);
        const logs = app.state.logs;
        const settings = app.state.settings;
        try {
            const now = new Date();
            const busyIntervals = await fetchCalendarBusy(now, workUntil, false);
            const result = await runStartOfDay({
                projectId,
                pmState: pm.state,
                logs,
                settings,
                now,
                workUntil,
                busyIntervals,
                onProgress: appendProgress,
            });
            const previousWorkflow = latestWorkflow.current;
            latestWorkflow.current = result;
            setPlanPreview(result);
            const started = agent.startReview({
                projectId,
                mode: "start-of-day",
                changes: result.changes,
                summary: result.summary,
                replan: async ({ workingTasks, rejectedChange }) => {
                    const currentPmState = pmStateRef.current;
                    const currentAppState = appStateRef.current;
                    if (!currentAppState) throw new Error("Timer data is still loading. Try again in a moment.");
                    const replanNow = new Date();
                    const replanBusyIntervals = await fetchCalendarBusy(replanNow, workUntilRef.current, false);
                    const replanned = await runStartOfDay({
                        projectId,
                        pmState: {
                            tasks: Object.fromEntries([
                                ...Object.values(currentPmState.tasks).filter((task) => task.isArchived),
                                ...workingTasks,
                            ].map((task) => [task.id, task])),
                            ui: { ...currentPmState.ui, selectedProjectIds: [projectId] },
                        },
                        logs: currentAppState.logs,
                        settings: currentAppState.settings,
                        now: replanNow,
                        workUntil: workUntilRef.current,
                        busyIntervals: replanBusyIntervals,
                        rejectionFeedback: rejectionFeedback(rejectedChange),
                        onProgress: appendProgress,
                    });
                    latestWorkflow.current = replanned;
                    setPlanPreview(replanned);
                    return replanned.changes;
                },
                onComplete: ({ approvedChanges }) => {
                    const final = latestWorkflow.current;
                    if (!final) throw new Error("The completed plan is no longer available to save.");
                    saveAgentStartOfDayPlan({
                        projectId,
                        createdAt: final.createdAt,
                        completedAt: new Date().toISOString(),
                        workUntil: final.workUntil,
                        workBudgetPomos: final.workBudgetPomos,
                        summary: final.summary,
                        orderedTasks: final.orderedTasks,
                        approvedChanges: summarizeStartOfDayApprovedChanges(approvedChanges),
                    });
                },
            });
            if (!started) {
                latestWorkflow.current = previousWorkflow;
                setPlanPreview(previousWorkflow);
                setGenerationError("The review could not start. Select an existing project and finish any active review before trying again.");
            }
        } catch (error) {
            setGenerationError(error instanceof Error ? error.message : "The Start-of-Day plan could not be generated.");
        } finally {
            generationInFlightRef.current = false;
            setGenerating(false);
        }
    };

    const handleEndOfDay = async () => {
        if (generationInFlightRef.current) return;
        const projectId = pm.state.ui.selectedProjectIds[0];
        if (!projectId) {
            setGenerationError("Select a project before wrapping up the day.");
            return;
        }
        generationInFlightRef.current = true;
        setGenerating(true);
        setGenerationError(null);
        setProgressEvents([]);
        setEndOfDayPreview(null);
        try {
            const result = await runEndOfDay({ projectId, pmState: pm.state, now: new Date(), onProgress: appendProgress });
            const previousWorkflow = latestEndOfDayWorkflow.current;
            latestEndOfDayWorkflow.current = result;
            setEndOfDayPreview(result);
            const started = agent.startReview({
                projectId,
                mode: "end-of-day",
                changes: result.changes,
                summary: result.summary,
                replan: async ({ workingTasks, rejectedChange }) => {
                    const currentPmState = pmStateRef.current;
                    const replanned = await runEndOfDay({
                        projectId,
                        pmState: {
                            tasks: Object.fromEntries([
                                ...Object.values(currentPmState.tasks).filter((task) => task.isArchived),
                                ...workingTasks,
                            ].map((task) => [task.id, task])),
                            ui: { ...currentPmState.ui, selectedProjectIds: [projectId] },
                        },
                        now: new Date(),
                        rejectionFeedback: rejectionFeedback(rejectedChange),
                        onProgress: appendProgress,
                    });
                    latestEndOfDayWorkflow.current = replanned;
                    setEndOfDayPreview(replanned);
                    return replanned.changes;
                },
            });
            if (!started) {
                latestEndOfDayWorkflow.current = previousWorkflow;
                setEndOfDayPreview(previousWorkflow);
                setGenerationError("The review could not start. Select an existing project and finish any active review before trying again.");
            }
        } catch (error) {
            setGenerationError(error instanceof Error ? error.message : "The End-of-Day review could not be generated.");
        } finally {
            generationInFlightRef.current = false;
            setGenerating(false);
        }
    };

    const handleChat = async () => {
        if (generationInFlightRef.current) return;
        const message = chatDraft.trim();
        if (!message) return;
        const projectId = pm.state.ui.selectedProjectIds[0];
        if (!projectId) {
            setGenerationError("Select a project before chatting with the agent.");
            return;
        }
        const nextMessages: AgentChatMessage[] = [...chatMessagesRef.current, { role: "user", content: message }];
        setChatDraft("");
        setChatMessages(nextMessages);
        chatMessagesRef.current = nextMessages;
        generationInFlightRef.current = true;
        setGenerating(true);
        setGenerationError(null);
        try {
            const result = await runChat({
                projectId,
                pmState: pm.state,
                habits: Object.values(habits.state.habits),
                completions: Object.values(habits.state.completions),
                messages: nextMessages,
            });
            const withReply: AgentChatMessage[] = [...nextMessages, { role: "assistant", content: result.reply }];
            setChatMessages(withReply);
            chatMessagesRef.current = withReply;
            if (result.changes.length > 0) {
                const started = agent.startReview({
                    projectId,
                    mode: "chat",
                    changes: result.changes,
                    summary: result.reply,
                    replan: async ({ workingTasks, rejectedChange }) => {
                        const currentPmState = pmStateRef.current;
                        const replanned = await runChat({
                            projectId,
                            pmState: {
                                projects: currentPmState.projects,
                                tasks: Object.fromEntries([
                                    ...Object.values(currentPmState.tasks).filter((task) => task.projectId !== projectId || task.isArchived),
                                    ...workingTasks,
                                ].map((task) => [task.id, task])),
                            },
                            habits: Object.values(habitStateRef.current.habits),
                            completions: Object.values(habitStateRef.current.completions),
                            messages: chatMessagesRef.current,
                            rejectionFeedback: rejectionFeedback(rejectedChange),
                        });
                        const replannedMessages: AgentChatMessage[] = [...chatMessagesRef.current, { role: "assistant", content: replanned.reply }];
                        setChatMessages(replannedMessages);
                        chatMessagesRef.current = replannedMessages;
                        return replanned.changes;
                    },
                });
                if (!started) setGenerationError("The review could not start. Finish any active review before sending another proposal.");
            }
        } catch (error) {
            setGenerationError(error instanceof Error ? error.message : "The chat response could not be generated.");
        } finally {
            generationInFlightRef.current = false;
            setGenerating(false);
        }
    };

    const orderLabels = useMemo(() => agent.currentChange?.type === "reorder"
        ? {
            before: (agent.currentChange.beforeTaskIds ?? []).map((id) => pm.state.tasks[id]?.title ?? id),
            after: (agent.currentChange.afterTaskIds ?? []).map((id) => pm.state.tasks[id]?.title ?? id),
        }
        : undefined, [agent.currentChange, pm.state.tasks]);
    const approveCurrent = useCallback(() => { void approveCurrentRef.current(); }, []);
    const rejectCurrent = useCallback(() => { void rejectCurrentRef.current(); }, []);

    if (!open) {
        return <button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-600 px-4 py-3 font-medium text-white shadow-2xl hover:bg-violet-500" aria-label="Open planning agent"><Sparkles size={16} />Plan with agent</button>;
    }

    return (
        <section aria-label="Planning agent" className="fixed bottom-5 right-5 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950/95 shadow-2xl backdrop-blur">
            <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2.5">
                <span className="rounded-lg bg-violet-500/15 p-1.5 text-violet-300"><Bot size={16} /></span>
                <div><div className="font-semibold text-neutral-100">Planning agent</div><div className="text-[10px] text-neutral-500">Changes stay under your control</div></div>
                <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200" aria-label="Close planning agent"><ChevronDown size={16} /></button>
            </header>

            <div className="max-h-[70vh] overflow-y-auto p-3">
                {hasKey && agent.mode === "start-of-day" && planPreview && <StartOfDayPlanPreview plan={planPreview} />}
                {hasKey && agent.mode === "end-of-day" && endOfDayPreview && <EndOfDayPreview result={endOfDayPreview} />}
                {!hasKey ? (
                    <div className="rounded-xl border border-dashed border-neutral-700 p-4 text-center">
                        <Settings2 className="mx-auto text-violet-300" size={22} />
                        <h2 className="mt-2 font-semibold text-neutral-100">Set up your agent</h2>
                        <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">Add your own OpenAI or DeepSeek API key in Timer settings. It stays in this browser or desktop webview.</p>
                        <Link to="/" className="mt-3 inline-flex rounded-lg bg-neutral-800 px-3 py-2 text-neutral-100 hover:bg-neutral-700">Open settings</Link>
                    </div>
                ) : agent.currentChange && ["reviewing", "replanning", "error"].includes(agent.status) ? (
                    <>
                        <div className="mb-2 flex items-center justify-between text-[10px] text-neutral-400"><span>Change {agent.currentIndex + 1} of {agent.changes.length}</span><span>{agent.approvedChanges.length} approved</span></div>
                        <div className="mb-3 h-1 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-violet-500 transition-all" style={{ width: `${((agent.currentIndex + 1) / Math.max(agent.changes.length, 1)) * 100}%` }} /></div>
                        {agent.summary && <p className="mb-3 text-[11px] text-neutral-400">{agent.summary}</p>}
                        <AgentApprovalCard change={agent.currentChange} orderLabels={orderLabels} busy={agent.status === "replanning"} onApprove={approveCurrent} onReject={rejectCurrent} />
                        {agent.status === "replanning" && <div role="status" className="mt-2 text-center text-[11px] text-violet-300">Re-planning around approved changes…</div>}
                        {agent.error && <div role="alert" className="mt-2 rounded-lg bg-red-950/50 p-2 text-[11px] text-red-300">{agent.error} You can retry this decision.</div>}
                    </>
                ) : (
                    <>
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Choose a mode</div>
                        <div className="space-y-2">
                            {MODES.map((mode) => <button key={mode.id} type="button" onClick={() => agent.selectMode(mode.id)} className={`w-full rounded-xl border p-3 text-left transition-colors ${agent.mode === mode.id ? "border-violet-500 bg-violet-500/10" : "border-neutral-800 bg-neutral-900 hover:border-neutral-700"}`}><div className="font-medium text-neutral-100">{mode.label}</div><div className="mt-0.5 text-[10px] text-neutral-500">{mode.description}</div></button>)}
                        </div>
                        {agent.mode === "start-of-day" ? (
                            <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                                <label htmlFor="agent-work-until" className="block text-[11px] font-medium text-neutral-200">Work until</label>
                                <p className="mt-0.5 text-[10px] text-neutral-500">The plan will fit whole pomodoros into this window.</p>
                                <div className="mt-2 flex gap-2">
                                    <input id="agent-work-until" aria-label="Work until" type="time" value={workUntil} onChange={(event) => { setWorkUntil(event.target.value); setGenerationError(null); }} className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-neutral-100" />
                                    {googleCalendarDataAccess && <button type="button" disabled={generating || calendarRefreshing || !workUntil} onClick={() => void handleCalendarRefresh()} className="rounded-lg border border-neutral-700 px-2 py-1.5 text-[10px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50">{calendarRefreshing ? "Refreshing…" : "Refresh calendar"}</button>}
                                    <button type="button" disabled={generating || !workUntil} onClick={() => void handleStartOfDay()} className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white hover:bg-violet-500 disabled:opacity-50">{generating ? "Planning…" : "Generate plan"}</button>
                                </div>
                                {calendarFeedback && <p role="status" className="mt-2 text-[10px] text-sky-300">{calendarFeedback}</p>}
                                {generating && <p role="status" className="mt-2 text-[11px] text-violet-300">Building and validating your day plan…</p>}
                                {generationError && <p role="alert" className="mt-2 text-[11px] text-red-300">{generationError}</p>}
                            </div>
                        ) : agent.mode === "end-of-day" ? (
                            <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                                <p className="text-[11px] text-neutral-300">Compare today&apos;s saved plan with completed work and prepare the priority order for tomorrow.</p>
                                <button type="button" disabled={generating} onClick={() => void handleEndOfDay()} className="mt-2 w-full rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50">{generating ? "Wrapping up…" : "Wrap up day"}</button>
                                {generating && <p role="status" className="mt-2 text-[11px] text-emerald-300">Comparing progress and preparing tomorrow…</p>}
                                {generationError && <p role="alert" className="mt-2 text-[11px] text-red-300">{generationError}</p>}
                            </div>
                        ) : agent.mode === "chat" ? (
                            <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                                <div aria-label="Agent chat messages" className="max-h-52 space-y-2 overflow-y-auto">
                                    {chatMessages.length === 0 && <p className="text-[11px] leading-relaxed text-neutral-400">Ask about the selected project or your habits, or request task changes. Any changes will wait for your approval.</p>}
                                    {chatMessages.map((message, index) => (
                                        <div key={`${message.role}-${index}`} className={`rounded-lg px-2.5 py-2 text-[11px] leading-relaxed ${message.role === "user" ? "ml-6 bg-violet-600/20 text-violet-100" : "mr-6 bg-neutral-950 text-neutral-200"}`}>
                                            <span className="sr-only">{message.role === "user" ? "You" : "Agent"}: </span>{message.content}
                                        </div>
                                    ))}
                                </div>
                                <label htmlFor="agent-chat-message" className="sr-only">Message the planning agent</label>
                                <div className="mt-3 flex items-end gap-2">
                                    <textarea id="agent-chat-message" aria-label="Message the planning agent" rows={2} value={chatDraft} onChange={(event) => { setChatDraft(event.target.value); setGenerationError(null); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void handleChat(); } }} placeholder="Ask or propose a change…" className="min-w-0 flex-1 resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-[11px] text-neutral-100 placeholder:text-neutral-600" />
                                    <button type="button" aria-label="Send message" disabled={generating || !chatDraft.trim()} onClick={() => void handleChat()} className="rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-500 disabled:opacity-50"><Send size={15} /></button>
                                </div>
                                {generating && <p role="status" className="mt-2 text-[11px] text-violet-300">Thinking with your project and habit context…</p>}
                                {generationError && <p role="alert" className="mt-2 text-[11px] text-red-300">{generationError}</p>}
                            </div>
                        ) : null}
                    </>
                )}

                <AgentProgress events={progressEvents} onClear={clearProgress} />

                {agent.showRevert && (
                    <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                        <div className="flex items-start gap-2"><RotateCcw size={15} className="mt-0.5 text-amber-300" /><div className="flex-1"><div className="font-medium text-amber-100">Review complete</div><p className="mt-0.5 text-[10px] text-amber-200/70">Approved changes are saved. You can restore the pre-workflow snapshot.</p></div><button type="button" onClick={agent.dismissRevert} aria-label="Dismiss revert banner" className="text-amber-200/60 hover:text-amber-100"><X size={14} /></button></div>
                        {confirmationToken && <p role="alert" className="mt-2 text-[10px] text-amber-200">{conflictCount} task {conflictCount === 1 ? "has" : "have"} changed since the snapshot. Confirm to overwrite those edits.</p>}
                        <button type="button" onClick={handleRevert} className="mt-2 rounded-lg border border-amber-400/30 px-2.5 py-1.5 text-[11px] text-amber-100 hover:bg-amber-400/10">{confirmationToken ? "Confirm revert" : "Revert agent changes"}</button>
                    </div>
                )}
                {revertMessage && <div role="status" className="mt-2 text-[11px] text-neutral-300">{revertMessage}</div>}
                {agent.status === "error" && !agent.currentChange && agent.error && <div role="alert" className="mt-2 rounded-lg bg-red-950/50 p-2 text-[11px] text-red-300">{agent.error}</div>}
                {agent.status === "completed" && agent.error && <div role="alert" className="mt-2 rounded-lg bg-red-950/50 p-2 text-[11px] text-red-300">The review completed, but the final plan could not be saved: {agent.error}</div>}
            </div>
        </section>
    );
};

import type { PMTask, ProjectManagerState, ProposedTask } from "../../state/types";
import { compareEndOfDayPlan, validateTomorrowTaskOrder, type EndOfDayComparison } from "../engine/endOfDay";
import { diffPlannerTasks, type TaskChange } from "../engine/diffEngine";
import { requestValidatedJson } from "./agentClient";
import { getAgentProvider, type AgentProvider } from "./apiKey";
import { createStoredAgentClient, type ChatCompletionsClient } from "./llmTransport";
import { endOfDayOutputSchema, type EndOfDayOutput } from "./outputSchemas";
import { getAgentStartOfDayPlan, type AgentStartOfDayPlan } from "./startOfDayPlanStore";
import type { StartOfDayProgressEvent } from "./startOfDayWorkflow";

const LLM_MAX_ATTEMPTS = 2;

export interface EndOfDayWorkflowInput {
    projectId: string;
    pmState: Pick<ProjectManagerState, "tasks" | "ui">;
    now: Date;
    plan?: AgentStartOfDayPlan | null;
    client?: ChatCompletionsClient;
    provider?: AgentProvider;
    model?: string;
    rejectionFeedback?: string;
    onProgress?: (event: StartOfDayProgressEvent) => void;
}

export interface EndOfDayWorkflowResult {
    projectId: string;
    createdAt: string;
    summary: string;
    comparison: EndOfDayComparison;
    tomorrowTasks: { taskId: string; title: string; status: PMTask["status"]; priority: PMTask["priority"] }[];
    changes: TaskChange[];
}

function modelFor(provider: AgentProvider): string {
    return provider === "deepseek" ? "deepseek-v4-flash" : "gpt-5.6-luna";
}

function emit(listener: EndOfDayWorkflowInput["onProgress"], event: StartOfDayProgressEvent): void {
    try { listener?.(event); } catch { /* progress is observational */ }
}

function activeProjectTasks(input: EndOfDayWorkflowInput): PMTask[] {
    return Object.values(input.pmState.tasks)
        .filter((task) => task.projectId === input.projectId && !task.isArchived)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
}

function proposal(task: PMTask): ProposedTask {
    return {
        id: task.id,
        title: task.title,
        projectId: task.projectId,
        status: task.status,
        priority: task.priority,
        ...(task.dueDate ? { dueDate: task.dueDate } : {}),
        ...(task.estimatePomos !== undefined ? { estimatePomos: task.estimatePomos } : {}),
        ...(task.description !== undefined ? { description: task.description } : {}),
        checklist: task.checklist.map((item) => ({ ...item })),
        relatedTo: [...task.relatedTo],
    };
}

function systemPrompt(): string {
    return [
        "You are WorkTime's deterministic End-of-Day planner.",
        "Return only JSON matching {summary:string,orderedTaskIds:string[]}.",
        "Write a concise tomorrow overview that acknowledges today's actual progress.",
        "Order every remainingTask exactly once. Use only the supplied IDs; never include completed tasks.",
        "Prioritize blockers, due dates, priority, recent partial progress, and a realistic next sequence.",
        "You may only reprioritize. Never create, remove, edit, or mark a task Done; the timer owns completion.",
        "Example JSON: {\"summary\":\"Finish the release draft first, then unblock review.\",\"orderedTaskIds\":[\"task-2\",\"task-1\"]}",
    ].join("\n");
}

export async function runEndOfDayWorkflow(input: EndOfDayWorkflowInput): Promise<EndOfDayWorkflowResult> {
    const run = input.rejectionFeedback ? "replan" : "initial";
    const phase = (value: Extract<StartOfDayProgressEvent, { type: "phase" }>["phase"]) => emit(input.onProgress, { type: "phase", run, phase: value });
    phase("building-context");
    const plan = input.plan === undefined ? getAgentStartOfDayPlan() : input.plan;
    if (!plan) throw new Error("No valid Start-of-Day plan is available for this End-of-Day review.");
    if (plan.projectId !== input.projectId) throw new Error("The saved Start-of-Day plan belongs to a different project.");

    const tasks = activeProjectTasks(input);
    const comparison = compareEndOfDayPlan(plan, tasks);
    const remaining = tasks.filter((task) => task.status !== "Done");
    if (remaining.length === 0) {
        phase("completed");
        return {
            projectId: input.projectId,
            createdAt: input.now.toISOString(),
            summary: `Everything is complete: ${comparison.completedCount} of ${comparison.plannedCount} planned tasks finished. Tomorrow starts clear.`,
            comparison,
            tomorrowTasks: [],
            changes: [],
        };
    }

    const provider = input.provider ?? getAgentProvider();
    const client = input.client ?? createStoredAgentClient({ provider });
    phase("planning");
    const output = await requestValidatedJson<EndOfDayOutput>(client, {
        model: input.model ?? modelFor(provider),
        temperature: 0.2,
        ...(provider === "deepseek" ? { thinking: { type: "disabled" as const } } : {}),
        messages: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: `${input.rejectionFeedback ? `Replan feedback: ${input.rejectionFeedback}\n` : ""}End-of-Day context:\n${JSON.stringify({ startOfDay: { createdAt: plan.createdAt, completedAt: plan.completedAt, workBudgetPomos: plan.workBudgetPomos, summary: plan.summary }, comparison, remainingTasks: remaining.map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, dueDate: task.dueDate, estimatePomos: task.estimatePomos, workedPomos: task.workedPomos ?? 0, relatedTo: task.relatedTo })) })}` },
        ],
    }, endOfDayOutputSchema, { maxRetries: LLM_MAX_ATTEMPTS - 1 });

    phase("validating-plan");
    validateTomorrowTaskOrder(remaining.map((task) => task.id), output.orderedTaskIds);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const orderedRemaining = output.orderedTaskIds.map((id) => byId.get(id) as PMTask);
    const done = tasks.filter((task) => task.status === "Done");
    phase("diffing");
    const diff = diffPlannerTasks(tasks, [...orderedRemaining, ...done].map(proposal));
    if (diff.blocked || diff.changes.some((change) => change.type !== "reorder")) {
        throw new Error("The End-of-Day workflow attempted a change other than reprioritization.");
    }
    phase("completed");
    return {
        projectId: input.projectId,
        createdAt: input.now.toISOString(),
        summary: output.summary,
        comparison,
        tomorrowTasks: orderedRemaining.map((task) => ({ taskId: task.id, title: task.title, status: task.status, priority: task.priority })),
        changes: diff.changes,
    };
}

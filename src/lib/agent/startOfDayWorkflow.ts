import type { PMTask, PomodoroLogEntry, ProjectManagerState, ProposedTask, Settings } from "../../state/types";
import { buildPlannerContext, type PlannerBusyInterval } from "../engine/plannerContext";
import { diffPlannerTasks, type TaskChange } from "../engine/diffEngine";
import { selectStartOfDayPlanItems, validateStartOfDayPlan, type StartOfDayPlanItem } from "../engine/startOfDay";
import { requestPlannerOutput, requestWriterOutput } from "./agentClient";
import { getAgentProvider, type AgentProvider } from "./apiKey";
import { createStoredAgentClient, type ChatCompletionRequest, type ChatCompletionsClient } from "./llmTransport";
import {
    parseStrictJson,
    plannerOutputSchema,
    writerOutputSchema,
    type JsonSchema,
    type PlannerOutput,
    type WriterOutput,
} from "./outputSchemas";
import type { AgentStartOfDayApprovedChange } from "./startOfDayPlanStore";

const PLANNER_TEMPERATURE = 0.1;
const WRITER_TEMPERATURE = 0.75;
const LLM_MAX_ATTEMPTS = 2;
const TELEMETRY_TEXT_LIMIT = 500;

export type StartOfDayRunKind = "initial" | "replan";
export type StartOfDayLlmRole = "planner" | "writer";
export type StartOfDayLlmOutcome = "valid" | "invalid" | "transport-error";
export type StartOfDayResponseKind = "empty" | "markdown-fence" | "non-json" | "schema-mismatch";
export type StartOfDayPhase =
    | "building-context"
    | "planning"
    | "validating-plan"
    | "writing"
    | "validating-copy"
    | "diffing"
    | "completed";

export type StartOfDayProgressEvent =
    | { type: "phase"; run: StartOfDayRunKind; phase: StartOfDayPhase }
    | {
        type: "llm-attempt";
        run: StartOfDayRunKind;
        role: StartOfDayLlmRole;
        attempt: number;
        maxAttempts: number;
        model: string;
        durationMs: number;
        outcome: StartOfDayLlmOutcome;
        responseKind?: StartOfDayResponseKind;
        validationError?: string;
        retryFeedback?: string;
    };

export interface StartOfDayWorkflowInput {
    projectId: string;
    pmState: Pick<ProjectManagerState, "tasks" | "ui">;
    logs: readonly PomodoroLogEntry[];
    settings: Pick<Settings, "work_minutes">;
    now: Date;
    workUntil: string | Date;
    busyIntervals?: readonly PlannerBusyInterval[];
    client?: ChatCompletionsClient;
    provider?: AgentProvider;
    plannerModel?: string;
    writerModel?: string;
    rejectionFeedback?: string;
    onProgress?: (event: StartOfDayProgressEvent) => void;
    /** Injectable monotonic millisecond clock for deterministic duration tests. */
    monotonicNow?: () => number;
}

export interface StartOfDayWorkflowResult {
    projectId: string;
    createdAt: string;
    workUntil: string;
    workBudgetPomos: number;
    summary: string;
    proposedTasks: ProposedTask[];
    orderedTasks: StartOfDayPlanItem[];
    changes: TaskChange[];
}

function defaultModel(provider: AgentProvider): string {
    // Both defaults support Chat Completions, JSON output, and temperature.
    return provider === "deepseek" ? "deepseek-v4-flash" : "gpt-5.6-luna";
}

function defaultMonotonicNow(): number {
    return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}

function limited(value: string): string {
    return value.length <= TELEMETRY_TEXT_LIMIT ? value : `${value.slice(0, TELEMETRY_TEXT_LIMIT - 1)}…`;
}

function errorMessage(error: unknown): string {
    return limited(error instanceof Error && error.message ? error.message : "Unknown LLM error");
}

function emitProgress(
    listener: StartOfDayWorkflowInput["onProgress"],
    event: StartOfDayProgressEvent,
): void {
    try {
        listener?.(event);
    } catch {
        // Progress reporting is observational and must never fail the workflow.
    }
}

function retryFeedback(request: ChatCompletionRequest): string | undefined {
    for (let index = request.messages.length - 1; index >= 0; index -= 1) {
        const message = request.messages[index];
        const marker = "Validation errors:";
        const markerIndex = message.role === "user" ? message.content.indexOf(marker) : -1;
        if (markerIndex >= 0) {
            const feedback = message.content.slice(markerIndex + marker.length).trim();
            return feedback.includes("response is not valid JSON")
                ? "response is not valid JSON"
                : "response did not match the required JSON schema";
        }
    }
    return undefined;
}

function invalidResponseKind(content: string): StartOfDayResponseKind {
    const trimmed = content.trim();
    if (!trimmed) return "empty";
    if (trimmed.startsWith("```")) return "markdown-fence";
    try {
        JSON.parse(trimmed);
        return "schema-mismatch";
    } catch {
        return "non-json";
    }
}

function safeValidationError(kind: StartOfDayResponseKind, role: StartOfDayLlmRole): string {
    if (kind === "empty") return "response was empty";
    if (kind === "schema-mismatch") return `response did not match the required ${role} schema`;
    return "response is not valid JSON";
}

function measuringClient(input: {
    client: ChatCompletionsClient;
    role: StartOfDayLlmRole;
    run: StartOfDayRunKind;
    schema: JsonSchema;
    onProgress?: (event: StartOfDayProgressEvent) => void;
    monotonicNow: () => number;
}): ChatCompletionsClient {
    // This is intentionally a thin telemetry observer. requestValidatedJson
    // remains the validation source of truth and parses the raw response again
    // so it can produce detailed retry feedback and typed output.
    let attempt = 0;
    return {
        async complete(request) {
            attempt += 1;
            const startedAt = input.monotonicNow();
            const base = {
                type: "llm-attempt" as const,
                run: input.run,
                role: input.role,
                attempt,
                maxAttempts: LLM_MAX_ATTEMPTS,
                model: request.model,
                retryFeedback: retryFeedback(request),
            };
            let content: string;
            try {
                content = await input.client.complete(request);
            } catch (error) {
                emitProgress(input.onProgress, {
                    ...base,
                    durationMs: Math.round(Math.max(0, input.monotonicNow() - startedAt)),
                    outcome: "transport-error",
                    validationError: errorMessage(error),
                });
                throw error;
            }

            const durationMs = Math.round(Math.max(0, input.monotonicNow() - startedAt));
            try {
                parseStrictJson<unknown>(content, input.schema);
                emitProgress(input.onProgress, { ...base, durationMs, outcome: "valid" });
            } catch {
                const kind = invalidResponseKind(content);
                emitProgress(input.onProgress, {
                    ...base,
                    durationMs,
                    outcome: "invalid",
                    responseKind: kind,
                    validationError: safeValidationError(kind, input.role),
                });
            }
            return content;
        },
    };
}

function projectTasks(input: StartOfDayWorkflowInput) {
    return Object.values(input.pmState.tasks)
        .filter((task) => task.projectId === input.projectId && !task.isArchived)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
}

function plannerSystemPrompt(): string {
    return [
        "You are WorkTime's deterministic Start-of-Day planner.",
        "Return only a JSON object matching the supplied planner contract.",
        "Treat the proposedTasks array as the complete target snapshot for this project's non-archived tasks, ordered with today's work first and off-plan backlog preserved afterward. Archived tasks in the context are historical reference only and must never be copied into proposedTasks.",
        "Never omit an existing task unless it is an unstarted task above 4 pomodoros that is replaced by at least two splitsFrom pieces.",
        "Split every unstarted task estimated above 4 pomodoros. Give each piece its own evidence-based integer estimate from 1 to 4; do not divide evenly by arithmetic.",
        "When concrete steps are each 4 pomodoros or less, express them as checklist items on the containing task; checklist items never receive estimates.",
        "A task with workedPomos > 0 must never be split, and its estimate must be preserved unless you cite comparable completed tasks that took less time than estimated.",
        "Never reduce an uncompleted task's estimate merely because it has partial progress. To reduce one, include estimateEvidenceTaskIds with IDs of comparable Done tasks from the context, plus a concise rationale explaining the evidence; otherwise preserve the current estimate.",
        "Never transition a task to Done. Preserve existing Done tasks unchanged in the complete non-archived snapshot because the timer owns completion. Blocked tasks remain in the target and may appear in today's ordered work when relevant.",
        "Preserve ids, projectId, existing checklist item ids/done flags, and relationships unless the plan deliberately updates their content.",
        "Any estimate increase must include a non-empty rationale. New split tasks must include splitsFrom and a rationale.",
        "The prefix of the ordered target that fits workBudgetPomos is today's plan and must contain only non-archived, uncompleted tasks; Blocked tasks are allowed and should remain visible when relevant. Archived tasks are context-only and must never appear in the target or today's order. Prioritize due date, blockers, priority, and estimate accuracy.",
        "Planner contract: {summary:string, proposedTasks:Array<{id?:string,title:string,projectId?:string|null,status:'Backlog'|'Next'|'In Progress'|'Blocked'|'Done',priority:'Low'|'Medium'|'High',dueDate?:string,estimatePomos?:integer>=1,description?:string,checklist:Array<{id:string,title:string,done:boolean}>,relatedTo:string[],splitsFrom?:string,rationale?:string,estimateEvidenceTaskIds?:string[]}>}.",
        "Example JSON: {\"summary\":\"Focus on the release task first.\",\"proposedTasks\":[{\"id\":\"existing-task-id\",\"title\":\"Prepare the release\",\"projectId\":\"selected-project-id\",\"status\":\"Next\",\"priority\":\"High\",\"estimatePomos\":3,\"description\":\"Produce a reviewable release candidate.\",\"checklist\":[],\"relatedTo\":[]}]}.",
    ].join("\n");
}

function writerSystemPrompt(): string {
    return [
        "You are WorkTime's creative plan writer.",
        "Return only a JSON object matching the writer contract.",
        "Make titles, descriptions, checklist wording, and the summary concise, specific, and motivating.",
        "Structure is frozen: return exactly the same task count and order, preserve every task id, and preserve checklist count, ids, order, and done flags.",
        "You cannot add structural fields such as status, priority, estimate, project, relationships, rationale, or splitsFrom.",
        "Writer contract: {summary:string, proposedTasks:Array<{id?:string,title:string,description:string,checklist:Array<{id:string,title:string,done:boolean}>}>}.",
        "Example JSON: {\"summary\":\"Start with the release candidate.\",\"proposedTasks\":[{\"id\":\"existing-task-id\",\"title\":\"Prepare a reviewable release\",\"description\":\"Package and verify the candidate.\",\"checklist\":[]}]}",
    ].join("\n");
}

function writerInput(output: PlannerOutput): object {
    return {
        summary: output.summary,
        proposedTasks: output.proposedTasks.map((task) => ({
            ...(task.id ? { id: task.id } : {}),
            title: task.title,
            description: task.description ?? "",
            checklist: task.checklist.map((item) => ({ ...item })),
        })),
    };
}

function mergeWriterOutput(planner: PlannerOutput, writer: WriterOutput): ProposedTask[] {
    if (writer.proposedTasks.length !== planner.proposedTasks.length) {
        throw new Error("The creative writer changed the number of planned tasks.");
    }
    return planner.proposedTasks.map((task, index) => {
        const wording = writer.proposedTasks[index];
        if (wording.id !== task.id) throw new Error(`The creative writer changed task identity at position ${index + 1}.`);
        if (wording.checklist.length !== task.checklist.length) {
            throw new Error(`The creative writer changed checklist structure for ${task.title}.`);
        }
        const checklist = task.checklist.map((item, checklistIndex) => {
            const written = wording.checklist[checklistIndex];
            if (written.id !== item.id || written.done !== item.done) {
                throw new Error(`The creative writer changed checklist identity for ${task.title}.`);
            }
            return { ...item, title: written.title };
        });
        return { ...task, title: wording.title, description: wording.description, checklist };
    });
}

function assertValidPlan(currentTasks: ReturnType<typeof projectTasks>, proposedTasks: readonly ProposedTask[], workBudgetPomos: number, evidenceTasks: readonly PMTask[]): void {
    const validation = validateStartOfDayPlan({ currentTasks, proposedTasks, workBudgetPomos, evidenceTasks });
    if (!validation.valid) {
        throw new Error(`Start-of-Day plan violates required rules: ${validation.issues.map((issue) => issue.message).join(" ")}`);
    }
}

export async function runStartOfDayWorkflow(input: StartOfDayWorkflowInput): Promise<StartOfDayWorkflowResult> {
    const provider = input.provider ?? getAgentProvider();
    const client = input.client ?? createStoredAgentClient({ provider });
    const model = defaultModel(provider);
    const providerRequest = provider === "deepseek"
        ? { thinking: { type: "disabled" as const } }
        : {};
    const run = input.rejectionFeedback ? "replan" : "initial";
    const monotonicNow = input.monotonicNow ?? defaultMonotonicNow;
    const phase = (value: StartOfDayPhase) => emitProgress(input.onProgress, { type: "phase", run, phase: value });
    phase("building-context");
    const context = buildPlannerContext({
        pmState: { ...input.pmState, ui: { ...input.pmState.ui, selectedProjectIds: [input.projectId] } },
        logs: input.logs,
        settings: input.settings,
        now: input.now,
        workUntil: input.workUntil,
        busyIntervals: input.busyIntervals,
    });
    if (!context.workUntil || context.workBudgetPomos < 1) {
        throw new Error("Choose a work-until time that leaves room for at least one whole pomodoro after calendar busy time.");
    }

    phase("planning");
    const planner = await requestPlannerOutput(measuringClient({
        client, role: "planner", run, schema: plannerOutputSchema, onProgress: input.onProgress, monotonicNow,
    }), {
        model: input.plannerModel ?? model,
        temperature: PLANNER_TEMPERATURE,
        ...providerRequest,
        messages: [
            { role: "system", content: plannerSystemPrompt() },
            {
                role: "user",
                content: `${input.rejectionFeedback ? `Replan feedback: ${input.rejectionFeedback}\n` : ""}Planner context:\n${JSON.stringify(context)}`,
            },
        ],
    }, { maxRetries: LLM_MAX_ATTEMPTS - 1 });
    const currentTasks = projectTasks(input);
    phase("validating-plan");
    assertValidPlan(currentTasks, planner.proposedTasks, context.workBudgetPomos, Object.values(input.pmState.tasks));

    phase("writing");
    const writer = await requestWriterOutput(measuringClient({
        client, role: "writer", run, schema: writerOutputSchema, onProgress: input.onProgress, monotonicNow,
    }), {
        model: input.writerModel ?? model,
        temperature: WRITER_TEMPERATURE,
        ...providerRequest,
        messages: [
            { role: "system", content: writerSystemPrompt() },
            { role: "user", content: `Frozen plan:\n${JSON.stringify(writerInput(planner))}` },
        ],
    }, { maxRetries: LLM_MAX_ATTEMPTS - 1 });
    phase("validating-copy");
    const proposedTasks = mergeWriterOutput(planner, writer);
    assertValidPlan(currentTasks, proposedTasks, context.workBudgetPomos, Object.values(input.pmState.tasks));
    phase("diffing");
    const diff = diffPlannerTasks(currentTasks, proposedTasks);
    if (diff.blocked) {
        throw new Error(`Start-of-Day plan contains blocked changes: ${diff.blockedChanges.flatMap((change) => change.blockReasons).join(", ")}`);
    }
    const orderedTasks = selectStartOfDayPlanItems(proposedTasks, context.workBudgetPomos);
    if (orderedTasks.length === 0) {
        throw new Error("The planner did not produce an actionable task inside the selected work window.");
    }
    phase("completed");

    return {
        projectId: input.projectId,
        createdAt: context.now,
        workUntil: context.workUntil,
        workBudgetPomos: context.workBudgetPomos,
        summary: writer.summary,
        proposedTasks: proposedTasks.map((task) => ({ ...task, checklist: task.checklist.map((item) => ({ ...item })), relatedTo: [...task.relatedTo] })),
        orderedTasks,
        changes: diff.changes,
    };
}

export function summarizeStartOfDayApprovedChanges(changes: readonly TaskChange[]): AgentStartOfDayApprovedChange[] {
    return changes.map((change) => ({
        type: change.type,
        ...(change.taskId ? { taskId: change.taskId } : {}),
        ...(change.splitsFrom ? { splitsFrom: change.splitsFrom } : {}),
        ...(change.after?.title ? { title: change.after.title } : change.before?.title ? { title: change.before.title } : {}),
        ...(change.after?.estimatePomos !== undefined ? { estimatePomos: change.after.estimatePomos } : {}),
    }));
}

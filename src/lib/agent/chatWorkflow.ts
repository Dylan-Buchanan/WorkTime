import type { Habit, HabitCompletion, PMTask, ProjectManagerState, ProposedTask } from "../../state/types";
import { quickAddParse } from "../../state/ProjectManagerContext";
import { diffPlannerTasks, type TaskChange } from "../engine/diffEngine";
import { requestValidatedJson } from "./agentClient";
import { getAgentProvider, type AgentProvider } from "./apiKey";
import { createStoredAgentClient, type ChatCompletionsClient } from "./llmTransport";
import { chatOutputSchema, type ChatCreateOutput, type ChatOutput } from "./outputSchemas";

const LLM_MAX_ATTEMPTS = 2;

export interface AgentChatMessage {
    role: "user" | "assistant";
    content: string;
}

export interface ChatWorkflowInput {
    projectId: string;
    pmState: Pick<ProjectManagerState, "projects" | "tasks">;
    habits: readonly Habit[];
    completions: readonly HabitCompletion[];
    messages: readonly AgentChatMessage[];
    client?: ChatCompletionsClient;
    provider?: AgentProvider;
    model?: string;
    rejectionFeedback?: string;
}

export interface ChatWorkflowResult {
    projectId: string;
    reply: string;
    changes: TaskChange[];
}

function modelFor(provider: AgentProvider): string {
    return provider === "deepseek" ? "deepseek-v4-flash" : "gpt-5.6-luna";
}

function proposedTask(task: PMTask): ProposedTask {
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

function createProposal(create: ChatCreateOutput, selectedProjectId: string, selectedProjectName: string): ProposedTask {
    const parsed = quickAddParse(create.quickAdd);
    const title = parsed.task.title?.trim();
    if (!title) throw new Error("A chat task proposal has an empty quick-add title.");
    if (parsed.projectName) {
        const expected = create.scope === "general" ? "general" : selectedProjectName.toLocaleLowerCase();
        if (parsed.projectName.toLocaleLowerCase() !== expected) {
            throw new Error(`Chat can create tasks only in ${selectedProjectName} or General.`);
        }
    }
    return {
        title,
        projectId: create.scope === "general" ? null : selectedProjectId,
        status: parsed.task.status ?? "Backlog",
        priority: parsed.task.priority ?? "Medium",
        ...(parsed.task.dueDate ? { dueDate: parsed.task.dueDate } : {}),
        ...(parsed.task.estimatePomos !== undefined ? { estimatePomos: parsed.task.estimatePomos } : {}),
        description: create.description ?? "",
        tags: [...(parsed.task.tags ?? [])],
        checklist: (create.checklist ?? []).map((item) => ({ ...item })),
        relatedTo: [...(create.relatedTo ?? [])],
        ...(create.rationale ? { rationale: create.rationale } : {}),
    };
}

function habitContext(habits: readonly Habit[], completions: readonly HabitCompletion[]) {
    return habits
        .filter((habit) => !habit.isArchived)
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
        .map((habit) => {
            const buckets = completions
                .filter((completion) => completion.habitId === habit.id)
                .map((completion) => completion.bucket)
                .sort()
                .slice(-20);
            return {
                id: habit.id,
                name: habit.name,
                description: habit.description,
                frequency: habit.frequency,
                completionCount: completions.filter((completion) => completion.habitId === habit.id).length,
                recentCompletionBuckets: buckets,
            };
        });
}

function systemPrompt(selectedProjectName: string): string {
    return [
        "You are WorkTime's conversational planning assistant.",
        "Answer the user's question using the supplied selected-project tasks and habits.",
        "Return only JSON matching {reply:string,creates:ChatCreate[],updates:ProposedTask[],removeTaskIds:string[]}.",
        "Task proposals are incremental: include only requested creates, changed existing tasks, and removals. An empty set means conversational advice only.",
        "For creates, only quickAdd and scope are required. quickAdd uses: title ^YYYY-MM-DD #tag !low|!medium|!high 3p. Set scope to selected-project or general; @General is optional for general tasks. Description, checklist, relatedTo, and rationale are optional.",
        `The selected project is ${JSON.stringify(selectedProjectName)}. Never target another project.`,
        "Every update must include an existing task id and the complete proposed task fields. Never invent an id. Tags are optional.",
        "Do not mark tasks Done; timer completion owns that transition. Include a rationale for estimate increases.",
        "Keep reply concise and explain any proposed changes before the user reviews them.",
    ].join("\n");
}

export async function runChatWorkflow(input: ChatWorkflowInput): Promise<ChatWorkflowResult> {
    const selectedProject = input.pmState.projects[input.projectId];
    if (!selectedProject || selectedProject.isArchived) throw new Error("Select an existing project before chatting with the agent.");
    if (!input.rejectionFeedback && (input.messages.length === 0 || input.messages[input.messages.length - 1]?.role !== "user")) {
        throw new Error("Chat requires a user message.");
    }

    const currentTasks = Object.values(input.pmState.tasks)
        .filter((task) => task.projectId === input.projectId && !task.isArchived)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
    const provider = input.provider ?? getAgentProvider();
    const client = input.client ?? createStoredAgentClient({ provider });
    const output = await requestValidatedJson<ChatOutput>(client, {
        model: input.model ?? modelFor(provider),
        temperature: 0.35,
        ...(provider === "deepseek" ? { thinking: { type: "disabled" as const } } : {}),
        messages: [
            { role: "system", content: systemPrompt(selectedProject.name) },
            {
                role: "user",
                content: `Current context:\n${JSON.stringify({
                    selectedProject: { id: selectedProject.id, name: selectedProject.name, description: selectedProject.description ?? "" },
                    tasks: currentTasks.map(proposedTask),
                    habits: habitContext(input.habits, input.completions),
                })}`,
            },
            ...input.messages.map((message) => ({ role: message.role, content: message.content })),
            ...(input.rejectionFeedback ? [{ role: "user" as const, content: `Approval feedback: ${input.rejectionFeedback}` }] : []),
        ],
    }, chatOutputSchema, { maxRetries: LLM_MAX_ATTEMPTS - 1 });

    const currentById = new Map(currentTasks.map((task) => [task.id, task]));
    const updateIds = new Set<string>();
    for (const update of output.updates) {
        if (!update.id || !currentById.has(update.id)) throw new Error(`Chat proposed an update for an unknown task: ${update.id ?? "missing id"}.`);
        if (update.projectId !== undefined && update.projectId !== input.projectId) {
            throw new Error(`Chat cannot move an existing task outside ${selectedProject.name}.`);
        }
        if (updateIds.has(update.id)) throw new Error(`Chat proposed duplicate updates for task: ${update.id}.`);
        updateIds.add(update.id);
    }
    const removeIds = new Set(output.removeTaskIds);
    if (removeIds.size !== output.removeTaskIds.length) throw new Error("Chat proposed the same task removal more than once.");
    for (const taskId of removeIds) {
        if (!currentById.has(taskId)) throw new Error(`Chat proposed removing an unknown task: ${taskId}.`);
        if (updateIds.has(taskId)) throw new Error(`Chat cannot update and remove the same task: ${taskId}.`);
    }

    const updates = new Map(output.updates.map((task) => [task.id as string, task]));
    const targetTasks: ProposedTask[] = currentTasks
        .filter((task) => !removeIds.has(task.id))
        .map((task) => updates.get(task.id) ?? proposedTask(task));
    targetTasks.push(...output.creates.map((create) => createProposal(create, input.projectId, selectedProject.name)));
    const diff = diffPlannerTasks(currentTasks, targetTasks);
    return { projectId: input.projectId, reply: output.reply, changes: diff.changes };
}

export {
    AGENT_API_KEY_STORAGE_KEY,
    AGENT_PROVIDER_OPTIONS,
    AGENT_PROVIDER_STORAGE_KEY,
    DEFAULT_AGENT_PROVIDER,
    clearAgentApiKey,
    createAgentApiKeyStore,
    getAgentApiKey,
    getAgentProvider,
    getAgentProviderConfig,
    setAgentApiKey,
    setAgentProvider,
    subscribeToAgentApiKey,
    subscribeToAgentProvider,
} from "./apiKey";
export type { AgentApiKeyStore, AgentProvider } from "./apiKey";

export {
    AGENT_PROJECT_SNAPSHOT_STORAGE_KEY,
    clearAgentProjectSnapshot,
    getAgentProjectSnapshot,
    planAgentSnapshotRevert,
    saveAgentProjectSnapshot,
} from "./snapshotStore";
export type {
    AgentProjectSnapshot,
    AgentSnapshotConflict,
    AgentSnapshotConflictKind,
    AgentSnapshotRevertPlan,
} from "./snapshotStore";

export {
    createChatCompletionsClient,
    createLLMTransport,
    createStoredAgentClient,
    DEFAULT_AGENT_BASE_URL,
    LLMTransportError,
} from "./llmTransport";
export type {
    ChatCompletionsClient,
    ChatCompletionsClientOptions,
    ChatCompletionRequest,
    ChatMessage,
    ChatRole,
    StoredAgentClientOptions,
} from "./llmTransport";

export {
    parseStrictJson,
    plannerOutputSchema,
    validateJsonAgainstSchema,
    writerOutputSchema,
} from "./outputSchemas";
export type {
    JsonSchema,
    PlannerOutput,
    PlannerTaskOutput,
    SchemaValidationIssue,
    WriterOutput,
    WriterTaskOutput,
} from "./outputSchemas";

export {
    AgentOutputValidationError,
    requestPlannerOutput,
    requestValidatedJson,
    requestWriterOutput,
} from "./agentClient";
export type { ValidatedJsonOptions } from "./agentClient";

export { buildPlannerContext, calculatePomodoroBudget } from "../engine/plannerContext";
export type {
    AccuracyAggregate,
    PlannerAccuracyAggregates,
    PlannerContext,
    PlannerContextInput,
    PlannerTaskContext,
} from "../engine/plannerContext";

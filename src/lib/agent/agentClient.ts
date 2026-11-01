import type { ChatCompletionsClient, ChatCompletionRequest, ChatMessage } from "./llmTransport";
import type { JsonSchema } from "./outputSchemas";
import { parseStrictJson, plannerOutputSchema, writerOutputSchema } from "./outputSchemas";
import type { PlannerOutput, WriterOutput } from "./outputSchemas";

export class AgentOutputValidationError extends Error {
    readonly attempts: number;
    readonly validationFeedback: string;

    constructor(message: string, attempts: number, validationFeedback: string) {
        super(message);
        this.name = "AgentOutputValidationError";
        this.attempts = attempts;
        this.validationFeedback = validationFeedback;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export interface ValidatedJsonOptions<T = unknown> {
    maxRetries?: number;
    /** Workflow invariants are checked inside the same bounded feedback retry. */
    validateOutput?: (output: T) => void;
}

function validationMessage(error: unknown): string {
    return error instanceof Error ? error.message : "response did not match the required JSON schema";
}

function feedbackMessage(error: string): ChatMessage {
    return {
        role: "user",
        content: [
            "The previous response was invalid.",
            "Return only JSON matching the required schema.",
            `Validation errors: ${error}`,
        ].join("\n"),
    };
}

/** Calls a chat client, parses strict JSON, and retries malformed output with feedback. */
export async function requestValidatedJson<T>(
    client: ChatCompletionsClient,
    request: ChatCompletionRequest,
    schema: JsonSchema,
    options: ValidatedJsonOptions<T> = {},
): Promise<T> {
    const maxRetries = Math.max(0, Math.trunc(options.maxRetries ?? 1));
    let currentRequest = {
        ...request,
        responseFormat: request.responseFormat ?? { type: "json_object" as const },
        messages: [...request.messages],
    };
    let lastError = "";

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const content = await client.complete(currentRequest);
        try {
            const output = parseStrictJson<T>(content, schema);
            options.validateOutput?.(output);
            return output;
        } catch (error) {
            lastError = validationMessage(error);
            if (attempt === maxRetries) break;
            currentRequest = {
                ...currentRequest,
                messages: [...currentRequest.messages, feedbackMessage(lastError)],
            };
        }
    }

    throw new AgentOutputValidationError(
        `LLM output failed schema validation after ${maxRetries + 1} attempt(s): ${lastError}`,
        maxRetries + 1,
        lastError,
    );
}

export function requestPlannerOutput(
    client: ChatCompletionsClient,
    request: ChatCompletionRequest,
    options?: ValidatedJsonOptions,
): Promise<PlannerOutput> {
    return requestValidatedJson<PlannerOutput>(client, request, plannerOutputSchema, options);
}

export function requestWriterOutput(
    client: ChatCompletionsClient,
    request: ChatCompletionRequest,
    options?: ValidatedJsonOptions,
): Promise<WriterOutput> {
    return requestValidatedJson<WriterOutput>(client, request, writerOutputSchema, options);
}

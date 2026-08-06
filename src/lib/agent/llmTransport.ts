import {
    getAgentApiKey,
    getAgentProvider,
    getAgentProviderConfig,
} from "./apiKey";
import type { AgentProvider } from "./apiKey";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
    role: ChatRole;
    content: string;
}

export interface ChatCompletionRequest {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: "text" | "json_object" };
}

export interface ChatCompletionsClient {
    complete(request: ChatCompletionRequest): Promise<string>;
}

export interface ChatCompletionsClientOptions {
    apiKey: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
}

export class LLMTransportError extends Error {
    readonly status?: number;
    readonly responseBody?: string;

    constructor(message: string, status?: number, responseBody?: string) {
        super(message);
        this.name = "LLMTransportError";
        this.status = status;
        this.responseBody = responseBody;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export const DEFAULT_AGENT_BASE_URL = "https://api.openai.com/v1";

export interface StoredAgentClientOptions {
    provider?: AgentProvider;
    fetchImpl?: typeof fetch;
}

function chatCompletionsUrl(baseUrl: string): string {
    const value = baseUrl.trim();
    if (!value) throw new LLMTransportError("An LLM base URL is required");

    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new LLMTransportError("LLM base URL must be a valid HTTP or HTTPS URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new LLMTransportError("LLM base URL must use HTTP or HTTPS");
    }
    if (parsed.search || parsed.hash) {
        throw new LLMTransportError("LLM base URL must not contain a query or hash");
    }

    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    if (normalizedPath.endsWith("/chat/completions")) return parsed.toString().replace(/\/+$/, "");
    parsed.pathname = `${normalizedPath}/chat/completions`;
    return parsed.toString().replace(/\/+$/, "");
}

function requestBody(request: ChatCompletionRequest): Record<string, unknown> {
    return {
        model: request.model,
        messages: request.messages,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        ...(request.responseFormat === undefined ? {} : { response_format: request.responseFormat }),
    };
}

function responseContent(payload: unknown): string {
    if (!payload || typeof payload !== "object") {
        throw new LLMTransportError("LLM response was not a JSON object");
    }
    const choices = (payload as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
        throw new LLMTransportError("LLM response did not contain a completion choice");
    }
    const message = choices[0] && typeof choices[0] === "object"
        ? (choices[0] as { message?: unknown }).message
        : undefined;
    const content = message && typeof message === "object"
        ? (message as { content?: unknown }).content
        : undefined;
    if (typeof content !== "string") {
        throw new LLMTransportError("LLM completion did not contain text content");
    }
    return content;
}

/** Creates a small browser-native client for OpenAI-compatible chat endpoints. */
export function createChatCompletionsClient(options: ChatCompletionsClientOptions): ChatCompletionsClient {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new LLMTransportError("An LLM API key is required");
    const url = chatCompletionsUrl(options.baseUrl ?? DEFAULT_AGENT_BASE_URL);
    const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl) throw new LLMTransportError("Fetch is not available in this environment");

    return {
        async complete(request) {
            let response: Response;
            try {
                response = await fetchImpl(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify(requestBody(request)),
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : "Network request failed";
                throw new LLMTransportError(`LLM network request failed: ${message}`);
            }

            let payload: unknown;
            try {
                payload = await response.json();
            } catch {
                throw new LLMTransportError("LLM response was not valid JSON", response.status);
            }
            if (!response.ok) {
                const detail = payload && typeof payload === "object" && "error" in payload
                    ? JSON.stringify((payload as { error: unknown }).error)
                    : JSON.stringify(payload);
                throw new LLMTransportError(`LLM request failed with HTTP ${response.status}`, response.status, detail);
            }
            return responseContent(payload);
        },
    };
}

/** Creates a client from the saved BYOK key and provider selection. */
export function createStoredAgentClient(options: StoredAgentClientOptions = {}): ChatCompletionsClient {
    const provider = options.provider ?? getAgentProvider();
    const apiKey = getAgentApiKey();
    return createChatCompletionsClient({
        apiKey: apiKey ?? "",
        baseUrl: getAgentProviderConfig(provider).baseUrl,
        fetchImpl: options.fetchImpl,
    });
}

export const createLLMTransport = createChatCompletionsClient;

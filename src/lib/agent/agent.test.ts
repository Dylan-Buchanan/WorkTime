import { describe, expect, it, vi } from "vitest";
import {
    AGENT_API_KEY_STORAGE_KEY,
    AGENT_PROVIDER_STORAGE_KEY,
    createAgentApiKeyStore,
    createChatCompletionsClient,
    createStoredAgentClient,
    getAgentProvider,
    getAgentProviderConfig,
    requestPlannerOutput,
    requestWriterOutput,
    setAgentProvider,
    validateJsonAgainstSchema,
    writerOutputSchema,
} from ".";

function response(payload: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
    } as Response;
}

describe("agent API key storage", () => {
    it("trims, persists, exposes, and clears the surface-local key", () => {
        const storage = new Map<string, string>();
        const fakeStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        };
        const store = createAgentApiKeyStore(fakeStorage);

        expect(store.set("  secret-key  ")).toBe("secret-key");
        expect(store.get()).toBe("secret-key");
        expect(storage.get(AGENT_API_KEY_STORAGE_KEY)).toBe("secret-key");
        store.clear();
        expect(store.get()).toBeNull();
        expect(storage.has(AGENT_API_KEY_STORAGE_KEY)).toBe(false);
    });

    it("stores the selected OpenAI-compatible provider and its base URL", () => {
        const storage = new Map<string, string>();
        const fakeStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        };

        setAgentProvider("deepseek", fakeStorage);
        expect(storage.get(AGENT_PROVIDER_STORAGE_KEY)).toBe("deepseek");
        expect(getAgentProvider(fakeStorage)).toBe("deepseek");
        expect(getAgentProviderConfig("deepseek").baseUrl).toBe("https://api.deepseek.com");

        setAgentProvider("openai", fakeStorage);
    });
});

describe("OpenAI-compatible LLM transport", () => {
    it("posts the chat-completions request to the configured base URL", async () => {
        let calledUrl = "";
        let calledInit: RequestInit | undefined;
        const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            calledUrl = String(input);
            calledInit = init;
            return response({ choices: [{ message: { content: "hello" } }] });
        });
        const client = createChatCompletionsClient({
            apiKey: "secret-key",
            baseUrl: "https://provider.example/v1/",
            fetchImpl,
        });

        await expect(client.complete({
            model: "provider-model",
            messages: [{ role: "user", content: "Say hello" }],
            temperature: 0.2,
            maxTokens: 100,
            responseFormat: { type: "json_object" },
            thinking: { type: "disabled" },
        })).resolves.toBe("hello");

        expect(calledUrl).toBe("https://provider.example/v1/chat/completions");
        expect(calledInit?.method).toBe("POST");
        expect((calledInit?.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
        expect(JSON.parse(String(calledInit?.body))).toEqual({
            model: "provider-model",
            messages: [{ role: "user", content: "Say hello" }],
            temperature: 0.2,
            max_tokens: 100,
            response_format: { type: "json_object" },
            thinking: { type: "disabled" },
        });
    });

    it("uses the saved provider when creating a stored client", async () => {
        setAgentProvider("deepseek");
        const storageKey = "worktime:agent:apiKey";
        localStorage.setItem(storageKey, "deepseek-key");
        const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
            expect(String(input)).toBe("https://api.deepseek.com/chat/completions");
            return response({ choices: [{ message: { content: "ok" } }] });
        });

        const client = createStoredAgentClient({ fetchImpl });
        await expect(client.complete({
            model: "deepseek-chat",
            messages: [{ role: "user", content: "Hello" }],
        })).resolves.toBe("ok");
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        localStorage.removeItem(storageKey);
        setAgentProvider("openai");
    });
});

describe("strict planner and writer output validation", () => {
    const plannerRequest = {
        model: "planner",
        messages: [{ role: "user" as const, content: "Plan the day" }],
    };
    const validPlanner = JSON.stringify({
        summary: "Focus on the highest priority item.",
        proposedTasks: [{
            id: "task-1",
            title: "Ship the feature",
            status: "Next",
            priority: "High",
            checklist: [],
            relatedTo: [],
        }],
    });

    it("rejects unknown writer properties", () => {
        const issues = validateJsonAgainstSchema({
            summary: "Summary",
            proposedTasks: [{ title: "Task", description: "Details", checklist: [], unexpected: true }],
        }, writerOutputSchema);
        expect(issues.some((issue) => issue.message === "is not allowed")).toBe(true);
    });

    it("retries malformed planner JSON with validation feedback", async () => {
        const complete = vi.fn()
            .mockResolvedValueOnce("{not-json")
            .mockResolvedValueOnce(validPlanner);

        const result = await requestPlannerOutput({ complete }, plannerRequest);

        expect(result.proposedTasks[0].id).toBe("task-1");
        expect(complete).toHaveBeenCalledTimes(2);
        const retryMessages = complete.mock.calls[1][0].messages;
        expect(retryMessages[retryMessages.length - 1]?.content).toContain("not valid JSON");
    });

    it("fails after the configured retry budget when schema violations persist", async () => {
        const complete = vi.fn().mockResolvedValue('{"summary":"ok","proposedTasks":[],"extra":true}');

        await expect(requestWriterOutput({ complete }, {
            model: "writer",
            messages: [{ role: "user", content: "Rewrite" }],
        }, { maxRetries: 1 })).rejects.toMatchObject({
            name: "AgentOutputValidationError",
            attempts: 2,
        });
        expect(complete).toHaveBeenCalledTimes(2);
        const retryMessages = complete.mock.calls[1][0].messages;
        expect(retryMessages[retryMessages.length - 1]?.content).toContain("not allowed");
    });
});

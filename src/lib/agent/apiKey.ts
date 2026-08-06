export const AGENT_API_KEY_STORAGE_KEY = "worktime:agent:apiKey";
export const AGENT_PROVIDER_STORAGE_KEY = "worktime:agent:provider";

export type AgentProvider = "openai" | "deepseek";

export const AGENT_PROVIDER_OPTIONS = [
    { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
    { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com" },
] as const satisfies readonly { id: AgentProvider; label: string; baseUrl: string }[];

export const DEFAULT_AGENT_PROVIDER: AgentProvider = "openai";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ApiKeyListener = (apiKey: string | null) => void;
type ProviderListener = (provider: AgentProvider) => void;

function defaultStorage(): StorageLike | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

function readStorage(storage: StorageLike | undefined): string | null {
    if (!storage) return null;
    try {
        const value = storage.getItem(AGENT_API_KEY_STORAGE_KEY)?.trim() ?? "";
        return value || null;
    } catch {
        return null;
    }
}

function isAgentProvider(value: string | null): value is AgentProvider {
    return value === "openai" || value === "deepseek";
}

function readProvider(storage: StorageLike | undefined): AgentProvider {
    if (!storage) return DEFAULT_AGENT_PROVIDER;
    try {
        const value = storage.getItem(AGENT_PROVIDER_STORAGE_KEY);
        return isAgentProvider(value) ? value : DEFAULT_AGENT_PROVIDER;
    } catch {
        return DEFAULT_AGENT_PROVIDER;
    }
}

export function getAgentProviderConfig(provider: AgentProvider): (typeof AGENT_PROVIDER_OPTIONS)[number] {
    return AGENT_PROVIDER_OPTIONS.find((option) => option.id === provider) ?? AGENT_PROVIDER_OPTIONS[0];
}

let inMemoryApiKey = readStorage(defaultStorage());
let inMemoryProvider = readProvider(defaultStorage());
const listeners = new Set<ApiKeyListener>();
const providerListeners = new Set<ProviderListener>();

function publish(apiKey: string | null): void {
    inMemoryApiKey = apiKey;
    listeners.forEach((listener) => listener(apiKey));
}

/** Returns the startup-loaded key and reconciles changes made outside this module. */
export function getAgentApiKey(storage: StorageLike | undefined = defaultStorage()): string | null {
    const stored = readStorage(storage);
    if (stored !== inMemoryApiKey) inMemoryApiKey = stored;
    return inMemoryApiKey;
}

/** Stores a trimmed key in the surface-local browser storage and memory. */
export function setAgentApiKey(apiKey: string, storage: StorageLike | undefined = defaultStorage()): string | null {
    const normalized = apiKey.trim();
    if (!normalized) {
        clearAgentApiKey(storage);
        return null;
    }
    storage?.setItem(AGENT_API_KEY_STORAGE_KEY, normalized);
    publish(normalized);
    return normalized;
}

/** Removes the key from both browser storage and the in-memory client state. */
export function clearAgentApiKey(storage: StorageLike | undefined = defaultStorage()): void {
    storage?.removeItem(AGENT_API_KEY_STORAGE_KEY);
    publish(null);
}

export function subscribeToAgentApiKey(listener: ApiKeyListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Returns the selected provider loaded at startup, defaulting safely to OpenAI. */
export function getAgentProvider(storage: StorageLike | undefined = defaultStorage()): AgentProvider {
    const stored = readProvider(storage);
    if (stored !== inMemoryProvider) inMemoryProvider = stored;
    return inMemoryProvider;
}

/** Persists the selected provider for this browser or Tauri webview. */
export function setAgentProvider(provider: AgentProvider, storage: StorageLike | undefined = defaultStorage()): AgentProvider {
    if (!isAgentProvider(provider)) throw new Error(`Unsupported agent provider: ${String(provider)}`);
    storage?.setItem(AGENT_PROVIDER_STORAGE_KEY, provider);
    inMemoryProvider = provider;
    providerListeners.forEach((listener) => listener(provider));
    return provider;
}

export function subscribeToAgentProvider(listener: ProviderListener): () => void {
    providerListeners.add(listener);
    return () => providerListeners.delete(listener);
}

export interface AgentApiKeyStore {
    get(): string | null;
    set(apiKey: string): string | null;
    clear(): void;
    subscribe(listener: ApiKeyListener): () => void;
}

/** Creates an isolated store for tests or a future alternate frontend surface. */
export function createAgentApiKeyStore(storage: StorageLike): AgentApiKeyStore {
    let value = readStorage(storage);
    const storeListeners = new Set<ApiKeyListener>();
    const notify = (next: string | null) => {
        value = next;
        storeListeners.forEach((listener) => listener(next));
    };
    return {
        get: () => value,
        set: (apiKey) => {
            const normalized = apiKey.trim();
            if (!normalized) {
                storage.removeItem(AGENT_API_KEY_STORAGE_KEY);
                notify(null);
                return null;
            }
            storage.setItem(AGENT_API_KEY_STORAGE_KEY, normalized);
            notify(normalized);
            return normalized;
        },
        clear: () => {
            storage.removeItem(AGENT_API_KEY_STORAGE_KEY);
            notify(null);
        },
        subscribe: (listener) => {
            storeListeners.add(listener);
            return () => storeListeners.delete(listener);
        },
    };
}

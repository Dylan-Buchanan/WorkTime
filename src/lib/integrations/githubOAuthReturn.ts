export const GITHUB_OAUTH_CALLBACK_PATH = "/auth/github/callback";
export const GITHUB_OAUTH_STATE_STORAGE_KEY = "worktime:githubOAuthState:v1";
export const TAURI_WINDOWS_PRODUCTION_ORIGIN = "http://tauri.localhost";
export const TAURI_WINDOWS_ENTRY_PATH = "/index.html";

const WEB_STATE_PREFIX = "web.";
const TAURI_STATE_PREFIX = "tauri.";
const OAUTH_STATE_PATTERN = /^(?:web|tauri)\.[0-9a-f]{32}$/;
const TAURI_STATE_PATTERN = /^tauri\.[0-9a-f]{32}$/;
const BRIDGE_PARAMETERS = ["code", "state", "error", "error_description", "error_uri"] as const;

export interface GitHubOAuthReturn {
    code: string | null;
    state: string | null;
    error: string | null;
    errorDescription: string | null;
}

export type GitHubOAuthStateResult =
    | { status: "valid" }
    | { status: "invalid"; reason: "missing-returned" | "missing-expected" | "mismatch" };

function sessionStorageOrThrow(storage?: Storage): Storage {
    if (storage) return storage;
    if (typeof window === "undefined" || !window.sessionStorage) {
        throw new Error("OAuth session storage is unavailable.");
    }
    return window.sessionStorage;
}

function randomStateSuffix(): string {
    if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
        throw new Error("Secure randomness is unavailable.");
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function prepareGitHubOAuthState(isTauri: boolean, storage?: Storage): string {
    const state = `${isTauri ? TAURI_STATE_PREFIX : WEB_STATE_PREFIX}${randomStateSuffix()}`;
    sessionStorageOrThrow(storage).setItem(GITHUB_OAUTH_STATE_STORAGE_KEY, state);
    return state;
}

export function clearGitHubOAuthState(storage?: Storage): void {
    sessionStorageOrThrow(storage).removeItem(GITHUB_OAUTH_STATE_STORAGE_KEY);
}

export function parseGitHubOAuthReturn(url: URL): GitHubOAuthReturn {
    return {
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
        error: url.searchParams.get("error"),
        errorDescription: url.searchParams.get("error_description"),
    };
}

export function consumeGitHubOAuthState(returnedState: string | null, storage?: Storage): GitHubOAuthStateResult {
    const target = sessionStorageOrThrow(storage);
    const expectedState = target.getItem(GITHUB_OAUTH_STATE_STORAGE_KEY);
    target.removeItem(GITHUB_OAUTH_STATE_STORAGE_KEY);

    if (!returnedState?.trim()) return { status: "invalid", reason: "missing-returned" };
    if (!expectedState || !OAUTH_STATE_PATTERN.test(expectedState)) {
        return { status: "invalid", reason: "missing-expected" };
    }
    if (returnedState !== expectedState) return { status: "invalid", reason: "mismatch" };
    return { status: "valid" };
}

export function buildTauriGitHubOAuthBridge(url: URL, storage?: Storage): string | null {
    const state = url.searchParams.get("state") ?? "";
    if (!TAURI_STATE_PATTERN.test(state) || url.origin === TAURI_WINDOWS_PRODUCTION_ORIGIN) return null;

    // In `tauri dev`, the initiating webview and the configured local callback
    // both use Vite's origin. A matching surface-local state means the callback
    // is already able to reuse the initiating session, so the production asset
    // bridge would be both unnecessary and unavailable.
    try {
        if (sessionStorageOrThrow(storage).getItem(GITHUB_OAUTH_STATE_STORAGE_KEY) === state) return null;
    } catch {
        // A hosted callback cannot rely on storage access. Continue to the
        // fixed bridge, where the initiating Tauri origin owns the state.
    }

    // Tauri resolves a top-level navigation before React Router can handle it.
    // Load the packaged entry asset explicitly, then let App route that entry
    // path to the callback page after the SPA has started.
    const bridge = new URL(TAURI_WINDOWS_ENTRY_PATH, TAURI_WINDOWS_PRODUCTION_ORIGIN);
    for (const parameter of BRIDGE_PARAMETERS) {
        const value = url.searchParams.get(parameter);
        if (value !== null) bridge.searchParams.set(parameter, value);
    }
    return bridge.toString();
}

import { beforeEach, describe, expect, it } from "vitest";
import {
    GITHUB_OAUTH_CALLBACK_PATH,
    GITHUB_OAUTH_STATE_STORAGE_KEY,
    TAURI_WINDOWS_ENTRY_PATH,
    TAURI_WINDOWS_PRODUCTION_ORIGIN,
    buildTauriGitHubOAuthBridge,
    consumeGitHubOAuthState,
    parseGitHubOAuthReturn,
    prepareGitHubOAuthState,
} from "./githubOAuthReturn";

describe("GitHub OAuth return", () => {
    beforeEach(() => sessionStorage.clear());

    it("prepares and consumes one-time web and Tauri states", () => {
        const webState = prepareGitHubOAuthState(false);
        expect(webState).toMatch(/^web\.[0-9a-f]{32}$/);
        expect(sessionStorage.getItem(GITHUB_OAUTH_STATE_STORAGE_KEY)).toBe(webState);
        expect(consumeGitHubOAuthState(webState)).toEqual({ status: "valid" });
        expect(sessionStorage.getItem(GITHUB_OAUTH_STATE_STORAGE_KEY)).toBeNull();
        expect(consumeGitHubOAuthState(webState)).toEqual({ status: "invalid", reason: "missing-expected" });

        const tauriState = prepareGitHubOAuthState(true);
        expect(tauriState).toMatch(/^tauri\.[0-9a-f]{32}$/);
        expect(consumeGitHubOAuthState(tauriState)).toEqual({ status: "valid" });
    });

    it("fails closed for missing and mismatched states and consumes the pending value", () => {
        const state = prepareGitHubOAuthState(false);
        expect(consumeGitHubOAuthState(null)).toEqual({ status: "invalid", reason: "missing-returned" });
        expect(sessionStorage.getItem(GITHUB_OAUTH_STATE_STORAGE_KEY)).toBeNull();

        sessionStorage.setItem(GITHUB_OAUTH_STATE_STORAGE_KEY, state);
        expect(consumeGitHubOAuthState("web.00000000000000000000000000000000"))
            .toEqual({ status: "invalid", reason: "mismatch" });
        expect(sessionStorage.getItem(GITHUB_OAUTH_STATE_STORAGE_KEY)).toBeNull();
    });

    it("parses successful and denied provider responses", () => {
        expect(parseGitHubOAuthReturn(new URL("https://worktime.test/auth/github/callback?code=code-123&state=web.123"))).toEqual({
            code: "code-123",
            state: "web.123",
            error: null,
            errorDescription: null,
        });
        expect(parseGitHubOAuthReturn(new URL("https://worktime.test/auth/github/callback?error=access_denied&error_description=No&state=web.123"))).toMatchObject({
            code: null,
            error: "access_denied",
            errorDescription: "No",
        });
    });

    it("builds only a fixed, allow-listed Tauri bridge and avoids bridge loops", () => {
        const state = "tauri.0123456789abcdef0123456789abcdef";
        const source = new URL(`https://worktime.test${GITHUB_OAUTH_CALLBACK_PATH}?code=code-123&state=${state}&error_uri=https%3A%2F%2Fgithub.com%2Fhelp&return_to=https%3A%2F%2Fevil.test`);
        const bridgeValue = buildTauriGitHubOAuthBridge(source);
        expect(bridgeValue).not.toBeNull();
        const bridge = new URL(bridgeValue!);
        expect(bridge.origin).toBe(TAURI_WINDOWS_PRODUCTION_ORIGIN);
        expect(bridge.pathname).toBe(TAURI_WINDOWS_ENTRY_PATH);
        expect(bridge.searchParams.get("code")).toBe("code-123");
        expect(bridge.searchParams.get("state")).toBe(state);
        expect(bridge.searchParams.get("error_uri")).toBe("https://github.com/help");
        expect(bridge.searchParams.has("return_to")).toBe(false);

        expect(buildTauriGitHubOAuthBridge(new URL(`https://worktime.test${GITHUB_OAUTH_CALLBACK_PATH}?state=web.0123456789abcdef0123456789abcdef`))).toBeNull();
        expect(buildTauriGitHubOAuthBridge(new URL(`${TAURI_WINDOWS_PRODUCTION_ORIGIN}${GITHUB_OAUTH_CALLBACK_PATH}?state=${state}`))).toBeNull();
    });

    it("stays on the current origin when a Tauri dev callback owns the pending state", () => {
        const state = "tauri.0123456789abcdef0123456789abcdef";
        sessionStorage.setItem(GITHUB_OAUTH_STATE_STORAGE_KEY, state);

        expect(buildTauriGitHubOAuthBridge(new URL(`http://localhost:3000${GITHUB_OAUTH_CALLBACK_PATH}?code=code-123&state=${state}`)))
            .toBeNull();
    });
});

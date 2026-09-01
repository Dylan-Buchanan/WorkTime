import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { GitHubIntegrationError, type GitHubDataAccess } from "../../lib/data/GitHubDataAccess";
import { GITHUB_OAUTH_STATE_STORAGE_KEY } from "../../lib/integrations/githubOAuthReturn";
import { GithubOAuthCallbackPage } from "./GithubOAuthCallbackPage";

const auth = vi.hoisted(() => ({
    value: { loading: false, session: null as Session | null },
}));

vi.mock("../../auth/AuthContext", () => ({
    useAuth: () => auth.value,
}));

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

const ownerSession = {
    user: { id: "owner-1" },
} as unknown as Session;

type CompleteAuthorization = GitHubDataAccess["completeAuthorization"];
type CompleteAuthorizationMock = Mock<CompleteAuthorization>;
type ReplaceLocationMock = Mock<(url: string) => void>;

function renderPage(options: {
    url: string;
    completeAuthorization?: CompleteAuthorizationMock;
    replaceLocation?: ReplaceLocationMock;
    strict?: boolean;
}) {
    const completeAuthorization = options.completeAuthorization
        ?? vi.fn<CompleteAuthorization>().mockResolvedValue({ githubUsername: "octocat" });
    const replaceLocation = options.replaceLocation ?? vi.fn<(url: string) => void>();
    const page = (
        <MemoryRouter initialEntries={["/auth/github/callback"]}>
            <Routes>
                <Route path="/auth/github/callback" element={(
                    <GithubOAuthCallbackPage
                        currentUrl={() => new URL(options.url)}
                        replaceLocation={replaceLocation}
                        createDataAccess={() => ({ completeAuthorization })}
                    />
                )} />
                <Route path="/integrations" element={<div>Integrations destination</div>} />
            </Routes>
        </MemoryRouter>
    );
    return {
        ...render(options.strict ? <StrictMode>{page}</StrictMode> : page),
        completeAuthorization,
        replaceLocation,
    };
}

describe("GithubOAuthCallbackPage", () => {
    beforeEach(() => {
        sessionStorage.clear();
        auth.value = { loading: false, session: ownerSession };
    });

    it("exchanges a valid PWA callback once and returns to Integrations", async () => {
        const state = "web.0123456789abcdef0123456789abcdef";
        sessionStorage.setItem(GITHUB_OAUTH_STATE_STORAGE_KEY, state);
        const { completeAuthorization } = renderPage({
            url: `https://worktime.test/auth/github/callback?code=code-123&state=${state}`,
            strict: true,
        });

        expect(await screen.findByText("Integrations destination")).toBeInTheDocument();
        expect(completeAuthorization).toHaveBeenCalledTimes(1);
        expect(completeAuthorization).toHaveBeenCalledWith("code-123");
        expect(sessionStorage.getItem(GITHUB_OAUTH_STATE_STORAGE_KEY)).toBeNull();
    });

    it("bridges a marked Tauri callback before reading hosted auth or exchanging", () => {
        auth.value = { loading: true, session: null };
        const state = "tauri.0123456789abcdef0123456789abcdef";
        const { replaceLocation, completeAuthorization } = renderPage({
            url: `https://worktime.test/auth/github/callback?code=code-123&state=${state}&return_to=https%3A%2F%2Fevil.test`,
        });

        expect(replaceLocation).toHaveBeenCalledOnce();
        expect(replaceLocation.mock.calls[0][0]).toMatch(/^http:\/\/tauri\.localhost\/index\.html\?/);
        expect(replaceLocation.mock.calls[0][0]).not.toContain("return_to");
        expect(completeAuthorization).not.toHaveBeenCalled();
    });

    it("completes a Tauri dev callback on the initiating Vite origin", async () => {
        const state = "tauri.0123456789abcdef0123456789abcdef";
        sessionStorage.setItem(GITHUB_OAUTH_STATE_STORAGE_KEY, state);
        const { replaceLocation, completeAuthorization } = renderPage({
            url: `http://localhost:3000/auth/github/callback?code=code-123&state=${state}`,
        });

        expect(await screen.findByText("Integrations destination")).toBeInTheDocument();
        expect(replaceLocation).not.toHaveBeenCalled();
        expect(completeAuthorization).toHaveBeenCalledOnce();
        expect(completeAuthorization).toHaveBeenCalledWith("code-123");
    });

    it("does not consume state while authentication is still loading", async () => {
        const state = "web.0123456789abcdef0123456789abcdef";
        sessionStorage.setItem(GITHUB_OAUTH_STATE_STORAGE_KEY, state);
        auth.value = { loading: true, session: null };
        const view = renderPage({ url: `https://worktime.test/auth/github/callback?code=code-123&state=${state}` });

        expect(sessionStorage.getItem(GITHUB_OAUTH_STATE_STORAGE_KEY)).toBe(state);
        auth.value = { loading: false, session: ownerSession };
        view.rerender(
            <MemoryRouter initialEntries={["/auth/github/callback"]}>
                <Routes>
                    <Route path="/auth/github/callback" element={(
                        <GithubOAuthCallbackPage
                            currentUrl={() => new URL(`https://worktime.test/auth/github/callback?code=code-123&state=${state}`)}
                            replaceLocation={view.replaceLocation}
                            createDataAccess={() => ({ completeAuthorization: view.completeAuthorization })}
                        />
                    )} />
                    <Route path="/integrations" element={<div>Integrations destination</div>} />
                </Routes>
            </MemoryRouter>,
        );
        expect(await screen.findByText("Integrations destination")).toBeInTheDocument();
        expect(view.completeAuthorization).toHaveBeenCalledOnce();
    });

    it.each([
        ["wrong state", "https://worktime.test/auth/github/callback?code=code-123&state=web.ffffffffffffffffffffffffffffffff", "could not be verified"],
        ["missing code", "https://worktime.test/auth/github/callback?state=web.0123456789abcdef0123456789abcdef", "did not return an authorization code"],
        ["provider denial", "https://worktime.test/auth/github/callback?error=access_denied&state=web.0123456789abcdef0123456789abcdef", "connection was cancelled"],
    ])("shows a recovery route for %s", async (_name, url, message) => {
        sessionStorage.setItem(GITHUB_OAUTH_STATE_STORAGE_KEY, "web.0123456789abcdef0123456789abcdef");
        const { completeAuthorization } = renderPage({ url });

        expect(await screen.findByRole("alert")).toHaveTextContent(message);
        expect(screen.getByRole("link", { name: "Back to Integrations" })).toHaveAttribute("href", "/integrations");
        expect(completeAuthorization).not.toHaveBeenCalled();
    });

    it("maps an expired code to actionable copy", async () => {
        const state = "web.0123456789abcdef0123456789abcdef";
        sessionStorage.setItem(GITHUB_OAUTH_STATE_STORAGE_KEY, state);
        renderPage({
            url: `https://worktime.test/auth/github/callback?code=expired&state=${state}`,
            completeAuthorization: vi.fn<CompleteAuthorization>().mockRejectedValue(new GitHubIntegrationError("GITHUB_CODE_INVALID", "unsafe provider detail")),
        });

        expect(await screen.findByRole("alert")).toHaveTextContent("invalid or has expired");
        expect(screen.getByRole("alert")).not.toHaveTextContent("unsafe provider detail");
    });
});

import { describe, expect, it, vi } from "vitest";
import {
    fetchGitHubIssues,
    fetchGitHubLabels,
    fetchGitHubRepositories,
    GITHUB_MAX_PAGES,
    GitHubApiError,
} from "./githubApi.ts";

function jsonResponse(value: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json" },
        ...init,
    });
}

function githubIssue(number: number, overrides: Record<string, unknown> = {}) {
    return {
        number,
        title: `Issue ${number}`,
        html_url: `https://github.com/octocat/hello-world/issues/${number}`,
        state: "open",
        labels: [{ name: "bug", color: "d73a4a" }],
        created_at: "2026-08-01T10:00:00Z",
        updated_at: "2026-08-02T11:00:00Z",
        closed_at: null,
        ...overrides,
    };
}

describe("GitHub enumeration API mapping", () => {
    it("maps repositories and builds the documented listing request", async () => {
        const fetcher = vi.fn().mockResolvedValue(jsonResponse([
            { id: 1, full_name: "octocat/hello-world", private: false },
        ]));

        await expect(fetchGitHubRepositories("token", fetcher)).resolves.toEqual([
            { fullName: "octocat/hello-world" },
        ]);
        const url = new URL(String(fetcher.mock.calls[0][0]));
        expect(url.origin + url.pathname).toBe("https://api.github.com/user/repos");
        expect(Object.fromEntries(url.searchParams)).toEqual({
            per_page: "100",
            page: "1",
            affiliation: "owner,collaborator,organization_member",
            sort: "full_name",
            direction: "asc",
        });
        expect(fetcher.mock.calls[0][1]).toMatchObject({
            method: "GET",
            headers: { Authorization: "Bearer token", "X-GitHub-Api-Version": "2022-11-28" },
        });
    });

    it("maps labels and safely encodes the repository path", async () => {
        const fetcher = vi.fn().mockResolvedValue(jsonResponse([
            { name: "Needs triage", color: "AABBCC", description: null },
        ]));

        await expect(fetchGitHubLabels("token", "owner/repo.name", fetcher)).resolves.toEqual([
            { name: "Needs triage", color: "aabbcc", description: null },
        ]);
        expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe("/repos/owner/repo.name/labels");
    });

    it.each([
        [401, {}, "GITHUB_TOKEN_INVALID", 401],
        [403, {}, "GITHUB_TOKEN_INVALID", 401],
        [404, {}, "GITHUB_REPO_NOT_FOUND", 404],
        [500, {}, "GITHUB_UPSTREAM_ERROR", 502],
        [429, { "Retry-After": "12" }, "GITHUB_RATE_LIMITED", 429],
        [403, { "X-RateLimit-Remaining": "0", "Retry-After": "7" }, "GITHUB_RATE_LIMITED", 429],
    ])("maps upstream status %s to %s", async (status, headers, code, mappedStatus) => {
        const fetcher = vi.fn().mockResolvedValue(jsonResponse({}, { status, headers }));
        const error = await fetchGitHubRepositories("token", fetcher).catch((caught) => caught);
        expect(error).toBeInstanceOf(GitHubApiError);
        expect(error).toMatchObject({ code, status: mappedStatus });
        if (code === "GITHUB_RATE_LIMITED") expect(error.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("rejects malformed successful responses", async () => {
        const fetcher = vi.fn().mockResolvedValue(jsonResponse([{ full_name: "not-a-full-name" }]));
        await expect(fetchGitHubRepositories("token", fetcher)).rejects.toMatchObject({
            code: "GITHUB_INVALID_RESPONSE",
        });
    });

    it("stops repository pagination at the shared page cap", async () => {
        const page = Array.from({ length: 100 }, (_, index) => ({ full_name: `owner/repo-${index}` }));
        const fetcher = vi.fn().mockImplementation(async () => jsonResponse(page));
        await expect(fetchGitHubRepositories("token", fetcher)).resolves.toHaveLength(100 * GITHUB_MAX_PAGES);
        expect(fetcher).toHaveBeenCalledTimes(GITHUB_MAX_PAGES);
        expect(new URL(String(fetcher.mock.calls.at(-1)?.[0])).searchParams.get("page"))
            .toBe(String(GITHUB_MAX_PAGES));
    });
});

describe("GitHub repository issue API mapping", () => {
    it("maps issues, filters pull requests, and builds an open-state request", async () => {
        const fetcher = vi.fn().mockResolvedValue(jsonResponse([
            githubIssue(7),
            githubIssue(8, { pull_request: { url: "https://api.github.com/repos/octocat/hello-world/pulls/8" } }),
        ]));

        await expect(fetchGitHubIssues("token", "octocat/hello-world", {
            includeClosed: false,
            labelFilter: null,
        }, fetcher)).resolves.toEqual([{
            number: 7,
            title: "Issue 7",
            html_url: "https://github.com/octocat/hello-world/issues/7",
            state: "open",
            labels: ["bug"],
            closed: false,
            created_at: "2026-08-01T10:00:00Z",
            updated_at: "2026-08-02T11:00:00Z",
            closed_at: null,
        }]);

        const url = new URL(String(fetcher.mock.calls[0][0]));
        expect(url.origin + url.pathname).toBe("https://api.github.com/repos/octocat/hello-world/issues");
        expect(Object.fromEntries(url.searchParams)).toEqual({ per_page: "100", page: "1", state: "open" });
    });

    it("requests open and closed issues with one trimmed label", async () => {
        const fetcher = vi.fn().mockResolvedValue(jsonResponse([
            githubIssue(9, { state: "closed", closed_at: "2026-08-03T12:00:00Z" }),
        ]));

        await expect(fetchGitHubIssues("token", "octocat/hello-world", {
            includeClosed: true,
            labelFilter: " needs triage ",
        }, fetcher)).resolves.toMatchObject([{ number: 9, state: "closed", closed: true }]);
        const url = new URL(String(fetcher.mock.calls[0][0]));
        expect(url.searchParams.get("state")).toBe("all");
        expect(url.searchParams.get("labels")).toBe("needs triage");
    });

    it.each([
        githubIssue(1, { number: 1.5 }),
        githubIssue(1, { state: "merged" }),
        githubIssue(1, { labels: ["bug"] }),
        githubIssue(1, { updated_at: "not-a-date" }),
        githubIssue(1, { state: "open", closed_at: "2026-08-03T12:00:00Z" }),
    ])("rejects a malformed successful issue response %#", async (value) => {
        const fetcher = vi.fn().mockResolvedValue(jsonResponse([value]));
        await expect(fetchGitHubIssues("token", "octocat/hello-world", {
            includeClosed: true,
            labelFilter: null,
        }, fetcher)).rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
    });

    it("stops issue pagination at the shared page cap after filtering pull requests", async () => {
        const page = Array.from({ length: 100 }, (_, index) => githubIssue(index + 1, index === 0
            ? { pull_request: { url: "https://api.github.com/pull" } }
            : {}));
        const fetcher = vi.fn().mockImplementation(async () => jsonResponse(page));

        await expect(fetchGitHubIssues("token", "octocat/hello-world", {
            includeClosed: false,
            labelFilter: null,
        }, fetcher)).resolves.toHaveLength(99 * GITHUB_MAX_PAGES);
        expect(fetcher).toHaveBeenCalledTimes(GITHUB_MAX_PAGES);
        expect(new URL(String(fetcher.mock.calls.at(-1)?.[0])).searchParams.get("page"))
            .toBe(String(GITHUB_MAX_PAGES));
    });

    it.each([
        [404, {}, "GITHUB_REPO_NOT_FOUND", 404, undefined],
        [401, {}, "GITHUB_TOKEN_INVALID", 401, undefined],
        [403, {}, "GITHUB_TOKEN_INVALID", 401, undefined],
        [429, { "Retry-After": "12" }, "GITHUB_RATE_LIMITED", 429, 12],
        [403, { "X-RateLimit-Remaining": "0", "Retry-After": "7" }, "GITHUB_RATE_LIMITED", 429, 7],
    ])("maps issue response %s to %s", async (status, headers, code, mappedStatus, retryAfterSeconds) => {
        const fetcher = vi.fn().mockResolvedValue(jsonResponse({}, { status, headers }));
        const error = await fetchGitHubIssues("token", "octocat/hello-world", {
            includeClosed: false,
            labelFilter: null,
        }, fetcher).catch((caught) => caught);
        expect(error).toBeInstanceOf(GitHubApiError);
        expect(error).toMatchObject({ code, status: mappedStatus });
        expect(error.retryAfterSeconds).toBe(retryAfterSeconds);
    });
});

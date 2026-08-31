import { describe, expect, it, vi } from "vitest";
import {
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLinearIssues, LINEAR_MAX_PAGES, LINEAR_PAGE_SIZE, LINEAR_SYNC_QUERY } from "../supabase/functions/linear-sync/linearApi";

afterEach(() => vi.useRealTimers());

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function issue(overrides: Record<string, unknown> = {}) {
    return {
        id: "issue-1", identifier: "ENG-1", title: "Sync issues", description: "Details",
        url: "https://linear.app/example/issue/ENG-1/sync-issues", dueDate: "2026-10-30", priority: 2,
        state: { name: "In Progress" }, ...overrides,
    };
}

function connection(nodes: unknown[] = [], next: string | null = null) {
    return { nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } };
}

function data(overrides: Record<string, unknown> = {}) {
    return {
        issues: connection([issue()]), states: connection([{ name: "Todo" }, { name: "In Progress" }]),
        matchingTeams: { nodes: [{ id: "team-1" }] }, ...overrides,
    };
}

const settings = { token: "fake-personal-key", teamKey: null };

describe("Linear API client", () => {
    it("posts a bounded assigned-to-me query, a raw key, and case-insensitive team filters", async () => {
        const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            expect(input).toBe("https://api.linear.app/graphql");
            expect(init).toMatchObject({ method: "POST", redirect: "error" });
            expect(new Headers(init?.headers).get("Authorization")).toBe("fake-personal-key");
            expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
            const body = JSON.parse(String(init?.body));
            expect(body.query).toBe(LINEAR_SYNC_QUERY);
            expect(body.query).not.toMatch(/\bestimate\b/);
            expect(body.query).toContain("states: workflowStates");
            expect(body.query).toContain("includeArchived: false");
            expect(body.variables).toEqual({
                first: LINEAR_PAGE_SIZE, issuesAfter: null, statesAfter: null,
                issueFilter: { assignee: { isMe: { eq: true } }, team: { key: { eqIgnoreCase: "eNg" } } },
                stateFilter: { team: { key: { eqIgnoreCase: "eNg" } } }, teamFilter: { key: { eqIgnoreCase: "eNg" } },
                fetchIssues: true, fetchStates: true, checkTeam: true,
            });
            return json({ data: data() });
        });
        expect(await fetchLinearIssues({ token: " fake-personal-key ", teamKey: " eNg " }, fetcher)).toEqual({
            issues: [issue()], states: ["In Progress", "Todo"], truncated: false,
        });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("paginates issues and workflow states independently and deduplicates both", async () => {
        const requests: Record<string, unknown>[] = [];
        const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
            const variables = JSON.parse(String(init?.body)).variables;
            requests.push(variables);
            if (requests.length === 1) return json({ data: data({
                issues: connection([issue()], "issues-2"), states: connection([{ name: "Todo" }], "states-2"),
            }) });
            if (requests.length === 2) return json({ data: data({
                issues: connection([issue(), issue({ id: "issue-2", identifier: "ENG-2", description: null, dueDate: null, priority: 0 })]),
                states: connection([{ name: "Todo" }], "states-3"),
            }) });
            return json({ data: { states: connection([{ name: "Review" }]) } });
        });
        const result = await fetchLinearIssues(settings, fetcher);
        expect(result.issues).toHaveLength(2);
        expect(result.issues[1]).toMatchObject({ id: "issue-2", description: "", dueDate: null, priority: 0 });
        expect(result.states).toEqual(["In Progress", "Review", "Todo"]);
        expect(result.truncated).toBe(false);
        expect(requests[1]).toMatchObject({ issuesAfter: "issues-2", statesAfter: "states-2", checkTeam: false });
        expect(requests[2]).toMatchObject({ fetchIssues: false, fetchStates: true, statesAfter: "states-3" });
    });

    it.each([null, "   "])("treats a null/blank team as all teams (%s)", async (teamKey) => {
        const fetcher = async (_input: unknown, init?: RequestInit) => {
            expect(JSON.parse(String(init?.body)).variables).toMatchObject({
                issueFilter: { assignee: { isMe: { eq: true } } }, stateFilter: {}, teamFilter: {}, checkTeam: false,
            });
            return json({ data: data({ issues: connection([]) }) });
        };
        expect(await fetchLinearIssues({ ...settings, teamKey }, fetcher)).toEqual({
            issues: [], states: ["In Progress", "Todo"], truncated: false,
        });
    });

    it("distinguishes an unknown team from a known team with no assigned issues", async () => {
        await expect(fetchLinearIssues({ ...settings, teamKey: "missing" }, async () => json({
            data: data({ matchingTeams: { nodes: [] }, issues: connection([]) }),
        }))).rejects.toMatchObject({ status: 404, code: "LINEAR_TEAM_NOT_FOUND" });
        expect(await fetchLinearIssues({ ...settings, teamKey: "ENG" }, async () => json({
            data: data({ issues: connection([]) }),
        }))).toMatchObject({ issues: [], truncated: false });
    });

    it.each(["issues", "states"])("marks truncation when the %s connection exceeds the page cap", async (kind) => {
        const fetcher = vi.fn(async () => json({ data: data({
            [kind]: connection([], `cursor-${fetcher.mock.calls.length}`),
        }) }));
        expect(await fetchLinearIssues(settings, fetcher)).toMatchObject({ truncated: true });
        expect(fetcher).toHaveBeenCalledTimes(LINEAR_MAX_PAGES);
    });

    it("does not mark truncation when the final allowed page completes", async () => {
        const fetcher = vi.fn(async () => json({ data: data({
            issues: connection([], fetcher.mock.calls.length === LINEAR_MAX_PAGES ? null : `page-${fetcher.mock.calls.length}`),
        }) }));
        expect(await fetchLinearIssues(settings, fetcher)).toMatchObject({ truncated: false });
        expect(fetcher).toHaveBeenCalledTimes(LINEAR_MAX_PAGES);
    });

    it.each(["issues", "states"])("rejects repeated %s cursors", async (kind) => {
        const fetcher = vi.fn(async () => json({ data: data({ [kind]: connection([], "repeated") }) }));
        await expect(fetchLinearIssues(settings, fetcher)).rejects.toMatchObject({ code: "LINEAR_INVALID_RESPONSE" });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it.each([null, "", "   ", 42, "https://example.test/steal", "//example.test/steal"])("rejects invalid continuing cursor %s", async (endCursor) => {
        await expect(fetchLinearIssues(settings, async () => json({ data: data({
            issues: { nodes: [], pageInfo: { hasNextPage: true, endCursor } },
        }) }))).rejects.toMatchObject({ code: "LINEAR_INVALID_RESPONSE" });
    });

    it("accepts a repeated terminal cursor when no next page exists", async () => {
        let calls = 0;
        expect(await fetchLinearIssues(settings, async () => {
            calls += 1;
            return json({ data: data({ issues: {
                nodes: [], pageInfo: { hasNextPage: calls === 1, endCursor: "terminal" },
            } }) });
        })).toMatchObject({ issues: [], truncated: false });
        expect(calls).toBe(2);
    });

    it.each(["", "Bearer fake-key", " bearer\tfake-key "])("rejects a missing or Bearer-prefixed key before sending it (%s)", async (token) => {
        const fetcher = vi.fn();
        await expect(fetchLinearIssues({ ...settings, token }, fetcher)).rejects.toMatchObject({
            code: "LINEAR_TOKEN_INVALID", message: expect.stringContaining("without the Bearer prefix"),
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each([false, true])("rejects GraphQL errors even when HTTP 200 includes partial data (%s)", async (partial) => {
        await expect(fetchLinearIssues(settings, async () => json({
            errors: [{ message: "sensitive upstream detail", extensions: { code: "INTERNAL_SERVER_ERROR" } }],
            ...(partial ? { data: data() } : {}),
        }))).rejects.toMatchObject({ code: "LINEAR_UPSTREAM_ERROR", message: "Linear could not complete the query" });
    });

    it("recognizes authentication errors within HTTP 200", async () => {
        await expect(fetchLinearIssues(settings, async () => json({ errors: [{ extensions: { code: "UNAUTHENTICATED" } }] })))
            .rejects.toMatchObject({ status: 401, code: "LINEAR_TOKEN_INVALID" });
    });

    it.each([200, 429])("recognizes rate limits with Retry-After at HTTP %s", async (status) => {
        await expect(fetchLinearIssues(settings, async () => json({
            errors: [{ extensions: { code: "RATELIMITED" } }], data: data(),
        }, status, { "Retry-After": "17.2" }))).rejects.toMatchObject({
            status: 429, code: "LINEAR_RATE_LIMITED", retryAfterSeconds: 18,
        });
    });

    it("parses an HTTP-date Retry-After", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
        await expect(fetchLinearIssues(settings, async () => json({}, 429, { "Retry-After": "Mon, 26 Oct 2026 12:00:20 GMT" })))
            .rejects.toMatchObject({ retryAfterSeconds: 20 });
    });

    it.each([undefined, "nonsense"])("omits unavailable retry delays (%s)", async (value) => {
        await expect(fetchLinearIssues(settings, async () => json({}, 429, value ? { "Retry-After": value } : {})))
            .rejects.toMatchObject({ code: "LINEAR_RATE_LIMITED", retryAfterSeconds: undefined });
    });

    it.each([401, 500])("maps HTTP %s errors without exposing upstream messages", async (status) => {
        await expect(fetchLinearIssues(settings, async () => json({ secret: "never return" }, status)))
            .rejects.toMatchObject({ code: status === 401 ? "LINEAR_TOKEN_INVALID" : "LINEAR_UPSTREAM_ERROR" });
    });

    it("maps transport failures to a safe upstream error", async () => {
        await expect(fetchLinearIssues(settings, async () => { throw new Error("fake-personal-key"); }))
            .rejects.toMatchObject({ code: "LINEAR_UPSTREAM_ERROR", message: "Linear is unavailable" });
    });

    it("rejects a non-JSON successful response", async () => {
        await expect(fetchLinearIssues(settings, async () => new Response("<html>not JSON</html>")))
            .rejects.toMatchObject({ code: "LINEAR_INVALID_RESPONSE" });
    });

    it.each([
        {}, { data: null }, { errors: {}, data: data() }, { data: data({ states: null }) },
        { data: data({ issues: connection([issue({ priority: 8 })]) }) },
        { data: data({ issues: connection([issue({ state: null })]) }) },
        { data: data({ issues: { nodes: [], pageInfo: { hasNextPage: "false", endCursor: null } } }) },
    ])("rejects malformed payload %#", async (body) => {
        await expect(fetchLinearIssues(settings, async () => json(body))).rejects.toMatchObject({ code: "LINEAR_INVALID_RESPONSE" });
    });
});

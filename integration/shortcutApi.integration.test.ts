import { describe, expect, it } from "vitest";
import { fetchShortcutStories, ShortcutApiError } from "../supabase/functions/shortcut-sync/shortcutApi";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
    });
}

function story(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 74,
        app_url: "https://app.shortcut.com/worktime/story/74/backend-sync",
        name: "Backend sync",
        description: "Fetch Shortcut stories",
        estimate: 3,
        deadline: "2026-08-31T00:00:00Z",
        workflow_state_id: 10,
        completed: false,
        archived: false,
        story_type: "feature",
        labels: [{ id: 5, name: "integration" }],
        ...overrides,
    };
}

describe("Shortcut API client", () => {
    it("resolves the member, maps workflow states, and follows the next cursor", async () => {
        const requested: URL[] = [];
        const fetcher = async (input: string | URL | Request): Promise<Response> => {
            const url = new URL(input instanceof Request ? input.url : input.toString());
            requested.push(url);
            if (url.pathname === "/api/v3/member") return jsonResponse({ mention_name: "dylan" });
            if (url.pathname === "/api/v3/workflows") {
                return jsonResponse([{ states: [{ id: 10, name: "In Development" }] }]);
            }
            if (url.searchParams.get("next") === "page-2") {
                return jsonResponse({ data: [story({ id: 75, workflow_state_id: 999, description: null, estimate: null, deadline: null })], next: null });
            }
            return jsonResponse({ data: [story()], next: "/api/v3/search/stories?next=page-2" });
        };

        const stories = await fetchShortcutStories({ token: "never-log-me", teamName: "Data Thinkers" }, fetcher);

        expect(stories).toEqual([
            expect.objectContaining({ id: 74, status_name: "In Development", description: "Fetch Shortcut stories", estimate: 3 }),
            expect.objectContaining({ id: 75, status_name: "Unknown", description: "", estimate: null, deadline: null }),
        ]);
        expect(stories[0].labels).toEqual([{ id: 5, name: "integration" }]);
        expect(requested).toHaveLength(4);
        const firstSearch = requested[2];
        expect(firstSearch.searchParams.get("query")).toBe('team:"Data Thinkers" owner:dylan');
        expect(firstSearch.searchParams.get("page_size")).toBe("250");
        expect(firstSearch.searchParams.get("detail")).toBe("full");
    });

    it("reports an invalid or revoked token distinctly", async () => {
        const fetcher = async (): Promise<Response> => jsonResponse({ message: "unauthorized" }, 401);
        await expect(fetchShortcutStories({ token: "revoked", teamName: "Team" }, fetcher)).rejects.toMatchObject({
            name: "ShortcutApiError",
            status: 401,
            code: "SHORTCUT_TOKEN_INVALID",
        });
    });

    it("reports rate limiting with a retry delay", async () => {
        const fetcher = async (): Promise<Response> => jsonResponse({}, 429, { "Retry-After": "17" });
        await expect(fetchShortcutStories({ token: "limited", teamName: "Team" }, fetcher)).rejects.toMatchObject({
            status: 429,
            code: "SHORTCUT_RATE_LIMITED",
            retryAfterSeconds: 17,
        });
    });

    it("rejects a pagination cursor that could leave the Shortcut search endpoint", async () => {
        let call = 0;
        const fetcher = async (): Promise<Response> => {
            call += 1;
            if (call === 1) return jsonResponse({ mention_name: "dylan" });
            if (call === 2) return jsonResponse([{ states: [] }]);
            return jsonResponse({ data: [story()], next: "https://example.test/steal" });
        };

        const result = fetchShortcutStories({ token: "safe", teamName: "Team" }, fetcher);
        await expect(result).rejects.toBeInstanceOf(ShortcutApiError);
        await expect(result).rejects.toMatchObject({ code: "SHORTCUT_INVALID_RESPONSE" });
    });
});

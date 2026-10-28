import { describe, expect, it } from "vitest";
import type { GoogleCalendarConnection } from "../_shared/googleCalendarTypes.ts";
import { authorizeGoogleConnection, matchGoogleConnection } from "./googleConnectionAuthorization.ts";
import { buildGoogleAuthorizationUrl, GOOGLE_CALENDAR_READONLY_SCOPE, validateReturnUrl } from "./googleOAuth.ts";

const connection = (id: string, overrides: Partial<GoogleCalendarConnection> = {}): GoogleCalendarConnection => ({
    id, owner_id: "owner", google_account_id: `sub-${id}`, google_account_email: `${id}@example.com`, primary_calendar_id: `primary-${id}`,
    refresh_token: `refresh-${id}`, scope_level: "readonly", selected_calendar_ids: [], worktime_calendar_id: null, is_scheduling_target: id === "a",
    identity_source: "userinfo", connected_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...overrides,
});
const input = { code: "code", codeVerifier: "v".repeat(64), clientId: "client", clientSecret: "secret", redirectUri: "https://worktime.test/callback" };
function google(options: { sub?: string | null; email?: string; primary?: string; refreshToken?: string; legacyPrimary?: string } = {}): typeof fetch {
    return async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/token")) {
            const legacy = new URLSearchParams(String(init?.body)).has("refresh_token");
            return Response.json({ access_token: legacy ? "legacy" : "consented", refresh_token: options.refreshToken, scope: GOOGLE_CALENDAR_READONLY_SCOPE });
        }
        if (String(url).endsWith("/userinfo")) return Response.json({ sub: options.sub === undefined ? "sub-a" : options.sub, email: options.email });
        const legacy = new Headers(init?.headers).get("Authorization") === "Bearer legacy";
        return Response.json({ items: [{ id: legacy ? options.legacyPrimary ?? "primary-a" : options.primary ?? "primary-a", summary: "Primary", primary: true, accessRole: "owner" }] });
    };
}

describe("account-aware Google authorization", () => {
    it("requests identity scopes and account selection and strips the same reserved return keys", () => {
        const url = new URL(buildGoogleAuthorizationUrl({ ...input, state: "state", codeChallenge: "challenge", scopeLevel: "readonly" }));
        expect(url.searchParams.get("scope")?.split(" ")).toEqual(["openid", "email", GOOGLE_CALENDAR_READONLY_SCOPE]);
        expect(url.searchParams.get("prompt")).toBe("select_account consent");
        const returned = validateReturnUrl("https://worktime.test/projects?keep=yes&google_calendar=forged&google_calendar_scope=readonly&google_calendar_error=fake&pending_task_id=bad&pending_scheduled_start=bad&connection_id=bad#secret", ["https://worktime.test"]);
        expect(returned.toString()).toBe("https://worktime.test/projects?keep=yes");
        expect(() => validateReturnUrl("https://other.test/", ["https://worktime.test"])).toThrow();
    });

    it("reuses only the consented account's token, with email withheld", async () => {
        const result = await authorizeGoogleConnection({ ...input, connections: [connection("b"), connection("a")], targetConnectionId: "a" }, google());
        expect(result).toMatchObject({ connectionId: "a", identity: { sub: "sub-a", email: null }, token: { refreshToken: "refresh-a" } });
    });

    it("rejects choosing another account during a targeted upgrade even with a new refresh token", async () => {
        await expect(authorizeGoogleConnection({ ...input, connections: [connection("a"), connection("b")], targetConnectionId: "b" }, google({ refreshToken: "new" })))
            .rejects.toMatchObject({ code: "GOOGLE_ACCOUNT_MISMATCH" });
    });

    it("does not reuse an unrelated token when a new account omits refresh_token", async () => {
        await expect(authorizeGoogleConnection({ ...input, connections: [connection("b")] }, google())).rejects.toMatchObject({ code: "GOOGLE_OAUTH_INVALID_RESPONSE" });
    });

    it("matches sub before email and does not merge two known subjects by email", () => {
        const a = connection("a");
        const legacy = connection("legacy", { google_account_id: null, identity_source: "calendar_list", google_account_email: "a@example.com" });
        expect(matchGoogleConnection({ connections: [legacy, a], sub: "sub-a", email: "a@example.com", primaryCalendarId: "primary-a" })?.id).toBe("a");
        expect(matchGoogleConnection({ connections: [a], sub: "different", email: "a@example.com", primaryCalendarId: "primary-a" })).toBeNull();
        expect(matchGoogleConnection({ connections: [legacy], sub: "sub-a", email: "a@example.com", primaryCalendarId: null })?.id).toBe("legacy");
    });

    it("adopts an untouched legacy row with a non-email primary calendar", async () => {
        const result = await authorizeGoogleConnection({ ...input, connections: [connection("old", {
            google_account_id: null, google_account_email: null, primary_calendar_id: null, identity_source: "legacy",
        })] }, google({ primary: "opaque-primary", legacyPrimary: "opaque-primary" }));
        expect(result).toMatchObject({ connectionId: "old", primaryCalendarId: "opaque-primary", token: { refreshToken: "refresh-old" } });
    });

    it("does not adopt an unrelated legacy row", async () => {
        await expect(authorizeGoogleConnection({ ...input, connections: [connection("old", {
            google_account_id: null, google_account_email: null, primary_calendar_id: null, identity_source: "legacy",
        })] }, google({ primary: "different", legacyPrimary: "old-primary" }))).rejects.toMatchObject({ code: "GOOGLE_OAUTH_INVALID_RESPONSE" });
    });

    it("rejects a sixth account before saving but permits reauthorization at the cap", async () => {
        const connections = ["a", "b", "c", "d", "e"].map((id) => connection(id));
        await expect(authorizeGoogleConnection({ ...input, connections }, google({ sub: "sub-sixth", refreshToken: "new" })))
            .rejects.toMatchObject({ code: "GOOGLE_ACCOUNT_LIMIT_REACHED" });
        await expect(authorizeGoogleConnection({ ...input, connections }, google())).resolves.toMatchObject({ connectionId: "a" });
    });

    it("requires a real subject and rejects missing target ids", async () => {
        await expect(authorizeGoogleConnection({ ...input, connections: [] }, google({ sub: null, refreshToken: "new" }))).rejects.toMatchObject({ code: "GOOGLE_OAUTH_INVALID_RESPONSE" });
        expect(() => matchGoogleConnection({ connections: [], sub: "sub", email: null, primaryCalendarId: null, targetConnectionId: "missing" }))
            .toThrowError(expect.objectContaining({ code: "GOOGLE_CONNECTION_NOT_FOUND" }));
    });
    it("rejects ambiguous legacy emails and unmatched targeted accounts", () => {
        const legacy = (id: string) => connection(id, { google_account_id: null, google_account_email: "same@example.com", identity_source: "calendar_list" });
        expect(() => matchGoogleConnection({ connections: [legacy("a"), legacy("b")], sub: "unknown", email: "same@example.com", primaryCalendarId: null }))
            .toThrowError(expect.objectContaining({ code: "GOOGLE_ACCOUNT_MISMATCH" }));
        expect(() => matchGoogleConnection({ connections: [connection("a")], targetConnectionId: "a", sub: "unknown", email: null, primaryCalendarId: null }))
            .toThrowError(expect.objectContaining({ code: "GOOGLE_ACCOUNT_MISMATCH" }));
    });

    it.each([400, 429, 500])("does not insert a duplicate after legacy refresh fails with %s", async (status) => {
        const normal = google({ refreshToken: "new" });
        const fetcher: typeof fetch = async (url: string | URL | Request, init?: RequestInit) => {
            if (String(url).endsWith("/token") && new URLSearchParams(String(init?.body)).has("refresh_token")) return Response.json({}, { status });
            return normal(url, init);
        };
        await expect(authorizeGoogleConnection({ ...input, connections: [connection("old", { google_account_id: null, primary_calendar_id: null, google_account_email: null, identity_source: "legacy" })] }, fetcher))
            .rejects.toMatchObject({ code: status === 400 ? "GOOGLE_LEGACY_CONNECTION_UNVERIFIED" : status === 429 ? "GOOGLE_RATE_LIMITED" : "GOOGLE_OAUTH_EXCHANGE_FAILED" });
    });

    it.each([403, 500, "network"])("rejects failed identity lookup %s", async (status) => {
        const normal = google({ refreshToken: "new" });
        const fetcher: typeof fetch = async (url: string | URL | Request, init?: RequestInit) => {
            if (String(url).endsWith("/userinfo")) {
                if (status === "network") throw new Error("offline");
                return Response.json({}, { status: Number(status) });
            }
            return normal(url, init);
        };
        await expect(authorizeGoogleConnection({ ...input, connections: [] }, fetcher)).rejects.toMatchObject({ code: status === "network" ? "GOOGLE_OAUTH_UNAVAILABLE" : "GOOGLE_OAUTH_INVALID_RESPONSE" });
    });

    it("persists discovered legacy identity for future callbacks", async () => {
        const persisted: GoogleCalendarConnection[] = [];
        await authorizeGoogleConnection({ ...input, connections: [connection("old", { google_account_id: null, primary_calendar_id: null, google_account_email: null, identity_source: "legacy" })], persistIdentity: async (value) => { persisted.push(value); } }, google());
        expect(persisted).toEqual([expect.objectContaining({ id: "old", primary_calendar_id: "primary-a", identity_source: "calendar_list" })]);
    });

});

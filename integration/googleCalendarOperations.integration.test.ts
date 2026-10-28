import { afterEach, describe, expect, it } from "vitest";
import { executeGoogleCalendarAction } from "../supabase/functions/google-calendar/googleCalendarOperations";
import { createLocalUser, type LocalUser } from "../tests/supabase/localSupabase";

const users: LocalUser[] = [];
afterEach(async () => { await Promise.all(users.splice(0).map((user) => user.cleanup())); });
async function setup() {
    const owner = await createLocalUser(); users.push(owner);
    const ids: string[] = [];
    for (const name of ["a", "b"]) {
        const saved = await owner.admin.rpc("save_google_calendar_connection", { p_owner_id: owner.userId, p_connection_id: null,
            p_google_account_id: name, p_google_account_email: `${name}@example.com`, p_primary_calendar_id: name, p_refresh_token: name, p_scope_level: "schedule" });
        expect(saved.error).toBeNull(); ids.push(saved.data as string);
        expect((await owner.admin.from("google_calendar_connections").update({ selected_calendar_ids: [name], worktime_calendar_id: `worktime-${name}` }).eq("id", saved.data)).error).toBeNull();
    }
    return { owner, a: ids[0], b: ids[1] };
}
function google(failures: Record<string, number> = {}) {
    const calls: Array<{ path: string; account: string | null; method: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        const account = url.pathname === "/token" || url.pathname === "/revoke"
            ? new URLSearchParams(String(init?.body)).get(url.pathname === "/token" ? "refresh_token" : "token")
            : new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "") ?? null;
        calls.push({ path: url.pathname, account, method: init?.method ?? "GET" });
        if (url.pathname === "/token") return Response.json({ access_token: account }, { status: failures[account!] ?? 200 });
        if (url.pathname === "/revoke") return new Response(null, { status: 200 });
        if (url.pathname.endsWith("calendarList")) return Response.json({ items: [{ id: account, summary: account, accessRole: "owner", primary: true }] });
        if (url.pathname.endsWith("freeBusy")) {
            const ids = (JSON.parse(String(init?.body)).items as { id: string }[]).map((item) => item.id);
            return Response.json({ calendars: Object.fromEntries(ids.map((id) => [id, { busy: [] }])) });
        }
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        if (init?.method === "POST" || init?.method === "PATCH") return Response.json({ id: JSON.parse(String(init.body)).id ?? "event" });
        return Response.json({ id: decodeURIComponent(url.pathname.split("/").pop()!) });
    };
    return { fetcher, calls };
}
const task = { task_id: "task-1", title: "Focus", scheduled_start: "2026-10-27T14:00:00Z", estimate_pomos: 1, work_minutes: 25, allow_conflict: true };
const invoke = (owner: LocalUser, fetcher: typeof fetch, body: Record<string, unknown>) => executeGoogleCalendarAction({
    supabase: owner.admin, ownerId: owner.userId, clientId: "client", clientSecret: "secret", fetcher, body,
});

describe("Google Calendar operation routing", () => {
    it("pins resync and unpush to the original credential/calendar after changing targets", async () => {
        const { owner, a, b } = await setup(); const fake = google();
        const first = await invoke(owner, fake.fetcher, { action: "push_task", ...task });
        expect(first.status).toBe(200); expect((await first.json()).link).toMatchObject({ connection_id: a, calendar_id: "worktime-a" });
        expect((await owner.client.rpc("set_google_calendar_scheduling_connection", { p_connection_id: b })).error).toBeNull();
        // A changed stored default must not move an already-linked event.
        await owner.admin.from("google_calendar_connections").update({ worktime_calendar_id: "replacement-a" }).eq("id", a);
        const before = fake.calls.length;
        const resync = await invoke(owner, fake.fetcher, { action: "resync_task", ...task, estimate_pomos: 2 });
        expect(resync.status).toBe(200); expect((await resync.json()).link).toMatchObject({ connection_id: a, calendar_id: "worktime-a" });
        expect(fake.calls.slice(before).find((call) => call.method === "PATCH")).toMatchObject({ account: "a", path: expect.stringContaining("/calendars/worktime-a/events/") });
        const second = await invoke(owner, fake.fetcher, { action: "push_task", ...task, task_id: "task-2" });
        expect(second.status).toBe(200); expect((await second.json()).link).toMatchObject({ connection_id: b, calendar_id: "worktime-b" });
        const unpush = await invoke(owner, fake.fetcher, { action: "unpush_task", task_id: "task-1" });
        expect(unpush.status).toBe(200);
        expect(fake.calls.find((call) => call.method === "DELETE")).toMatchObject({ account: "a", path: expect.stringContaining("/calendars/worktime-a/events/") });
        expect((await owner.client.from("google_calendar_task_links").select("task_id, connection_id")).data).toEqual([{ task_id: "task-2", connection_id: b }]);
    });

    it.each([401, 429])("returns 200 for a single %s failure and an error when all accounts fail", async (status) => {
        const { owner, a } = await setup();
        const partial = await invoke(owner, google({ a: status }).fetcher, { action: "busy", time_min: "2026-10-27T08:00Z", time_max: "2026-10-27T18:00Z" });
        expect(partial.status).toBe(200);
        expect((await partial.json()).sources).toContainEqual(expect.objectContaining({ connection_id: a, error_code: status === 401 ? "GOOGLE_TOKEN_INVALID" : "GOOGLE_RATE_LIMITED" }));
        const all = await invoke(owner, google({ a: status, b: 401 }).fetcher, { action: "list_calendars" });
        expect(all.status).toBe(status);
    });

    it("disconnects exactly one account and keeps the other readable without removing Google events", async () => {
        const { owner, a, b } = await setup(); const fake = google();
        const result = await invoke(owner, fake.fetcher, { action: "disconnect", connection_id: a });
        expect(result.status).toBe(200);
        expect(fake.calls).toEqual([{ path: "/revoke", account: "a", method: "POST" }]);
        expect((await owner.client.from("google_calendar_connections").select("id, is_scheduling_target")).data).toEqual([{ id: b, is_scheduling_target: true }]);
        const calendars = await invoke(owner, fake.fetcher, { action: "list_calendars" });
        expect(calendars.status).toBe(200); expect((await calendars.json()).calendars).toEqual([expect.objectContaining({ connection_id: b })]);
        const unknown = await invoke(owner, fake.fetcher, { action: "disconnect", connection_id: a });
        expect(unknown.status).toBe(404);
        expect((await invoke(owner, fake.fetcher, { action: "disconnect" })).status).toBe(200);
        expect((await owner.client.from("google_calendar_connections").select("id")).data).toEqual([]);
    });

    it("requires a scheduling target and preserves the event-window limit", async () => {
        const { owner } = await setup(); const fake = google();
        await owner.admin.from("google_calendar_connections").update({ is_scheduling_target: false }).eq("owner_id", owner.userId);
        const result = await invoke(owner, fake.fetcher, { action: "push_task", ...task });
        expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ code: "GOOGLE_SCHEDULING_ACCOUNT_REQUIRED" });
        const window = await invoke(owner, fake.fetcher, { action: "list_events", time_min: "2026-10-01", time_max: "2026-10-10" });
        expect(window.status).toBe(400); expect(fake.calls).toEqual([]);
    });

    it("persists legacy primary-calendar identity on writes, including an idempotent push", async () => {
        const { owner, a } = await setup(); const fake = google();
        await owner.admin.from("google_calendar_connections").update({ google_account_id: null, google_account_email: null, primary_calendar_id: null, identity_source: "legacy" }).eq("id", a);
        expect((await invoke(owner, fake.fetcher, { action: "push_task", ...task })).status).toBe(200);
        expect((await owner.client.from("google_calendar_connections").select("google_account_id, primary_calendar_id, identity_source").eq("id", a).single()).data)
            .toEqual({ google_account_id: null, primary_calendar_id: "a", identity_source: "calendar_list" });
        await owner.admin.from("google_calendar_connections").update({ primary_calendar_id: null, identity_source: "legacy" }).eq("id", a);
        const before = fake.calls.length;
        expect((await invoke(owner, fake.fetcher, { action: "push_task", ...task })).status).toBe(200);
        expect(fake.calls.slice(before).some((call) => call.path.endsWith("calendarList"))).toBe(true);
        expect(fake.calls.slice(before).some((call) => call.method === "POST" && call.path.includes("events"))).toBe(false);
    });
    it.each([401, 429])("blocks a push when conflict checking is incomplete (%s)", async (status) => {
        const { owner } = await setup(); const fake = google({ b: status });
        const response = await invoke(owner, fake.fetcher, { action: "push_task", ...task, allow_conflict: false });
        expect(response.status).not.toBe(200);
        expect(fake.calls.some((call) => call.method === "POST" && call.path.includes("events"))).toBe(false);
    });

    it("returns the actual conflict without writing an event", async () => {
        const { owner } = await setup(); const fake = google();
        const fetcher: typeof fetch = async (url, init) => {
            if (String(url).endsWith("freeBusy")) {
                const ids = JSON.parse(String(init?.body)).items as { id: string }[];
                return Response.json({ calendars: Object.fromEntries(ids.map(({ id }) => [id, { busy: [{ start: "2026-10-27T14:00:00Z", end: "2026-10-27T14:25:00Z" }] }])) });
            }
            if (new URL(String(url)).pathname.endsWith("/events")) return Response.json({ items: [{ id: "busy", start: { dateTime: "2026-10-27T14:00:00Z" }, end: { dateTime: "2026-10-27T14:25:00Z" } }] });
            return fake.fetcher(url, init);
        };
        const response = await invoke(owner, fetcher, { action: "push_task", ...task, allow_conflict: false });
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: "CALENDAR_CONFLICT", conflicts: [expect.any(Object)] });
        expect(fake.calls.some((call) => call.path.includes("events"))).toBe(false);
    });

    it("keeps idempotent legacy pushes successful when credentials fail", async () => {
        const { owner, a } = await setup();
        expect((await invoke(owner, google().fetcher, { action: "push_task", ...task })).status).toBe(200);
        await owner.admin.from("google_calendar_connections").update({ google_account_id: null, primary_calendar_id: null, identity_source: "legacy" }).eq("id", a);
        const fake = google({ a: 401 });
        expect((await invoke(owner, fake.fetcher, { action: "push_task", ...task })).status).toBe(200);
        expect(fake.calls.some((call) => call.path.includes("events"))).toBe(false);
    });

});

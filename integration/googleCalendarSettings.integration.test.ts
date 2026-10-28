import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalUser, type LocalUser } from "../tests/supabase/localSupabase";
import { SupabaseGoogleCalendarDataAccess } from "../src/lib/data/GoogleCalendarDataAccess";

const users: LocalUser[] = [];
afterEach(async () => { await Promise.all(users.splice(0).map((user) => user.cleanup())); });
async function user() { const value = await createLocalUser(); users.push(value); return value; }
const credentials = (owner: LocalUser, sub: string, connectionId: string | null = null) => ({
    p_owner_id: owner.userId, p_connection_id: connectionId, p_google_account_id: sub,
    p_google_account_email: `${sub}@example.com`, p_primary_calendar_id: `${sub}@example.com`, p_refresh_token: `secret-${sub}`, p_scope_level: "schedule",
});
async function save(owner: LocalUser, sub: string) {
    const result = await owner.admin.rpc("save_google_calendar_connection", credentials(owner, sub));
    expect(result.error).toBeNull();
    return result.data as string;
}
const link = (ownerId: string, connectionId: string, taskId: string) => ({
    owner_id: ownerId, connection_id: connectionId, task_id: taskId, calendar_id: "calendar", event_id: taskId,
    scheduled_start: "2026-10-27T14:00:00Z", scheduled_end: "2026-10-27T14:25:00Z", estimate_pomos: 1, work_minutes: 25,
});

describe("Google Calendar connection storage", () => {
    it("keeps credentials and OAuth state service-only across multiple owner-scoped connections", async () => {
        const owner = await user(); const other = await user();
        const a = await save(owner, "a"); await save(owner, "b");
        const visible = await owner.client.from("google_calendar_connections").select("id, owner_id, google_account_email, scope_level, is_scheduling_target");
        expect(visible.error).toBeNull(); expect(visible.data).toHaveLength(2);
        expect((await other.client.from("google_calendar_connections").select("id").eq("owner_id", owner.userId)).data).toEqual([]);
        expect((await owner.client.from("google_calendar_connections").select("refresh_token")).error).not.toBeNull();
        expect((await owner.client.from("google_calendar_connections").select("*")).error).not.toBeNull();
        expect((await owner.admin.from("google_calendar_connections").select("refresh_token").eq("id", a).single()).data?.refresh_token).toBe("secret-a");
        expect((await owner.client.rpc("save_google_calendar_connection", credentials(owner, "stolen"))).error).toMatchObject({ code: "42501" });
        expect((await owner.client.from("google_calendar_connections").insert({ owner_id: owner.userId, refresh_token: "stolen", scope_level: "schedule" })).error).not.toBeNull();
        expect((await owner.client.from("google_calendar_connections").update({ is_scheduling_target: false }).eq("id", a)).error).not.toBeNull();
        expect((await owner.client.from("google_calendar_connections").delete().eq("id", a)).error).not.toBeNull();
        const state = await owner.admin.from("google_calendar_oauth_states").insert({
            state_hash: "a".repeat(64), owner_id: owner.userId, connection_id: a, code_verifier: "v".repeat(64),
            requested_scope_level: "schedule", return_to: "https://worktime.test/projects", expires_at: "2026-10-27T15:00:00Z",
        });
        expect(state.error).toBeNull();
        expect((await owner.client.from("google_calendar_oauth_states").select("state_hash, code_verifier")).error).not.toBeNull();
    });

    it("normalizes connection preferences and rejects both RPCs across owners", async () => {
        const owner = await user(); const other = await user();
        const a = await save(owner, "a"); const b = await save(owner, "b");
        const browser = new SupabaseGoogleCalendarDataAccess(owner.client, owner.userId);
        expect(await browser.loadConnections()).toHaveLength(2);
        expect(await browser.loadSettings()).toMatchObject({ connectionId: a });
        expect((await owner.client.rpc("update_google_calendar_preferences", { p_connection_id: a, p_selected_calendar_ids: [" team ", "primary", "team"] })).error).toBeNull();
        expect((await owner.client.from("google_calendar_connections").select("selected_calendar_ids").eq("id", a).single()).data?.selected_calendar_ids).toEqual(["primary", "team"]);
        for (const selected of [null, [""], [null], Array.from({ length: 51 }, (_, i) => String(i))]) {
            expect((await owner.client.rpc("update_google_calendar_preferences", { p_connection_id: a, p_selected_calendar_ids: selected })).error?.message).toContain("GOOGLE_CALENDAR_SELECTION_INVALID");
        }
        expect((await other.client.rpc("update_google_calendar_preferences", { p_connection_id: a, p_selected_calendar_ids: [] })).error?.message).toContain("GOOGLE_CONNECTION_NOT_FOUND");
        expect((await other.client.rpc("set_google_calendar_scheduling_connection", { p_connection_id: a })).error?.message).toContain("GOOGLE_CONNECTION_NOT_FOUND");
        expect((await owner.client.rpc("set_google_calendar_scheduling_connection", { p_connection_id: b })).error).toBeNull();
        expect((await owner.client.from("google_calendar_connections").select("id").eq("is_scheduling_target", true)).data).toEqual([{ id: b }]);
        expect((await owner.admin.from("google_calendar_connections").update({ is_scheduling_target: true }).eq("id", a)).error).toMatchObject({ code: "23505" });
    });

    it("serializes concurrent callbacks at the cap and updates the same subject instead of adding a slot", async () => {
        const owner = await user();
        const a = await save(owner, "a");
        await Promise.all(["b", "c", "d"].map((sub) => save(owner, sub)));
        const raced = await Promise.all(["e", "f"].map((sub) => owner.admin.rpc("save_google_calendar_connection", credentials(owner, sub))));
        expect(raced.filter((result) => !result.error)).toHaveLength(1);
        expect(raced.find((result) => result.error)?.error?.message).toContain("GOOGLE_ACCOUNT_LIMIT_REACHED");
        const same = await Promise.all([1, 2].map(() => owner.admin.rpc("save_google_calendar_connection", { ...credentials(owner, "a"), p_refresh_token: "updated" })));
        expect(same.map((result) => result.data)).toEqual([a, a]);
        expect((await owner.admin.from("google_calendar_connections").select("id").eq("owner_id", owner.userId)).data).toHaveLength(5);
        const updates = await Promise.all([a, raced.find((result) => !result.error)!.data as string].map((id) => owner.client.rpc("set_google_calendar_scheduling_connection", { p_connection_id: id })));
        expect(updates.every((result) => !result.error)).toBe(true);
        expect((await owner.client.from("google_calendar_connections").select("id").eq("is_scheduling_target", true)).data).toHaveLength(1);
    });

    it("attributes links and OAuth states to their owner/connection and cascades only that account", async () => {
        const owner = await user(); const other = await user();
        const a = await save(owner, "a"); const b = await save(owner, "b"); const foreign = await save(other, "foreign");
        expect((await owner.admin.rpc("save_google_calendar_connection", credentials(owner, "foreign", foreign))).error?.message).toContain("GOOGLE_CONNECTION_NOT_FOUND");
        expect((await owner.admin.from("google_calendar_task_links").insert([link(owner.userId, a, "task-a"), link(owner.userId, b, "task-b")])).error).toBeNull();
        expect((await owner.admin.from("google_calendar_task_links").insert(link(owner.userId, foreign, "wrong-owner"))).error).toMatchObject({ code: "23503" });
        expect((await other.client.from("google_calendar_task_links").select("task_id").eq("owner_id", owner.userId)).data).toEqual([]);
        expect((await owner.client.from("google_calendar_task_links").insert(link(owner.userId, a, "browser-write"))).error).not.toBeNull();
        for (const [index, id] of [a, b, null].entries()) {
            expect((await owner.admin.from("google_calendar_oauth_states").insert({ state_hash: String(index).repeat(64), owner_id: owner.userId,
                connection_id: id, code_verifier: "v".repeat(64), requested_scope_level: "readonly", return_to: "https://worktime.test/", expires_at: "2026-10-27T15:00:00Z" })).error).toBeNull();
        }
        expect((await owner.admin.rpc("delete_google_calendar_connections", { p_owner_id: owner.userId, p_connection_id: a })).error).toBeNull();
        expect((await owner.client.from("google_calendar_task_links").select("task_id, connection_id")).data).toEqual([{ task_id: "task-b", connection_id: b }]);
        expect((await owner.admin.from("google_calendar_oauth_states").select("connection_id").eq("owner_id", owner.userId)).data).toHaveLength(2);
        expect((await owner.client.from("google_calendar_connections").select("id").eq("is_scheduling_target", true)).data).toEqual([{ id: b }]);
        expect((await owner.client.rpc("delete_google_calendar_connections", { p_owner_id: owner.userId, p_connection_id: b })).error).toMatchObject({ code: "42501" });
        expect((await owner.admin.rpc("delete_google_calendar_connections", { p_owner_id: owner.userId, p_connection_id: null })).error).toBeNull();
        expect((await owner.admin.from("google_calendar_oauth_states").select("state_hash").eq("owner_id", owner.userId)).data).toEqual([]);
        expect((await other.client.from("google_calendar_connections").select("id")).data).toEqual([{ id: foreign }]);
    });

    it("promotes the oldest schedule account before readonly accounts, then the oldest remaining account", async () => {
        const owner = await user();
        const a = await save(owner, "a"); const b = await save(owner, "b"); const c = await save(owner, "c");
        await owner.admin.from("google_calendar_connections").update({ scope_level: "readonly", connected_at: "2025-01-01" }).eq("id", b);
        await owner.admin.rpc("delete_google_calendar_connections", { p_owner_id: owner.userId, p_connection_id: a });
        expect((await owner.client.from("google_calendar_connections").select("id").eq("is_scheduling_target", true)).data).toEqual([{ id: c }]);
        await owner.admin.rpc("delete_google_calendar_connections", { p_owner_id: owner.userId, p_connection_id: c });
        expect((await owner.client.from("google_calendar_connections").select("id").eq("is_scheduling_target", true)).data).toEqual([{ id: b }]);
    });

    it("backfills legacy credentials, task links and in-flight states before dropping the old table", async () => {
        const owner = await user();
        const orphan = await user();
        const oldMigration = readFileSync("supabase/migrations/20260813000000_google_calendar_integration.sql", "utf8");
        const migration = readFileSync("supabase/migrations/20261027000000_google_calendar_connections.sql", "utf8");
        // Exercise the actual migration transactionally. Rollback restores the
        // running stack; db reset would erase a fixture seeded before the reset.
        const sql = `begin;
            drop table public.google_calendar_task_links, public.google_calendar_oauth_states, public.google_calendar_connections cascade;
            drop function public.save_google_calendar_connection(uuid,uuid,text,text,text,text,text);
            drop function private.save_google_calendar_connection(uuid,uuid,text,text,text,text,text);
            drop function public.update_google_calendar_preferences(uuid,text[]);
            drop function public.set_google_calendar_scheduling_connection(uuid);
            drop function private.set_google_calendar_scheduling_connection(uuid);
            drop function public.delete_google_calendar_connections(uuid,uuid);
            drop function private.delete_google_calendar_connections(uuid,uuid);
            drop function public.normalize_google_calendar_selection();
            ${oldMigration}
            insert into public.google_calendar_settings(owner_id,refresh_token,scope_level,selected_calendar_ids,worktime_calendar_id,connected_at)
                values ('${owner.userId}','legacy-secret','schedule',array['primary'],'legacy-worktime','2026-01-01');
            insert into public.google_calendar_task_links(owner_id,task_id,calendar_id,event_id,scheduled_start,scheduled_end,estimate_pomos,work_minutes)
                values ('${owner.userId}','legacy-task','legacy-worktime','legacy-event','2026-10-27T14:00Z','2026-10-27T14:25Z',1,25);
            insert into public.google_calendar_oauth_states(state_hash,owner_id,code_verifier,requested_scope_level,return_to,expires_at)
                values (repeat('z',64),'${owner.userId}',repeat('v',64),'schedule','https://worktime.test/','2026-10-27T15:00Z');
            insert into public.google_calendar_task_links(owner_id,task_id,calendar_id,event_id,scheduled_start,scheduled_end,estimate_pomos,work_minutes)
                values ('${orphan.userId}','orphan-task','old','old','2026-10-27T14:00Z','2026-10-27T14:25Z',1,25);
            ${migration}
            select json_build_object('count',(select count(*) from public.google_calendar_connections),
                'legacy',(select google_account_id is null and is_scheduling_target and refresh_token='legacy-secret' and selected_calendar_ids=array['primary'] and worktime_calendar_id='legacy-worktime' and connected_at='2026-01-01'::timestamptz from public.google_calendar_connections),
                'link',(select l.connection_id=c.id from public.google_calendar_task_links l join public.google_calendar_connections c using(owner_id)),
                'state',(select s.connection_id=c.id from public.google_calendar_oauth_states s join public.google_calendar_connections c using(owner_id)),
                'orphan_removed',not exists(select 1 from public.google_calendar_task_links where task_id='orphan-task'),
                'old_gone',to_regclass('public.google_calendar_settings') is null,
                'old_writer_gone',to_regprocedure('public.save_google_calendar_connection(uuid,text,text)') is null);
            rollback;`;
        const result = spawnSync("docker", ["exec", "-i", "supabase_db_worktime", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8" });
        expect(result.status, result.stderr).toBe(0);
        const line = result.stdout.split(/\r?\n/).find((line) => line.startsWith("{"));
        expect(JSON.parse(line!)).toEqual({ count: 1, orphan_removed: true, legacy: true, link: true, state: true, old_gone: true, old_writer_gone: true });
    });
    it("normalizes direct preference writes and rejects malformed array elements", async () => {
        const owner = await user(); const a = await save(owner, "a");
        expect((await owner.client.from("google_calendar_connections").update({ selected_calendar_ids: [" team ", "team", "primary"] }).eq("id", a)).error).toBeNull();
        expect((await owner.client.from("google_calendar_connections").select("selected_calendar_ids").eq("id", a).single()).data?.selected_calendar_ids).toEqual(["primary", "team"]);
        for (const selected of [[null], ["  "]]) {
            expect((await owner.client.from("google_calendar_connections").update({ selected_calendar_ids: selected }).eq("id", a)).error?.message).toContain("GOOGLE_CALENDAR_SELECTION_INVALID");
        }
    });

    it("reports a domain mismatch when adopting a legacy row into an already-owned subject", async () => {
        const owner = await user(); const a = await save(owner, "a"); await save(owner, "b");
        await owner.admin.from("google_calendar_connections").update({ google_account_id: null, identity_source: "legacy" }).eq("id", a);
        expect((await owner.admin.rpc("save_google_calendar_connection", credentials(owner, "b", a))).error?.message).toBe("GOOGLE_ACCOUNT_MISMATCH");
    });
});

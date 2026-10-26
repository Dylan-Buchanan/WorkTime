import { afterEach, describe, expect, it } from "vitest";
import { createLocalUser, type LocalUser } from "../tests/supabase/localSupabase";

const users: LocalUser[] = [];
afterEach(async () => { await Promise.all(users.splice(0).map((user) => user.cleanup())); });

async function user(): Promise<LocalUser> {
    const result = await createLocalUser();
    users.push(result);
    return result;
}

const visibleColumns = "owner_id, team_key, included_statuses, default_project_id, last_synced_at, updated_at";

describe("Linear settings storage", () => {
    it("upserts credentials and updates preferences without returning or replacing the token", async () => {
        const owner = await user();
        expect((await owner.client.rpc("save_linear_settings", { p_linear_token: "first-fake-key" })).error).toBeNull();
        const first = await owner.client.from("linear_settings").select(visibleColumns).single();
        expect(first.error).toBeNull();
        expect(first.data).toMatchObject({ owner_id: owner.userId, team_key: null, included_statuses: [], default_project_id: null, last_synced_at: null });

        const saved = await owner.client.rpc("save_linear_settings", {
            p_linear_token: " replacement-fake-key ", p_team_key: " eNg ",
            p_included_statuses: ["Todo"], p_default_project_id: " project-a ",
        });
        expect(saved.error).toBeNull();
        expect(saved.data).toBeNull();
        expect((await owner.client.from("linear_settings").select(visibleColumns).single()).data).toMatchObject({
            team_key: "eNg", included_statuses: ["Todo"], default_project_id: "project-a",
        });
        expect((await owner.client.rpc("update_linear_preferences", {
            p_team_key: "   ", p_included_statuses: ["In Progress"], p_default_project_id: " project-b ",
        })).error).toBeNull();

        const visible = await owner.client.from("linear_settings").select(visibleColumns).single();
        expect(visible.error).toBeNull();
        expect(visible.data).toMatchObject({ owner_id: owner.userId, team_key: null, included_statuses: ["In Progress"], default_project_id: "project-b", last_synced_at: null });
        expect(Date.parse(visible.data!.updated_at)).toBeGreaterThanOrEqual(Date.parse(first.data!.updated_at));

        for (const columns of ["linear_token", "*"]) {
            const secret = await owner.client.from("linear_settings").select(columns);
            expect(secret.data).toBeNull();
            expect(secret.error?.code).toBe("42501");
        }
        const adminRead = await owner.admin.from("linear_settings").select("linear_token").eq("owner_id", owner.userId).single();
        expect(adminRead.error).toBeNull();
        expect(adminRead.data?.linear_token).toBe("replacement-fake-key");

        for (const column of ["last_synced_at", "updated_at"]) {
            const spoof = await owner.client.from("linear_settings").update({ [column]: "2026-10-26T12:00:00Z" }).eq("owner_id", owner.userId);
            expect(spoof.error?.code).toBe("42501");
        }
        expect((await owner.admin.from("linear_settings").update({ last_synced_at: "2026-10-26T12:00:00Z" }).eq("owner_id", owner.userId)).error).toBeNull();
        const synced = await owner.client.from("linear_settings").select("last_synced_at").single();
        expect(new Date(synced.data!.last_synced_at).toISOString()).toBe("2026-10-26T12:00:00.000Z");
    });

    it("enforces owner isolation for reads, inserts, updates, RPCs, and deletes", async () => {
        const owner = await user();
        const other = await user();
        expect((await owner.client.from("linear_settings").insert({ linear_token: "owner-fake-key" })).error).toBeNull();
        const hidden = await other.client.from("linear_settings").select(visibleColumns);
        expect(hidden.error).toBeNull();
        expect(hidden.data).toEqual([]);
        expect((await other.client.from("linear_settings").insert({ owner_id: owner.userId, linear_token: "spoofed-key" })).error).not.toBeNull();
        expect((await other.client.from("linear_settings").update({ team_key: "Stolen" }).eq("owner_id", owner.userId)).error).toBeNull();
        expect((await other.client.from("linear_settings").delete().eq("owner_id", owner.userId)).error).toBeNull();
        expect((await other.client.rpc("update_linear_preferences", { p_team_key: "Stolen", p_included_statuses: [] })).error?.message).toContain("LINEAR_NOT_CONFIGURED");

        expect((await other.client.rpc("save_linear_settings", { p_linear_token: "other-fake-key" })).error).toBeNull();
        expect((await other.client.from("linear_settings").update({ owner_id: owner.userId }).eq("owner_id", other.userId)).error).not.toBeNull();
        const unchanged = await owner.client.from("linear_settings").select(visibleColumns).single();
        expect(unchanged.data).toMatchObject({ owner_id: owner.userId, team_key: null, included_statuses: [] });
        expect((await owner.client.from("linear_settings").delete().eq("owner_id", owner.userId)).error).toBeNull();
        expect((await owner.client.from("linear_settings").select(visibleColumns)).data).toEqual([]);
        expect((await other.client.from("linear_settings").select("owner_id").single()).data?.owner_id).toBe(other.userId);
    });

    it.each(["last_synced_at", "updated_at"])("denies browser-authored %s on insert", async (column) => {
        const owner = await user();
        expect((await owner.client.from("linear_settings").insert({ linear_token: "fake-key", [column]: "2026-10-26T12:00:00Z" })).error?.code).toBe("42501");
    });

    it("rejects blank keys and clearly reports a pasted Bearer prefix", async () => {
        const owner = await user();
        for (const token of [null, "", "   ", "Bearer fake-key", " bearer fake-key "]) {
            expect((await owner.client.rpc("save_linear_settings", { p_linear_token: token })).error?.message).toContain("LINEAR_TOKEN_INVALID");
        }
        const bearer = await owner.client.rpc("save_linear_settings", { p_linear_token: "Bearer fake-key" });
        expect(bearer.error?.message).toContain("without the Bearer prefix");
        expect((await owner.client.from("linear_settings").select(visibleColumns)).data).toEqual([]);
    });
});

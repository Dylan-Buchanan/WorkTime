import { afterEach, describe, expect, it } from "vitest";
import { createLocalUser, type LocalUser } from "../tests/supabase/localSupabase";

const users: LocalUser[] = [];

afterEach(async () => {
    await Promise.all(users.splice(0).map((user) => user.cleanup()));
});

describe("Shortcut settings storage", () => {
    it("lets an owner upsert configuration without selecting the stored token", async () => {
        const owner = await createLocalUser();
        users.push(owner);

        const saved = await owner.client.rpc("save_shortcut_settings", {
            p_shortcut_token: "shortcut-secret-token",
            p_team_name: "Data Thinkers",
            p_excluded_statuses: ["Done", "Ready for Review"],
        });
        expect(saved.error).toBeNull();

        const updated = await owner.client.rpc("save_shortcut_settings", {
            p_shortcut_token: "replacement-secret-token",
            p_team_name: "Data Thinkers",
            p_excluded_statuses: ["Done", "Ready for Review"],
        });
        expect(updated.error).toBeNull();

        const visible = await owner.client
            .from("shortcut_settings")
            .select("owner_id, team_name, excluded_statuses, last_synced_at, updated_at")
            .single();
        expect(visible.error).toBeNull();
        expect(visible.data).toMatchObject({
            owner_id: owner.userId,
            team_name: "Data Thinkers",
            excluded_statuses: ["Done", "Ready for Review"],
            last_synced_at: null,
        });

        const secretRead = await owner.client.from("shortcut_settings").select("shortcut_token");
        expect(secretRead.data).toBeNull();
        expect(secretRead.error).not.toBeNull();

        const spoofLastSync = await owner.client
            .from("shortcut_settings")
            .update({ last_synced_at: "2026-08-12T12:00:00Z" })
            .eq("owner_id", owner.userId);
        expect(spoofLastSync.error).not.toBeNull();

        const recorded = await owner.admin
            .from("shortcut_settings")
            .update({ last_synced_at: "2026-08-12T12:00:00Z" })
            .eq("owner_id", owner.userId);
        expect(recorded.error).toBeNull();
        const afterSync = await owner.client.from("shortcut_settings").select("last_synced_at").single();
        expect(afterSync.error).toBeNull();
        expect(new Date(afterSync.data!.last_synced_at).toISOString()).toBe("2026-08-12T12:00:00.000Z");
    });

    it("enforces owner isolation for reads and writes", async () => {
        const owner = await createLocalUser();
        const other = await createLocalUser();
        users.push(owner, other);

        const saved = await owner.client.from("shortcut_settings").insert({
            shortcut_token: "owner-token",
            team_name: "Owner Team",
        });
        expect(saved.error).toBeNull();

        const hidden = await other.client
            .from("shortcut_settings")
            .select("owner_id, team_name, excluded_statuses, last_synced_at, updated_at");
        expect(hidden.error).toBeNull();
        expect(hidden.data).toEqual([]);

        const spoof = await other.client.from("shortcut_settings").insert({
            owner_id: owner.userId,
            shortcut_token: "spoofed-token",
            team_name: "Spoofed Team",
        });
        expect(spoof.error).not.toBeNull();

        const attemptedDelete = await other.client.from("shortcut_settings").delete().eq("owner_id", owner.userId);
        expect(attemptedDelete.error).toBeNull();
        const ownerRow = await owner.client.from("shortcut_settings").select("owner_id, team_name").single();
        expect(ownerRow.error).toBeNull();
        expect(ownerRow.data?.team_name).toBe("Owner Team");
    });
});

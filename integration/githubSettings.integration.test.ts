import { afterEach, describe, expect, it } from "vitest";
import { createLocalUser, type LocalUser } from "../tests/supabase/localSupabase";

const users: LocalUser[] = [];

afterEach(async () => {
    await Promise.all(users.splice(0).map((user) => user.cleanup()));
});

describe("GitHub settings storage", () => {
    it("lets an owner upsert settings without selecting the stored token", async () => {
        const owner = await createLocalUser();
        users.push(owner);

        const saved = await owner.client.rpc("save_github_settings", {
            p_token: "github-secret-token",
            p_github_username: "octocat",
        });
        expect(saved.error).toBeNull();

        const replaced = await owner.client.rpc("save_github_settings", {
            p_token: "replacement-secret-token",
            p_github_username: "monalisa",
        });
        expect(replaced.error).toBeNull();

        const visible = await owner.client
            .from("github_settings")
            .select("owner_id, github_username, last_synced_at, updated_at")
            .single();
        expect(visible.error).toBeNull();
        expect(visible.data).toMatchObject({
            owner_id: owner.userId,
            github_username: "monalisa",
            last_synced_at: null,
        });

        const secretRead = await owner.client.from("github_settings").select("token");
        expect(secretRead.data).toBeNull();
        expect(secretRead.error).not.toBeNull();

        const adminSecret = await owner.admin
            .from("github_settings")
            .select("token")
            .eq("owner_id", owner.userId)
            .single();
        expect(adminSecret.error).toBeNull();
        expect(adminSecret.data?.token).toBe("replacement-secret-token");

        const spoofLastSync = await owner.client
            .from("github_settings")
            .update({ last_synced_at: "2026-08-31T12:00:00Z" })
            .eq("owner_id", owner.userId);
        expect(spoofLastSync.error).not.toBeNull();

        const recorded = await owner.admin
            .from("github_settings")
            .update({ last_synced_at: "2026-08-31T12:00:00Z" })
            .eq("owner_id", owner.userId);
        expect(recorded.error).toBeNull();

        const afterSync = await owner.client.from("github_settings").select("last_synced_at").single();
        expect(afterSync.error).toBeNull();
        expect(new Date(afterSync.data!.last_synced_at).toISOString()).toBe("2026-08-31T12:00:00.000Z");
    });

    it("updates repository preferences without changing server metadata", async () => {
        const owner = await createLocalUser();
        users.push(owner);

        expect((await owner.client.rpc("save_github_settings", {
            p_token: "github-secret-token",
            p_github_username: "octocat",
        })).error).toBeNull();
        expect((await owner.admin.from("github_repos").insert({
            owner_id: owner.userId,
            full_name: "acme/worktime",
            is_stale: true,
        })).error).toBeNull();

        const updated = await owner.client.rpc("update_github_repo_preferences", {
            p_full_name: "acme/worktime",
            p_selected: false,
            p_project_id: " project-alpha ",
            p_label_filter: " bug ",
            p_include_closed: true,
        });
        expect(updated.error).toBeNull();

        const visible = await owner.client.from("github_repos").select("*").single();
        expect(visible.error).toBeNull();
        expect(visible.data).toMatchObject({
            owner_id: owner.userId,
            full_name: "acme/worktime",
            selected: false,
            project_id: "project-alpha",
            label_filter: "bug",
            include_closed: true,
            is_stale: true,
        });

        const cleared = await owner.client.rpc("update_github_repo_preferences", {
            p_full_name: "acme/worktime",
            p_selected: true,
            p_project_id: "   ",
            p_label_filter: "",
            p_include_closed: false,
        });
        expect(cleared.error).toBeNull();

        const normalized = await owner.client
            .from("github_repos")
            .select("selected, project_id, label_filter, include_closed, is_stale")
            .single();
        expect(normalized.data).toEqual({
            selected: true,
            project_id: null,
            label_filter: null,
            include_closed: false,
            is_stale: true,
        });

        const spoofStale = await owner.client
            .from("github_repos")
            .update({ is_stale: false })
            .eq("full_name", "acme/worktime");
        expect(spoofStale.error).not.toBeNull();
    });

    it("enforces repository identity constraints", async () => {
        const owner = await createLocalUser();
        users.push(owner);

        expect((await owner.client.rpc("save_github_settings", {
            p_token: "github-secret-token",
            p_github_username: "octocat",
        })).error).toBeNull();

        for (const fullName of ["worktime", "/worktime", "acme/", "acme/work/time", "acme/work time"]) {
            const invalid = await owner.admin.from("github_repos").insert({
                owner_id: owner.userId,
                full_name: fullName,
            });
            expect(invalid.error, fullName).not.toBeNull();
        }

        const first = await owner.admin.from("github_repos").insert({
            owner_id: owner.userId,
            full_name: "acme/worktime",
        });
        expect(first.error).toBeNull();
        const duplicate = await owner.admin.from("github_repos").insert({
            owner_id: owner.userId,
            full_name: "acme/worktime",
        });
        expect(duplicate.error).not.toBeNull();
    });

    it("rejects invalid settings and repository preference arguments", async () => {
        const owner = await createLocalUser();
        users.push(owner);

        const missingToken = await owner.client.rpc("save_github_settings", {
            p_token: "   ",
            p_github_username: "octocat",
        });
        expect(missingToken.error?.message).toContain("GITHUB_TOKEN_REQUIRED");
        const missingUsername = await owner.client.rpc("save_github_settings", {
            p_token: "github-secret-token",
            p_github_username: "",
        });
        expect(missingUsername.error?.message).toContain("GITHUB_USERNAME_REQUIRED");

        expect((await owner.client.rpc("save_github_settings", {
            p_token: "github-secret-token",
            p_github_username: "octocat",
        })).error).toBeNull();
        expect((await owner.admin.from("github_repos").insert({
            owner_id: owner.userId,
            full_name: "acme/worktime",
        })).error).toBeNull();

        const invalidName = await owner.client.rpc("update_github_repo_preferences", {
            p_full_name: "worktime",
            p_selected: true,
            p_project_id: null,
            p_label_filter: null,
            p_include_closed: false,
        });
        expect(invalidName.error?.message).toContain("GITHUB_REPO_INVALID");
        const missingBoolean = await owner.client.rpc("update_github_repo_preferences", {
            p_full_name: "acme/worktime",
            p_selected: null,
            p_project_id: null,
            p_label_filter: null,
            p_include_closed: false,
        });
        expect(missingBoolean.error?.message).toContain("GITHUB_REPO_PREFERENCES_INVALID");
    });

    it("enforces owner isolation and cascades repository cleanup", async () => {
        const owner = await createLocalUser();
        const other = await createLocalUser();
        users.push(owner, other);

        expect((await owner.client.rpc("save_github_settings", {
            p_token: "owner-token",
            p_github_username: "owner-name",
        })).error).toBeNull();
        expect((await owner.admin.from("github_repos").insert({
            owner_id: owner.userId,
            full_name: "acme/worktime",
        })).error).toBeNull();

        const hiddenSettings = await other.client
            .from("github_settings")
            .select("owner_id, github_username, last_synced_at, updated_at");
        expect(hiddenSettings.error).toBeNull();
        expect(hiddenSettings.data).toEqual([]);
        const hiddenRepos = await other.client.from("github_repos").select("*");
        expect(hiddenRepos.error).toBeNull();
        expect(hiddenRepos.data).toEqual([]);

        const spoofSettings = await other.client.from("github_settings").insert({
            owner_id: owner.userId,
            token: "spoofed-token",
            github_username: "spoofed-name",
        });
        expect(spoofSettings.error).not.toBeNull();
        const spoofRepo = await other.client.from("github_repos").insert({
            owner_id: owner.userId,
            full_name: "acme/spoofed",
        });
        expect(spoofRepo.error).not.toBeNull();

        expect((await other.client
            .from("github_repos")
            .update({ selected: false })
            .eq("owner_id", owner.userId)).error).toBeNull();
        expect((await other.client
            .from("github_settings")
            .update({ github_username: "taken-over" })
            .eq("owner_id", owner.userId)).error).toBeNull();
        expect((await other.client
            .from("github_settings")
            .delete()
            .eq("owner_id", owner.userId)).error).toBeNull();
        expect((await other.client
            .from("github_repos")
            .delete()
            .eq("owner_id", owner.userId)).error).toBeNull();

        const ownerRepo = await owner.client.from("github_repos").select("selected").single();
        expect(ownerRepo.error).toBeNull();
        expect(ownerRepo.data?.selected).toBe(true);
        const ownerSettings = await owner.client.from("github_settings").select("github_username").single();
        expect(ownerSettings.error).toBeNull();
        expect(ownerSettings.data?.github_username).toBe("owner-name");

        const disconnected = await owner.client
            .from("github_settings")
            .delete()
            .eq("owner_id", owner.userId);
        expect(disconnected.error).toBeNull();
        const orphaned = await owner.admin
            .from("github_repos")
            .select("owner_id")
            .eq("owner_id", owner.userId);
        expect(orphaned.error).toBeNull();
        expect(orphaned.data).toEqual([]);
    });

    it("reports missing connection and repository boundaries", async () => {
        const owner = await createLocalUser();
        users.push(owner);

        const notConfigured = await owner.client.rpc("update_github_repo_preferences", {
            p_full_name: "acme/worktime",
            p_selected: true,
            p_project_id: null,
            p_label_filter: null,
            p_include_closed: false,
        });
        expect(notConfigured.error?.message).toContain("GITHUB_NOT_CONFIGURED");

        expect((await owner.client.rpc("save_github_settings", {
            p_token: "github-secret-token",
            p_github_username: "octocat",
        })).error).toBeNull();
        const repoMissing = await owner.client.rpc("update_github_repo_preferences", {
            p_full_name: "acme/worktime",
            p_selected: true,
            p_project_id: null,
            p_label_filter: null,
            p_include_closed: false,
        });
        expect(repoMissing.error?.message).toContain("GITHUB_REPO_NOT_FOUND");
    });
});

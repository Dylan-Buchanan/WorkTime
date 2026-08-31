import { describe, expect, it } from "vitest";
import { githubRepoUpserts, reconcileGitHubRepos } from "./reconcile.ts";

describe("reconcileGitHubRepos", () => {
    it("separates seeded, current, reappearing, and missing repositories", () => {
        expect(reconcileGitHubRepos([
            { full_name: "acme/current", is_stale: false },
            { full_name: "acme/returned", is_stale: true },
            { full_name: "acme/missing", is_stale: false },
        ], ["acme/current", "acme/returned", "acme/new"])).toEqual({
            seeded: ["acme/new"],
            reappearing: ["acme/returned"],
            current: ["acme/current"],
            missing: ["acme/missing"],
        });
    });

    it("marks every stored row missing for an empty GitHub listing", () => {
        expect(reconcileGitHubRepos([
            { full_name: "acme/one", is_stale: false },
            { full_name: "acme/two", is_stale: true },
        ], [])).toMatchObject({
            seeded: [],
            reappearing: [],
            current: [],
            missing: ["acme/one", "acme/two"],
        });
    });

    it("builds upserts that un-stale rows without overwriting preferences", () => {
        expect(githubRepoUpserts("owner-1", ["acme/repo", "acme/repo"])).toEqual([{
            owner_id: "owner-1",
            full_name: "acme/repo",
            is_stale: false,
        }]);
        expect(Object.keys(githubRepoUpserts("owner-1", ["acme/repo"])[0])).not.toContain("selected");
        expect(Object.keys(githubRepoUpserts("owner-1", ["acme/repo"])[0])).not.toContain("project_id");
    });
});

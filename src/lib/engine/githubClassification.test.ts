import { describe, expect, it } from "vitest";
import type { PMTask } from "../../state/types";
import {
    buildGithubTaskProposal,
    classifyGithubIssues,
    normalizeGithubIssueUrl,
    type GithubIssuePayload,
} from "./githubClassification";

function task(id: string, links: string[] = []): PMTask {
    return {
        id,
        title: id,
        projectId: null,
        status: "Backlog",
        priority: "Medium",
        timeSpentMinutes: 0,
        tags: [],
        links,
        checklist: [],
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
        relatedTo: [],
    };
}

function issue(number: number, overrides: Partial<GithubIssuePayload> = {}): GithubIssuePayload {
    return {
        number,
        title: `Issue ${number}`,
        html_url: `https://github.com/dylan/worktime/issues/${number}`,
        state: "open",
        closed: false,
        labels: [],
        ...overrides,
    };
}

describe("github issue classification", () => {
    it("normalizes surrounding whitespace and trailing slashes only", () => {
        expect(normalizeGithubIssueUrl("  https://github.com/dylan/worktime/issues/42///  ")).toBe("https://github.com/dylan/worktime/issues/42");
        expect(normalizeGithubIssueUrl("https://github.com/dylan/worktime/issues/42/?tab=comments/")).toBe("https://github.com/dylan/worktime/issues/42?tab=comments/");
    });

    it("builds a description-free proposal tagged with the repo full name", () => {
        const result = buildGithubTaskProposal(
            issue(7, { title: "Fix sync", html_url: "https://github.com/dylan/worktime/issues/7" }),
            "project-1",
            "dylan/worktime",
        );

        expect(result).toEqual({
            title: "Fix sync",
            projectId: "project-1",
            status: "Backlog",
            priority: "Medium",
            description: "",
            tags: ["dylan/worktime"],
            links: ["https://github.com/dylan/worktime/issues/7"],
            checklist: [],
            relatedTo: [],
        });
        expect(result).not.toHaveProperty("dueDate");
        expect(result).not.toHaveProperty("estimatePomos");
    });

    it("defaults the proposal to an unassigned project", () => {
        const result = buildGithubTaskProposal(issue(8), null, "dylan/worktime");

        expect(result.projectId).toBeNull();
        expect(result.tags).toEqual(["dylan/worktime"]);
    });

    it("matches an issue against every link on every current task", () => {
        const result = classifyGithubIssues({
            issues: [issue(42, { html_url: " https://github.com/dylan/worktime/issues/42/ " })],
            currentTasks: [
                task("unrelated", ["https://example.test/task"]),
                task("linked", ["https://another.test", "https://github.com/dylan/worktime/issues/42"]),
            ],
            repoName: "dylan/worktime",
            defaultProjectId: "project-1",
            includeClosed: false,
        });

        expect(result).toEqual({
            proposals: [],
            counts: { new: 0, skippedAlreadyAdded: 1, skippedClosed: 0, skippedLabelNotIncluded: 0 },
        });
    });

    it("skips duplicates within a single batch", () => {
        const result = classifyGithubIssues({
            issues: [
                issue(42),
                issue(42, { html_url: "https://github.com/dylan/worktime/issues/42/" }),
            ],
            currentTasks: [],
            repoName: "dylan/worktime",
            defaultProjectId: null,
            includeClosed: false,
        });

        expect(result.proposals).toHaveLength(1);
        expect(result.counts).toEqual({
            new: 1,
            skippedAlreadyAdded: 1,
            skippedClosed: 0,
            skippedLabelNotIncluded: 0,
        });
    });

    it("skips closed issues when includeClosed is false", () => {
        const result = classifyGithubIssues(
            [
                issue(1),
                issue(2, { state: "closed", closed: true }),
                issue(3, { state: "closed", closed: false }),
            ],
            [],
            "dylan/worktime",
            "project-1",
            false,
        );

        expect(result.proposals).toHaveLength(1);
        expect(result.proposals[0].title).toBe("Issue 1");
        expect(result.proposals[0].projectId).toBe("project-1");
        expect(result.counts).toEqual({
            new: 1,
            skippedAlreadyAdded: 0,
            skippedClosed: 2,
            skippedLabelNotIncluded: 0,
        });
    });

    it("classifies closed issues when includeClosed is true", () => {
        const result = classifyGithubIssues({
            issues: [issue(2, { state: "closed", closed: true })],
            currentTasks: [],
            repoName: "dylan/worktime",
            defaultProjectId: null,
            includeClosed: true,
        });

        expect(result.counts).toEqual({
            new: 1,
            skippedAlreadyAdded: 0,
            skippedClosed: 0,
            skippedLabelNotIncluded: 0,
        });
    });

    it("skips issues without the applied label filter", () => {
        const result = classifyGithubIssues({
            issues: [
                issue(1, { labels: [{ name: "bug" }] }),
                issue(2, { labels: [{ name: "enhancement" }] }),
                issue(3),
            ],
            currentTasks: [],
            repoName: "dylan/worktime",
            defaultProjectId: "project-1",
            includeClosed: false,
            labelFilter: "bug",
        });

        expect(result.proposals).toHaveLength(1);
        expect(result.proposals[0].title).toBe("Issue 1");
        expect(result.counts).toEqual({
            new: 1,
            skippedAlreadyAdded: 0,
            skippedClosed: 0,
            skippedLabelNotIncluded: 2,
        });
    });

    it("does not label-filter when no filter is applied", () => {
        const result = classifyGithubIssues({
            issues: [issue(1, { labels: [{ name: "enhancement" }] })],
            currentTasks: [],
            repoName: "dylan/worktime",
            defaultProjectId: null,
            includeClosed: false,
            labelFilter: null,
        });

        expect(result.counts.new).toBe(1);
        expect(result.counts.skippedLabelNotIncluded).toBe(0);
    });

    it("propagates the repo default project to every proposal", () => {
        const result = classifyGithubIssues({
            issues: [issue(1), issue(2)],
            currentTasks: [],
            repoName: "dylan/worktime",
            defaultProjectId: "project-9",
            includeClosed: false,
        });

        expect(result.proposals.map((proposal) => proposal.projectId)).toEqual(["project-9", "project-9"]);
        expect(result.proposals.every((proposal) => proposal.tags.includes("dylan/worktime"))).toBe(true);
    });

    it("returns an empty result for a zero-issue batch", () => {
        const result = classifyGithubIssues({
            issues: [],
            currentTasks: [task("existing", ["https://github.com/dylan/worktime/issues/1"])],
            repoName: "dylan/worktime",
            defaultProjectId: "project-1",
            includeClosed: false,
        });

        expect(result).toEqual({
            proposals: [],
            counts: { new: 0, skippedAlreadyAdded: 0, skippedClosed: 0, skippedLabelNotIncluded: 0 },
        });
    });
});

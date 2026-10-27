import { describe, expect, it } from "vitest";
import type { PMTask } from "../../state/types";
import {
    buildLinearTaskProposal,
    classifyLinearIssues,
    describeLinearEmptyResult,
    linearIssueTag,
    linearPriorityToTaskPriority,
    normalizeLinearUrl,
    type LinearIssuePayload,
} from "./linearClassification";

function task(id: string, overrides: Partial<PMTask> = {}): PMTask {
    return {
        id,
        title: id,
        projectId: null,
        status: "Backlog",
        priority: "Medium",
        timeSpentMinutes: 0,
        tags: [],
        links: [],
        checklist: [],
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
        relatedTo: [],
        ...overrides,
    };
}

function issue(identifier: string, overrides: Partial<LinearIssuePayload> = {}): LinearIssuePayload {
    return {
        id: `id-${identifier}`,
        identifier,
        title: `Issue ${identifier}`,
        description: `Description ${identifier}`,
        url: `https://linear.app/worktime/issue/${identifier}/original-slug`,
        dueDate: "2026-08-20",
        priority: 2,
        state: { name: "In Progress" },
        ...overrides,
    };
}

describe("linear issue classification", () => {
    it("normalizes whitespace, trailing slashes and the presentation slug", () => {
        expect(normalizeLinearUrl("  https://linear.app/worktime/issue/ENG-123/ship-it/  "))
            .toBe("https://linear.app/worktime/issue/ENG-123");
        expect(normalizeLinearUrl("https://linear.app/worktime/issue/ENG-123"))
            .toBe("https://linear.app/worktime/issue/ENG-123");
        expect(normalizeLinearUrl("https://linear.app/worktime/issue/ENG-123/ship-it?view=full"))
            .toBe("https://linear.app/worktime/issue/ENG-123?view=full");
        expect(normalizeLinearUrl("https://linear.app/worktime/issue/ENG-123/ship-it"))
            .not.toBe(normalizeLinearUrl("https://linear.app/worktime/issue/ENG-124/ship-it"));
    });

    it("deduplicates by the identifier tag before comparing URLs", () => {
        const result = classifyLinearIssues({
            issues: [issue("ENG-123", { url: "https://linear.app/worktime/issue/ENG-123/new-slug" })],
            currentTasks: [task("imported", { tags: ["linear:ENG-123"], links: ["https://example.test/unrelated"] })],
            includedStatuses: ["In Progress"],
            defaultProjectId: "project-1",
        });

        expect(result.proposals).toEqual([]);
        expect(result.counts).toEqual({ new: 0, skippedAlreadyAdded: 1, skippedStatusNotIncluded: 0 });
    });

    it("deduplicates by URL when the slug changed and the tag is missing", () => {
        const result = classifyLinearIssues({
            issues: [issue("ENG-123")],
            currentTasks: [task("imported", {
                links: [" https://linear.app/worktime/issue/ENG-123/old-slug/ "],
            })],
            includedStatuses: ["In Progress"],
            defaultProjectId: null,
        });

        expect(result.proposals).toEqual([]);
        expect(result.counts).toEqual({ new: 0, skippedAlreadyAdded: 1, skippedStatusNotIncluded: 0 });
    });

    it("prefers already-added over status exclusion and counts every skip reason", () => {
        const result = classifyLinearIssues({
            issues: [
                issue("ENG-1"),
                issue("ENG-2", { url: "https://linear.app/worktime/issue/ENG-2/a", state: { name: "Done" } }),
                issue("ENG-3", { url: "https://linear.app/worktime/issue/ENG-3/a" }),
            ],
            currentTasks: [task("imported", { tags: [linearIssueTag("ENG-1")] })],
            includedStatuses: ["In Progress"],
            defaultProjectId: "project-1",
        });

        expect(result.proposals).toHaveLength(1);
        expect(result.proposals[0].title).toBe("Issue ENG-3");
        expect(result.proposals[0].projectId).toBe("project-1");
        expect(result.totalIssues).toBe(3);
        expect(result.counts).toEqual({ new: 1, skippedAlreadyAdded: 1, skippedStatusNotIncluded: 1 });
    });

    it("deduplicates identical issues inside one batch", () => {
        const result = classifyLinearIssues({
            issues: [issue("ENG-123"), issue("ENG-123", { url: "https://linear.app/worktime/issue/ENG-123/other-slug" })],
            currentTasks: [],
            includedStatuses: ["In Progress"],
            defaultProjectId: null,
        });

        expect(result.proposals).toHaveLength(1);
        expect(result.counts).toEqual({ new: 1, skippedAlreadyAdded: 1, skippedStatusNotIncluded: 0 });
    });

    it.each([
        [0, "Medium"],
        [1, "High"],
        [2, "High"],
        [3, "Medium"],
        [4, "Low"],
    ] as const)("maps Linear priority %i to %s", (priority, expected) => {
        expect(linearPriorityToTaskPriority(priority)).toBe(expected);
        expect(buildLinearTaskProposal(issue("ENG-1", { priority })).priority).toBe(expected);
    });

    it("falls back to Medium for an out-of-range priority", () => {
        expect(linearPriorityToTaskPriority(9)).toBe("Medium");
    });

    it("builds a Backlog proposal with a tag-first identity and no estimate", () => {
        const proposal = buildLinearTaskProposal(issue("ENG-123", {
            title: "Ship the import",
            description: "Review the Linear slice.",
            dueDate: "2026-09-01T00:00:00Z",
            priority: 4,
            url: "https://linear.app/worktime/issue/ENG-123/ship-the-import",
        }), "project-2");

        expect(proposal).toEqual({
            title: "Ship the import",
            projectId: "project-2",
            status: "Backlog",
            priority: "Low",
            dueDate: "2026-09-01",
            description: "Review the Linear slice.",
            tags: ["linear:ENG-123"],
            links: ["https://linear.app/worktime/issue/ENG-123/ship-the-import"],
            checklist: [],
            relatedTo: [],
        });
        expect(proposal).not.toHaveProperty("estimatePomos");
    });

    it("omits a null or malformed due date", () => {
        expect(buildLinearTaskProposal(issue("ENG-1", { dueDate: null }))).not.toHaveProperty("dueDate");
        expect(buildLinearTaskProposal(issue("ENG-1", { dueDate: "not-a-date" }))).not.toHaveProperty("dueDate");
    });

    it("derives the three empty-result messages from the payload size and counters", () => {
        const empty = (counts: { skippedAlreadyAdded: number; skippedStatusNotIncluded: number }, totalIssues: number) => ({
            proposals: [],
            counts: { new: 0, ...counts },
            totalIssues,
        });

        expect(describeLinearEmptyResult(empty({ skippedAlreadyAdded: 0, skippedStatusNotIncluded: 0 }, 0)))
            .toBe("No Linear issues are assigned to you in this sync's scope.");
        expect(describeLinearEmptyResult(empty({ skippedAlreadyAdded: 0, skippedStatusNotIncluded: 4 }, 4)))
            .toBe("No assigned issues matched your included statuses.");
        expect(describeLinearEmptyResult(empty({ skippedAlreadyAdded: 4, skippedStatusNotIncluded: 0 }, 4)))
            .toBe("Every assigned issue was already imported.");
        expect(describeLinearEmptyResult(empty({ skippedAlreadyAdded: 2, skippedStatusNotIncluded: 2 }, 4)))
            .toBe("Every assigned issue was either already imported or excluded by your included statuses.");
    });

    it("returns no empty-result message when there are proposals", () => {
        expect(describeLinearEmptyResult({
            proposals: [buildLinearTaskProposal(issue("ENG-1"))],
            counts: { new: 1, skippedAlreadyAdded: 0, skippedStatusNotIncluded: 0 },
            totalIssues: 1,
        })).toBeNull();
    });
});

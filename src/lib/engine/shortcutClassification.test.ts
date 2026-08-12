import { describe, expect, it } from "vitest";
import type { PMTask } from "../../state/types";
import {
    buildShortcutTaskProposal,
    classifyShortcutStories,
    normalizeShortcutUrl,
    type ShortcutStoryPayload,
} from "./shortcutClassification";

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

function story(id: number, overrides: Partial<ShortcutStoryPayload> = {}): ShortcutStoryPayload {
    return {
        id,
        app_url: `https://app.shortcut.com/worktime/story/${id}`,
        name: `Story ${id}`,
        description: `Description ${id}`,
        estimate: 3,
        deadline: "2026-08-20",
        workflow_state_id: 1,
        status_name: "In Development",
        completed: false,
        archived: false,
        story_type: "feature",
        labels: [],
        ...overrides,
    };
}

describe("shortcut story classification", () => {
    it("normalizes surrounding whitespace and trailing slashes only", () => {
        expect(normalizeShortcutUrl("  https://shortcut.test/story/42///  ")).toBe("https://shortcut.test/story/42");
        expect(normalizeShortcutUrl("https://shortcut.test/story/42/?view=full/")).toBe("https://shortcut.test/story/42?view=full/");
    });

    it("matches a story against every link on every current task", () => {
        const result = classifyShortcutStories({
            stories: [story(42, { app_url: " https://app.shortcut.com/worktime/story/42/ " })],
            currentTasks: [task("unrelated", ["https://example.test/task"]), task("linked", ["https://another.test", "https://app.shortcut.com/worktime/story/42"])],
            excludedStatuses: [],
        });

        expect(result).toEqual({
            proposals: [],
            counts: { new: 0, skippedAlreadyAdded: 1, skippedStatusExcluded: 0, skippedArchived: 0 },
        });
    });

    it("classifies excluded and archived stories and returns partitioned counts", () => {
        const result = classifyShortcutStories(
            [
                story(1),
                story(2, { status_name: "Done" }),
                story(3, { archived: true }),
                story(4, { app_url: "https://app.shortcut.com/worktime/story/linked" }),
            ],
            [task("existing", ["https://app.shortcut.com/worktime/story/linked/"])],
            ["Done", "Ready for Review"],
        );

        expect(result.proposals).toHaveLength(1);
        expect(result.proposals[0].title).toBe("Story 1");
        expect(result.counts).toEqual({
            new: 1,
            skippedAlreadyAdded: 1,
            skippedStatusExcluded: 1,
            skippedArchived: 1,
        });
    });

    it("maps nullable Shortcut fields and story type to an unassigned proposal", () => {
        const result = buildShortcutTaskProposal(story(7, {
            name: "Fix import",
            description: "Investigate the import failure.",
            estimate: null,
            deadline: null,
            story_type: "bug",
            app_url: "https://app.shortcut.com/worktime/story/7",
        }));

        expect(result).toEqual({
            title: "Fix import",
            projectId: null,
            status: "Backlog",
            priority: "Medium",
            description: "Investigate the import failure.",
            tags: ["bug"],
            links: ["https://app.shortcut.com/worktime/story/7"],
            checklist: [],
            relatedTo: [],
        });
    });

    it("maps estimate and deadline when Shortcut provides them", () => {
        const result = buildShortcutTaskProposal(story(8, { estimate: 5, deadline: "2026-09-01" }));

        expect(result).toMatchObject({ estimatePomos: 5, dueDate: "2026-09-01" });
    });
});

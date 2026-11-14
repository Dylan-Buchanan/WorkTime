import { describe, expect, it } from "vitest";
import type { Goal } from "../../state/types";
import { buildGoalFixture, buildGoalTrackerFixture } from "./testFixtures";
import { resolveGoalProject } from "./projectLink";

describe("resolveGoalProject", () => {
    it("returns an explicit goal project with source override", () => {
        const goal = buildGoalFixture({ projectLink: { mode: "project", projectId: "project-goal" } });
        const tracker = buildGoalTrackerFixture({ projectId: "project-tracker" });

        expect(resolveGoalProject(goal, tracker)).toEqual({ projectId: "project-goal", source: "override" });
    });

    it("keeps an explicit goal project even when the tracker has none", () => {
        const goal = buildGoalFixture({ projectLink: { mode: "project", projectId: "project-goal" } });

        expect(resolveGoalProject(goal, buildGoalTrackerFixture({ projectId: null }))).toEqual({
            projectId: "project-goal",
            source: "override",
        });
    });

    it("inherits the tracker project", () => {
        const goal = buildGoalFixture({ projectLink: { mode: "inherit" } });
        const tracker = buildGoalTrackerFixture({ projectId: "project-tracker" });

        expect(resolveGoalProject(goal, tracker)).toEqual({ projectId: "project-tracker", source: "inherit" });
    });

    it("inherits null when the tracker has no project", () => {
        const goal = buildGoalFixture({ projectLink: { mode: "inherit" } });

        expect(resolveGoalProject(goal, buildGoalTrackerFixture({ projectId: null }))).toEqual({
            projectId: null,
            source: "inherit",
        });
    });

    it("treats a project-less tracker half-state as null", () => {
        const goal = buildGoalFixture({ projectLink: { mode: "inherit" } });
        const tracker = { ...buildGoalTrackerFixture(), projectId: undefined } as unknown as Parameters<typeof resolveGoalProject>[1];

        expect(resolveGoalProject(goal, tracker)).toEqual({ projectId: null, source: "inherit" });
    });

    it("returns no project for an explicit no-project goal regardless of the tracker", () => {
        const goal = buildGoalFixture({ projectLink: { mode: "none" } });

        expect(resolveGoalProject(goal, buildGoalTrackerFixture({ projectId: "project-tracker" }))).toEqual({
            projectId: null,
            source: "none",
        });
        expect(resolveGoalProject(goal, buildGoalTrackerFixture({ projectId: null }))).toEqual({
            projectId: null,
            source: "none",
        });
    });

    it("rejects an explicit link half-state without a project id", () => {
        const goal = { ...buildGoalFixture(), projectLink: { mode: "project" } as unknown as Goal["projectLink"] };

        expect(() => resolveGoalProject(goal, buildGoalTrackerFixture())).toThrow(RangeError);
    });

    it("rejects an unknown link mode", () => {
        const goal = { ...buildGoalFixture(), projectLink: { mode: "bogus" } as unknown as Goal["projectLink"] };

        expect(() => resolveGoalProject(goal, buildGoalTrackerFixture())).toThrow(RangeError);
    });
});

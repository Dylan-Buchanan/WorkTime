import type { Goal, GoalTracker } from "../../state/types";

export type GoalProjectSource = "inherit" | "override" | "none";

export interface ResolvedGoalProject {
    readonly projectId: string | null;
    readonly source: GoalProjectSource;
}

/** One copy of the dangling-link note, shared by every project display surface. */
export const MISSING_PROJECT_LABEL = "Linked project is missing";

/** A tracker half-state stored without an id is deliberately project-less. */
export function resolveTrackerProjectId(tracker: GoalTracker): string | null {
    const { projectId } = tracker;
    return typeof projectId === "string" && projectId.trim() !== "" ? projectId : null;
}

/**
 * The one place a goal's effective project is decided. An explicit link always
 * wins, an inheriting goal reads its tracker's project, and a no-project goal is
 * deliberately project-less. Ids are not validated against PM state here, so a
 * dangling link stays distinguishable from an unlinked goal.
 */
export function resolveGoalProject(goal: Goal, tracker: GoalTracker): ResolvedGoalProject {
    switch (goal.projectLink.mode) {
        case "project": {
            const { projectId } = goal.projectLink;
            if (typeof projectId !== "string" || projectId.trim() === "") {
                throw new RangeError("Goal project link is missing a project id");
            }
            return { projectId, source: "override" };
        }
        case "inherit":
            return { projectId: resolveTrackerProjectId(tracker), source: "inherit" };
        case "none":
            return { projectId: null, source: "none" };
        default: {
            // Reachable only through a malformed stored row; validators reject it.
            const unreachable: never = goal.projectLink;
            throw new RangeError(`Unknown goal project link: ${JSON.stringify(unreachable)}`);
        }
    }
}

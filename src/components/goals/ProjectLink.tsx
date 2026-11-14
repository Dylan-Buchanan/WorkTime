import React from "react";
import { usePM } from "../../state/ProjectManagerContext";
import { MISSING_PROJECT_LABEL } from "../../lib/goals/projectLink";

/**
 * The one place a linked project's identity is rendered.
 * A stored id that no longer resolves is a quiet dangling note, never an error;
 * archived projects still resolve because they stay in PM state.
 */
export const ProjectLink: React.FC<{ projectId: string }> = ({ projectId }) => {
    const pm = usePM();
    const project = pm.state.projects[projectId];
    return project
        ? <span className="text-xs text-neutral-400">{project.name}</span>
        : <span className="text-xs text-neutral-500">{MISSING_PROJECT_LABEL}</span>;
};

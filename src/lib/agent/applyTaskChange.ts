import type { TaskChange } from "../engine/diffEngine";
import type { PMTask } from "../../state/types";

export interface TaskChangeMutations {
    createTask: (title: string, opts?: Partial<PMTask>) => Promise<PMTask>;
    updateTask: (id: string, patch: Partial<PMTask>) => void;
    archiveTask: (id: string, archive?: boolean) => void;
    reorderTasks: (idsInOrder: string[]) => void;
}

function proposedTaskPatch(change: TaskChange, fallbackProjectId: string): Partial<PMTask> {
    if (!change.after) throw new Error(`${change.type} change is missing its proposed task`);
    const after = change.after;
    return {
        title: after.title,
        projectId: after.projectId === undefined ? fallbackProjectId : after.projectId,
        status: after.status,
        priority: after.priority,
        dueDate: after.dueDate,
        estimatePomos: after.estimatePomos,
        description: after.description,
        checklist: after.checklist.map((item) => ({ ...item })),
        relatedTo: [...after.relatedTo],
    };
}

/** Apply one reviewed diff through the normal ProjectManager mutation surface. */
export async function applyTaskChange(
    change: TaskChange,
    projectId: string,
    mutations: TaskChangeMutations,
): Promise<{ createdTaskId?: string }> {
    if (change.blocked) throw new Error("Blocked agent changes cannot be approved");

    switch (change.type) {
        case "create":
        case "split": {
            const patch = proposedTaskPatch(change, projectId);
            const created = await mutations.createTask(change.after!.title, patch);
            return { createdTaskId: created.id };
        }
        case "update": {
            if (!change.taskId) throw new Error("Update change is missing a task ID");
            mutations.updateTask(change.taskId, proposedTaskPatch(change, projectId));
            return {};
        }
        case "remove": {
            if (!change.taskId) throw new Error("Remove change is missing a task ID");
            mutations.archiveTask(change.taskId);
            return {};
        }
        case "reorder": {
            if (!change.afterTaskIds) throw new Error("Reorder change is missing its target order");
            mutations.reorderTasks([...change.afterTaskIds]);
            return {};
        }
    }
}

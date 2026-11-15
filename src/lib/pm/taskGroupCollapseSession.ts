/**
 * Surface-local Timer page task-group collapse state.
 *
 * This is a plain in-memory store: which project groups are collapsed survives
 * route navigation because the authenticated shell stays mounted, but it is
 * discarded on reload and never written to `localStorage`, `Settings`, or the
 * staging store.
 *
 * Keys are timer page group keys: a project id, or `"__no_project__"` for the
 * synthetic unassigned bucket. Unknown/absent keys render expanded.
 */
export type TaskGroupCollapseMap = Record<string, boolean>;

type TaskGroupCollapseSessionListener = () => void;

let collapsedGroups: TaskGroupCollapseMap = {};
const listeners = new Set<TaskGroupCollapseSessionListener>();

function publish(): void {
    listeners.forEach((listener) => listener());
}

export function getCollapsedTaskGroups(): TaskGroupCollapseMap {
    return collapsedGroups;
}

/** Flips one group key and publishes the new map to subscribers. */
export function toggleTaskGroupCollapsed(groupKey: string): TaskGroupCollapseMap {
    collapsedGroups = {
        ...collapsedGroups,
        [groupKey]: !collapsedGroups[groupKey],
    };
    publish();
    return collapsedGroups;
}

export function subscribeToTaskGroupCollapseSession(listener: TaskGroupCollapseSessionListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Clears every group back to expanded and publishes once. */
export function resetTaskGroupCollapseSession(): void {
    collapsedGroups = {};
    publish();
}

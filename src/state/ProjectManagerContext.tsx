import React, {
    createContext,
    useContext,
    useState,
    useCallback,
    useEffect,
} from "react";
import {
    ProjectManagerState,
    Project,
    PMTask,
    TaskPriority,
    TaskStatus,
} from "./types";

// LocalStorage key
const LS_KEY = "pm_state_v1";

function now() {
    return new Date().toISOString();
}
function uuid() {
    try {
        // Browser / secure context
        return (
            (crypto as any)?.randomUUID?.() ||
            // Fallback simple uuid v4-ish
            "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
                const r = (Math.random() * 16) | 0;
                const v = c === "x" ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            })
        );
    } catch {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
}

function buildDefaultState(): ProjectManagerState {
    const projectId = uuid();
    const project: Project = {
        id: projectId,
        name: "General",
        color: randomColor(),
        description: "",
        isArchived: false,
        sortOrder: 0,
        createdAt: now(),
        updatedAt: now(),
    };
    return {
        projects: { [projectId]: project },
        tasks: {},
        ui: {
            selectedProjectIds: [projectId],
            selectedTaskId: null,
            view: "list",
            listGrouping: "none",
            statusFilter: [],
            tagFilter: [],
            priorityFilter: [],
            search: "",
            showArchived: false,
            sort: "manual",
            dueFilter: "all",
        },
        meta: { initializedAt: now() },
    };
}
const defaultState: ProjectManagerState = buildDefaultState();

interface PMContextShape {
    state: ProjectManagerState;
    createProject: (name: string, color?: string) => void;
    updateProject: (id: string, patch: Partial<Project>) => void;
    archiveProject: (id: string, archive?: boolean) => void;
    deleteProject: (id: string) => void;
    createTask: (title: string, opts?: Partial<PMTask>) => PMTask;
    updateTask: (id: string, patch: Partial<PMTask>) => void;
    archiveTask: (id: string, archive?: boolean) => void;
    setSelectedTask: (id: string | null) => void;
    reorderTasks: (idsInOrder: string[], withinStatus?: TaskStatus) => void;
    moveTaskToStatus: (id: string, status: TaskStatus, index?: number) => void;
    quickAddParse: (input: string) => {
        task: Partial<PMTask>;
        projectName?: string;
    };
    ensureProjectByName: (name: string) => Project;
    setView: (v: "list" | "board") => void;
    setListGrouping: (g: ProjectManagerState["ui"]["listGrouping"]) => void;
    setFilters: (patch: Partial<ProjectManagerState["ui"]>) => void;
}

const PMContext = createContext<PMContextShape | undefined>(undefined);

export const ProjectManagerProvider: React.FC<{
    children: React.ReactNode;
}> = ({ children }) => {
    const [state, setState] = useState<ProjectManagerState>(() => {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                const parsed: ProjectManagerState = JSON.parse(raw);
                // Migrations / ensure at least one project
                if (Object.keys(parsed.projects).length === 0) {
                    return buildDefaultState();
                }
                // If no selected project, select first
                if (parsed.ui.selectedProjectIds.length === 0) {
                    const first = Object.keys(parsed.projects)[0];
                    parsed.ui.selectedProjectIds = first ? [first] : [];
                }
                return parsed;
            }
        } catch {}
        return defaultState;
    });

    const persist = useCallback(
        (
            next:
                | ProjectManagerState
                | ((prev: ProjectManagerState) => ProjectManagerState)
        ) => {
            setState((prev) => {
                const resolved =
                    typeof next === "function" ? (next as any)(prev) : next;
                try {
                    localStorage.setItem(LS_KEY, JSON.stringify(resolved));
                } catch {}
                return resolved;
            });
        },
        []
    );

    const createProject = (name: string, color?: string) => {
        const id = uuid();
        const project: Project = {
            id,
            name,
            color: color || randomColor(),
            description: "",
            isArchived: false,
            sortOrder: Object.keys(state.projects).length,
            createdAt: now(),
            updatedAt: now(),
        };
        persist((prev) => ({
            ...prev,
            projects: { ...prev.projects, [id]: project },
            ui: {
                ...prev.ui,
                selectedProjectIds:
                    prev.ui.selectedProjectIds.length === 0
                        ? [id]
                        : prev.ui.selectedProjectIds,
            },
        }));
    };
    const updateProject = (id: string, patch: Partial<Project>) => {
        const p = state.projects[id];
        if (!p) return;
        const upd: Project = { ...p, ...patch, updatedAt: now() };
        persist((prev) => ({
            ...prev,
            projects: { ...prev.projects, [id]: upd },
        }));
    };
    const archiveProject = (id: string, archive: boolean = true) =>
        updateProject(id, { isArchived: archive });
    const deleteProject = (id: string) => {
        persist((prev) => {
            if (!prev.projects[id]) return prev;
            const { [id]: _removed, ...restProjects } = prev.projects;
            const tasks = { ...prev.tasks };
            Object.values(tasks).forEach((t) => {
                if (t.projectId === id) t.projectId = null;
            });
            // Adjust selection
            let selected = prev.ui.selectedProjectIds.filter(
                (pid) => pid !== id
            );
            if (selected.length === 0) {
                const firstRemaining = Object.keys(restProjects)[0];
                if (firstRemaining) selected = [firstRemaining];
            }
            return {
                ...prev,
                projects: restProjects,
                tasks,
                ui: { ...prev.ui, selectedProjectIds: selected },
            };
        });
    };

    const createTask = (title: string, opts: Partial<PMTask> = {}): PMTask => {
        const id = uuid();
        let projectId = opts.projectId ?? null;
        if (!projectId && state.ui.selectedProjectIds.length === 1) {
            projectId = state.ui.selectedProjectIds[0];
        }
        // Fallback: assign first available project if still null
        if (!projectId) {
            const first = Object.keys(state.projects)[0];
            if (first) projectId = first;
        }
        if (!projectId) {
            // As a last resort create a General project
            const gen = Object.values(state.projects).find(
                (p) => p.name === "General"
            );
            if (gen) projectId = gen.id;
            else {
                const tempId = uuid();
                const project: Project = {
                    id: tempId,
                    name: "General",
                    color: randomColor(),
                    description: "",
                    isArchived: false,
                    sortOrder: Object.keys(state.projects).length,
                    createdAt: now(),
                    updatedAt: now(),
                };
                const withProject: ProjectManagerState = {
                    ...state,
                    projects: { ...state.projects, [tempId]: project },
                    ui: { ...state.ui, selectedProjectIds: [tempId] },
                };
                persist(withProject);
                projectId = tempId;
            }
        }
        const task: PMTask = {
            id,
            title,
            projectId,
            status: opts.status || "Backlog",
            priority: opts.priority || "Medium",
            dueDate: opts.dueDate,
            estimatePomos: (opts as any).estimatePomos || undefined,
            timeSpentMinutes: opts.timeSpentMinutes || 0,
            workedPomos: 0,
            lastWorkedAt: opts.lastWorkedAt,
            description: opts.description || "",
            tags: opts.tags || [],
            links: opts.links || [],
            checklist: opts.checklist || [],
            sortOrder: Object.values(state.tasks).filter(
                (t) => t.status === (opts.status || "Backlog")
            ).length,
            isArchived: false,
            createdAt: now(),
            updatedAt: now(),
            appTaskId: (opts as any).appTaskId,
        };
        persist((prev) => {
            const next = { ...prev, tasks: { ...prev.tasks, [id]: task } };
            try {
                console.log("[PM] createTask", {
                    id,
                    title,
                    projectId,
                    totalTasksBefore: Object.keys(prev.tasks).length,
                    totalTasksAfter: Object.keys(next.tasks).length,
                });
            } catch {}
            return next;
        });
        return task;
    };
    const updateTask = (id: string, patch: Partial<PMTask>) => {
        const t = state.tasks[id];
        if (!t) return;
        const upd: PMTask = { ...t, ...patch, updatedAt: now() };
        persist((prev) => ({
            ...prev,
            tasks: { ...prev.tasks, [id]: upd },
        }));
    };
    const archiveTask = (id: string, archive: boolean = true) =>
        updateTask(id, { isArchived: archive });
    const setSelectedTask = (id: string | null) =>
        persist((prev) => ({
            ...prev,
            ui: { ...prev.ui, selectedTaskId: id },
        }));
    const reorderTasks = (idsInOrder: string[], withinStatus?: TaskStatus) => {
        persist((prev) => {
            const tasks = { ...prev.tasks };
            idsInOrder.forEach((id, idx) => {
                const t = tasks[id];
                if (!t) return;
                if (withinStatus && t.status !== withinStatus) return;
                t.sortOrder = idx;
                t.updatedAt = now();
            });
            return { ...prev, tasks };
        });
    };
    const moveTaskToStatus = (
        id: string,
        status: TaskStatus,
        index?: number
    ) => {
        const t = state.tasks[id];
        if (!t) return;
        const siblings = Object.values(state.tasks)
            .filter((s) => s.status === status && s.id !== id)
            .sort((a, b) => a.sortOrder - b.sortOrder);
        if (index === undefined || index < 0 || index > siblings.length)
            index = siblings.length;
        siblings.splice(index, 0, t);
        siblings.forEach((s, i) => (s.sortOrder = i));
        persist((prev) => ({
            ...prev,
            tasks: {
                ...prev.tasks,
                [id]: { ...prev.tasks[id], status, updatedAt: now() },
            },
        }));
    };

    const listProjectByName = (name: string) =>
        Object.values(state.projects).find(
            (p) => p.name.toLowerCase() === name.toLowerCase()
        );
    const ensureProjectByName = (name: string) => {
        const existing = listProjectByName(name);
        if (existing) return existing;
        createProject(name);
        return listProjectByName(name)!;
    };

    const quickAddParse = (input: string) => {
        const parts = input.trim().split(/\s+/);
        const task: Partial<PMTask> = { tags: [] };
        let titleParts: string[] = [];
        let projectName: string | undefined;
        parts.forEach((p) => {
            if (p.startsWith("@")) {
                projectName = p.substring(1);
            } else if (p.startsWith("^")) {
                const d = p.substring(1);
                if (/\d{4}-\d{2}-\d{2}/.test(d)) task.dueDate = d;
            } else if (p.startsWith("#")) {
                const tag = p.substring(1);
                if (tag) (task.tags ||= []).push(tag);
            } else if (p.startsWith("!")) {
                const pri = p.substring(1).toLowerCase();
                if (pri === "low" || pri === "medium" || pri === "high")
                    task.priority = (pri.charAt(0).toUpperCase() +
                        pri.slice(1)) as TaskPriority;
            } else if (/^\d+p$/.test(p)) {
                // e.g. 3p means 3 pomodoros estimate
                const n = parseInt(p);
                if (!isNaN(n)) (task as any).estimatePomos = n;
            } else {
                titleParts.push(p);
            }
        });
        task.title = titleParts.join(" ");
        return { task, projectName };
    };

    const setView = (v: "list" | "board") =>
        persist((prev) => ({
            ...prev,
            ui: { ...prev.ui, view: v },
        }));
    const setListGrouping = (g: ProjectManagerState["ui"]["listGrouping"]) =>
        persist((prev) => ({
            ...prev,
            ui: { ...prev.ui, listGrouping: g },
        }));
    const setFilters = (patch: Partial<ProjectManagerState["ui"]>) =>
        persist((prev) => ({
            ...prev,
            ui: { ...prev.ui, ...patch },
        }));

    // Expose & log each render (development aid)
    useEffect(() => {
        (globalThis as any).__PM__ = {
            get state() {
                return state;
            },
            createTask,
            createProject,
        };
        console.log("[PM] provider render", {
            projects: Object.keys(state.projects).length,
            tasks: Object.keys(state.tasks).length,
            selected: state.ui.selectedProjectIds,
        });
    });

    return (
        <PMContext.Provider
            value={{
                state,
                createProject,
                updateProject,
                archiveProject,
                deleteProject,
                createTask,
                updateTask,
                archiveTask,
                setSelectedTask,
                reorderTasks,
                moveTaskToStatus,
                quickAddParse,
                ensureProjectByName,
                setView,
                setListGrouping,
                setFilters,
            }}
        >
            {children}
        </PMContext.Provider>
    );
};

export const usePM = () => {
    const ctx = useContext(PMContext);
    if (!ctx) throw new Error("usePM must be inside provider");
    return ctx;
};

function randomColor() {
    const colors = [
        "#6366F1",
        "#EC4899",
        "#10B981",
        "#F59E0B",
        "#3B82F6",
        "#8B5CF6",
        "#EF4444",
        "#14B8A6",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

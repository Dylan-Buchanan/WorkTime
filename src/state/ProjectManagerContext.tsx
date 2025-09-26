import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ProjectManagerState, Project, PMTask, TaskPriority, TaskStatus } from "./types";
import { useAppState } from "./AppStateContext";

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
            boardShowAllTasks: false,
        },
        meta: { initializedAt: now() },
    };
}

interface PMContextShape {
    state: ProjectManagerState;
    createProject: (name: string, color?: string) => Project;
    updateProject: (id: string, patch: Partial<Project>) => void;
    archiveProject: (id: string, archive?: boolean) => void;
    deleteProject: (id: string) => void;
    createTask: (title: string, opts?: Partial<PMTask>) => Promise<PMTask>;
    ensureMetadataForAppTask: (appTaskId: string, meta: { title: string; estimatePomos?: number }) => PMTask;
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
    resetPM: () => void;
}

const PMContext = createContext<PMContextShape | undefined>(undefined);

export const ProjectManagerProvider: React.FC<{
    children: React.ReactNode;
}> = ({ children }) => {
    const app = useAppState();
    const isTauri = Boolean((import.meta as any)?.env?.TAURI_PLATFORM || (typeof window !== "undefined" && (window as any).__TAURI_IPC__));
    const hasLocalStorage = typeof window !== "undefined" && typeof window.localStorage !== "undefined";
    const isDevBuild = Boolean(import.meta.env.DEV);
    const [state, setState] = useState<ProjectManagerState>(() => buildDefaultState());
    const [hydrated, setHydrated] = useState(false);
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

    const persistSnapshot = useCallback(
        (snapshot: ProjectManagerState, options?: { immediate?: boolean }) => {
            if (isTauri) {
                const payload = JSON.parse(JSON.stringify(snapshot)) as ProjectManagerState;
                if (options?.immediate) {
                    return invoke("save_pm_state", { state: payload })
                        .then(() => undefined)
                        .catch((err) => {
                            console.warn("[PM] failed to persist project manager state", err);
                        });
                }
                saveQueueRef.current = saveQueueRef.current
                    .catch(() => undefined)
                    .then(() => invoke("save_pm_state", { state: payload }))
                    .then(
                        () => undefined,
                        (err) => {
                            console.warn("[PM] failed to persist project manager state", err);
                        }
                    );
                return saveQueueRef.current;
            }

            if (hasLocalStorage) {
                try {
                    window.localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
                } catch (err) {
                    console.warn("[PM] failed to save project manager state to localStorage", err);
                }
            }

            return Promise.resolve();
        },
        [isTauri, hasLocalStorage]
    );

    useEffect(() => {
        let cancelled = false;
        (async () => {
            let snapshot: ProjectManagerState | null = null;

            if (isTauri) {
                try {
                    const loaded = await invoke<ProjectManagerState | null>("load_pm_state");
                    if (loaded) {
                        snapshot = normalizeState(loaded);
                    }
                } catch (err) {
                    console.warn("[PM] failed to load project manager state from filesystem", err);
                }
            }

            if (!snapshot) {
                if (isTauri) {
                    if (!isDevBuild && hasLocalStorage) {
                        try {
                            const raw = window.localStorage.getItem(LS_KEY);
                            if (raw) {
                                snapshot = normalizeState(JSON.parse(raw) as ProjectManagerState);
                            }
                        } catch (err) {
                            console.warn("[PM] failed to parse legacy localStorage project state", err);
                        }
                    }
                } else if (hasLocalStorage) {
                    try {
                        const raw = window.localStorage.getItem(LS_KEY);
                        if (raw) {
                            snapshot = normalizeState(JSON.parse(raw) as ProjectManagerState);
                        }
                    } catch (err) {
                        console.warn("[PM] failed to parse browser localStorage project state", err);
                    }
                }
            }

            const finalSnapshot = snapshot ?? normalizeState(buildDefaultState());

            if (!cancelled) {
                setState(finalSnapshot);
                setHydrated(true);
                await persistSnapshot(finalSnapshot, { immediate: true });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [hasLocalStorage, isTauri, persistSnapshot]);

    useEffect(() => {
        if (!hydrated) return;
        persistSnapshot(state);
    }, [state, hydrated, persistSnapshot]);

    const persist = useCallback((next: ProjectManagerState | ((prev: ProjectManagerState) => ProjectManagerState)) => {
        setState((prev) => (typeof next === "function" ? (next as any)(prev) : next));
    }, []);

    const createProject = (name: string, color?: string): Project => {
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
                selectedProjectIds: prev.ui.selectedProjectIds.length === 0 ? [id] : prev.ui.selectedProjectIds,
            },
        }));
        return project;
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
    const archiveProject = (id: string, archive: boolean = true) => updateProject(id, { isArchived: archive });
    const deleteProject = (id: string) => {
        persist((prev) => {
            if (!prev.projects[id]) return prev;
            const { [id]: _removed, ...restProjects } = prev.projects;
            const tasks = { ...prev.tasks };
            Object.values(tasks).forEach((t) => {
                if (t.projectId === id) t.projectId = null;
            });
            // Adjust selection
            let selected = prev.ui.selectedProjectIds.filter((pid) => pid !== id);
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

    const createTaskLocal = (title: string, opts: Partial<PMTask> = {}, options: { id?: string } = {}): PMTask => {
        let projectId = opts.projectId ?? null;
        if (projectId && !state.projects[projectId]) {
            projectId = null;
        }
        if (!projectId && state.ui.selectedProjectIds.length === 1) {
            const selected = state.ui.selectedProjectIds[0];
            if (selected && state.projects[selected]) {
                projectId = selected;
            }
        }
        if (!projectId) {
            const first = Object.keys(state.projects)[0];
            if (first) projectId = first;
        }
        if (!projectId) {
            const gen = Object.values(state.projects).find((p) => p.name === "General");
            if (gen) projectId = gen.id;
            else {
                projectId = createProject("General").id;
            }
        }

        const id = options.id || uuid();
        const status = opts.status || "Backlog";
        let created: PMTask | null = null;
        persist((prev) => {
            const sortOrder = Object.values(prev.tasks).filter((t) => t.status === status).length;
            const task: PMTask = {
                id,
                title,
                projectId,
                status,
                priority: opts.priority || "Medium",
                dueDate: opts.dueDate,
                estimatePomos: (opts as any).estimatePomos !== undefined ? (opts as any).estimatePomos : undefined,
                timeSpentMinutes: opts.timeSpentMinutes || 0,
                workedPomos: opts.workedPomos || 0,
                lastWorkedAt: opts.lastWorkedAt,
                description: opts.description || "",
                tags: opts.tags || [],
                links: opts.links || [],
                checklist: opts.checklist || [],
                sortOrder,
                isArchived: opts.isArchived ?? false,
                createdAt: now(),
                updatedAt: now(),
                appTaskId: (opts as any).appTaskId,
            };
            created = task;
            const next = {
                ...prev,
                tasks: { ...prev.tasks, [id]: task },
            };
            try {
                console.log("[PM] createTaskLocal", {
                    id,
                    title,
                    projectId,
                    status,
                    totalTasksBefore: Object.keys(prev.tasks).length,
                    totalTasksAfter: Object.keys(next.tasks).length,
                });
            } catch {}
            return next;
        });
        return created!;
    };

    const createTask = async (title: string, opts: Partial<PMTask> = {}): Promise<PMTask> => {
        const activeBefore = app.state?.active_task;
        let target = (opts as any).estimatePomos as number | undefined;
        if (target === undefined && typeof opts.timeSpentMinutes === "number" && opts.timeSpentMinutes > 0) {
            const workLength = app.state?.settings.work_minutes || 25;
            target = Math.max(1, Math.round(opts.timeSpentMinutes / workLength));
        }
        if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) {
            target = 1;
        }
        const created = await app.createTask(title, Math.max(1, Math.floor(target)));
        if (activeBefore && activeBefore !== created.id) {
            try {
                await app.setActiveTask(activeBefore);
            } catch {}
        }
        return createTaskLocal(title, {
            ...opts,
            estimatePomos: (opts as any).estimatePomos !== undefined ? (opts as any).estimatePomos : created.target_pomodoros,
            appTaskId: created.id,
        });
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
    const ensureMetadataForAppTask = (appTaskId: string, meta: { title: string; estimatePomos?: number }): PMTask => {
        let existing = Object.values(state.tasks).find((t) => t.appTaskId === appTaskId);
        if (!existing) {
            return createTaskLocal(meta.title || "Untitled", {
                estimatePomos: meta.estimatePomos,
                appTaskId,
            });
        }
        const patch: Partial<PMTask> = {};
        if (meta.title && existing.title !== meta.title) {
            patch.title = meta.title;
        }
        if (meta.estimatePomos !== undefined && meta.estimatePomos !== existing.estimatePomos) {
            patch.estimatePomos = meta.estimatePomos;
        }
        if (Object.keys(patch).length > 0) {
            updateTask(existing.id, patch);
            existing = { ...existing, ...patch };
        }
        return existing;
    };
    const archiveTask = (id: string, archive: boolean = true) => updateTask(id, { isArchived: archive });
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
    const moveTaskToStatus = (id: string, status: TaskStatus, index?: number) => {
        const t = state.tasks[id];
        if (!t) return;
        const siblings = Object.values(state.tasks)
            .filter((s) => s.status === status && s.id !== id)
            .sort((a, b) => a.sortOrder - b.sortOrder);
        if (index === undefined || index < 0 || index > siblings.length) index = siblings.length;
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

    const listProjectByName = (name: string) => Object.values(state.projects).find((p) => p.name.toLowerCase() === name.toLowerCase());
    const ensureProjectByName = (name: string) => {
        const existing = listProjectByName(name);
        if (existing) return existing;
        return createProject(name);
    };

    const quickAddParse = (input: string) => {
        const parts = input.trim().split(/\s+/).filter(Boolean);
        const task: Partial<PMTask> = { tags: [] };
        const titleParts: string[] = [];
        let projectName: string | undefined;

        const isCommandToken = (token: string) => {
            if (!token) return false;
            return token.startsWith("@") || token.startsWith("^") || token.startsWith("#") || token.startsWith("!") || /^\d+p$/i.test(token);
        };

        for (let i = 0; i < parts.length; i++) {
            const token = parts[i];
            if (!token) continue;

            if (token.startsWith("@")) {
                const initial = token.substring(1);
                const collected: string[] = [];
                if (initial) collected.push(initial);
                while (i + 1 < parts.length && !isCommandToken(parts[i + 1])) {
                    collected.push(parts[i + 1]);
                    i += 1;
                }
                const candidate = collected.join(" ").trim();
                if (candidate.length > 0) {
                    projectName = candidate;
                }
                continue;
            }

            if (token.startsWith("^")) {
                const d = token.substring(1);
                if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
                    task.dueDate = d;
                }
                continue;
            }

            if (token.startsWith("#")) {
                const tag = token.substring(1);
                if (tag) {
                    (task.tags ||= []).push(tag);
                }
                continue;
            }

            if (token.startsWith("!")) {
                const pri = token.substring(1).toLowerCase();
                if (pri === "low" || pri === "medium" || pri === "high") {
                    task.priority = (pri.charAt(0).toUpperCase() + pri.slice(1)) as TaskPriority;
                }
                continue;
            }

            if (/^(\d+)(p)$/i.test(token)) {
                const n = parseInt(token, 10);
                if (!Number.isNaN(n)) {
                    (task as any).estimatePomos = n;
                }
                continue;
            }

            titleParts.push(token);
        }

        task.title = titleParts.join(" ").trim();
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

    const resetPM = () => {
        persist(() => buildDefaultState());
    };

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
                ensureMetadataForAppTask,
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
                resetPM,
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

function normalizeState(input?: ProjectManagerState | null): ProjectManagerState {
    const base = buildDefaultState();
    const sourceProjects = input?.projects && Object.keys(input.projects).length > 0 ? input.projects : base.projects;

    const projects: Record<string, Project> = {};
    Object.entries(sourceProjects).forEach(([id, project]) => {
        const createdAt = typeof project.createdAt === "string" && project.createdAt.length > 0 ? project.createdAt : now();
        const updatedAt = typeof project.updatedAt === "string" && project.updatedAt.length > 0 ? project.updatedAt : createdAt;
        projects[id] = {
            ...project,
            name: project.name || "Untitled",
            color: project.color || randomColor(),
            description: project.description ?? "",
            isArchived: Boolean(project.isArchived),
            sortOrder: typeof project.sortOrder === "number" && Number.isFinite(project.sortOrder) ? project.sortOrder : 0,
            createdAt,
            updatedAt,
        };
    });

    const tasks: Record<string, PMTask> = {};
    const validStatuses: TaskStatus[] = ["Backlog", "Next", "In Progress", "Blocked", "Done"];
    const validPriorities: TaskPriority[] = ["Low", "Medium", "High"];
    if (input?.tasks) {
        Object.entries(input.tasks).forEach(([id, task]) => {
            const status: TaskStatus = validStatuses.includes(task.status as TaskStatus) ? (task.status as TaskStatus) : "Backlog";
            const priority: TaskPriority = validPriorities.includes(task.priority as TaskPriority) ? (task.priority as TaskPriority) : "Medium";
            const projectId = task.projectId && projects[task.projectId] ? task.projectId : null;
            const tags = Array.isArray(task.tags) ? task.tags.filter((tag): tag is string => typeof tag === "string") : [];
            const links = Array.isArray(task.links) ? task.links.filter((link): link is string => typeof link === "string") : [];
            const checklist = Array.isArray(task.checklist)
                ? task.checklist.map((item) => ({
                      id: item.id || uuid(),
                      title: item.title || "",
                      done: Boolean(item.done),
                  }))
                : [];
            const sortOrder = typeof task.sortOrder === "number" && Number.isFinite(task.sortOrder) ? task.sortOrder : 0;
            const timeSpentMinutes = typeof task.timeSpentMinutes === "number" && Number.isFinite(task.timeSpentMinutes) ? task.timeSpentMinutes : 0;
            const createdAt = typeof task.createdAt === "string" && task.createdAt.length > 0 ? task.createdAt : now();
            const updatedAt = typeof task.updatedAt === "string" && task.updatedAt.length > 0 ? task.updatedAt : createdAt;

            tasks[id] = {
                ...task,
                projectId,
                status,
                priority,
                tags,
                links,
                checklist,
                sortOrder,
                isArchived: Boolean(task.isArchived),
                timeSpentMinutes,
                createdAt,
                updatedAt,
            };
        });
    }

    const validViews = ["list", "board"] as const;
    const validGroupings = ["none", "project", "status", "due"] as const;
    const validSorts = ["manual", "due", "priority", "updated"] as const;
    const validDueFilters = ["all", "today", "thisWeek", "later", "overdue"] as const;

    const uiSource: Partial<ProjectManagerState["ui"]> = input?.ui ?? {};
    const selectedProjectIds = Array.isArray(uiSource.selectedProjectIds) ? uiSource.selectedProjectIds.filter((id): id is string => typeof id === "string" && !!projects[id]) : [];
    const statusFilter = Array.isArray(uiSource.statusFilter) ? uiSource.statusFilter.filter((status): status is TaskStatus => validStatuses.includes(status as TaskStatus)) : [];
    const tagFilter = Array.isArray(uiSource.tagFilter) ? uiSource.tagFilter.filter((tag): tag is string => typeof tag === "string") : [];
    const priorityFilter = Array.isArray(uiSource.priorityFilter) ? uiSource.priorityFilter.filter((priority): priority is TaskPriority => validPriorities.includes(priority as TaskPriority)) : [];
    const search = typeof uiSource.search === "string" ? uiSource.search : "";
    const resolvedView: "list" | "board" = validViews.includes(uiSource.view as (typeof validViews)[number]) ? (uiSource.view as unknown as "list" | "board") : "list";
    const resolvedGrouping: ProjectManagerState["ui"]["listGrouping"] = validGroupings.includes(uiSource.listGrouping as (typeof validGroupings)[number])
        ? (uiSource.listGrouping as unknown as ProjectManagerState["ui"]["listGrouping"])
        : "none";
    const resolvedSort: ProjectManagerState["ui"]["sort"] = validSorts.includes(uiSource.sort as (typeof validSorts)[number])
        ? (uiSource.sort as unknown as ProjectManagerState["ui"]["sort"])
        : "manual";
    const resolvedDueFilter: ProjectManagerState["ui"]["dueFilter"] = validDueFilters.includes(uiSource.dueFilter as (typeof validDueFilters)[number])
        ? (uiSource.dueFilter as unknown as ProjectManagerState["ui"]["dueFilter"])
        : "all";
    const selectedTaskId = typeof uiSource.selectedTaskId === "string" && uiSource.selectedTaskId.length > 0 ? uiSource.selectedTaskId : null;
    const boardShowAllTasks = Boolean((uiSource as any).boardShowAllTasks);

    const ui: ProjectManagerState["ui"] = {
        ...base.ui,
        ...uiSource,
        selectedProjectIds,
        statusFilter,
        tagFilter,
        priorityFilter,
        search,
        showArchived: Boolean(uiSource.showArchived),
        view: resolvedView,
        listGrouping: resolvedGrouping,
        sort: resolvedSort,
        dueFilter: resolvedDueFilter,
        selectedTaskId,
        boardShowAllTasks,
    };

    if (ui.selectedProjectIds.length === 0) {
        const first = Object.keys(projects)[0];
        if (first) {
            ui.selectedProjectIds = [first];
        }
    }

    const meta = {
        ...base.meta,
        ...(input?.meta ?? {}),
    };
    meta.initializedAt = typeof meta.initializedAt === "string" && meta.initializedAt.length > 0 ? meta.initializedAt : now();

    return {
        projects,
        tasks,
        ui,
        meta,
    };
}

function randomColor() {
    const colors = ["#6366F1", "#EC4899", "#10B981", "#F59E0B", "#3B82F6", "#8B5CF6", "#EF4444", "#14B8A6"];
    return colors[Math.floor(Math.random() * colors.length)];
}

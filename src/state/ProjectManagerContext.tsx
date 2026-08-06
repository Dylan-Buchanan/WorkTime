import React, { createContext, useContext, useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { ProjectManagerState, Project, PMTask, TaskPriority, TaskStatus } from "./types";
import { useAppState } from "./AppStateContext";
import { useData } from "./DataContext";
import { useSync } from "./SyncContext";
import type { SyncedPMState } from "../lib/data/DataAccess";
import {
    clearAgentProjectSnapshot,
    getAgentProjectSnapshot,
    planAgentSnapshotRevert,
    saveAgentProjectSnapshot,
} from "../lib/agent/snapshotStore";
import type { AgentProjectSnapshot, AgentSnapshotConflict } from "../lib/agent/snapshotStore";

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

export type AgentSnapshotRevertResult =
    | { status: "no-snapshot" }
    | { status: "project-missing"; projectId: string }
    | { status: "conflicts"; snapshot: AgentProjectSnapshot; conflicts: AgentSnapshotConflict[]; confirmationToken: string }
    | { status: "reverted"; snapshot: AgentProjectSnapshot; conflicts: AgentSnapshotConflict[]; restoredTaskIds: string[]; archivedTaskIds: string[] };

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
    refreshPM: () => Promise<void>;
    captureAgentSnapshot: (projectId?: string) => AgentProjectSnapshot | null;
    getAgentSnapshot: () => AgentProjectSnapshot | null;
    clearAgentSnapshot: () => void;
    revertAgentSnapshot: (confirmationToken?: string) => AgentSnapshotRevertResult;
}

const PMContext = createContext<PMContextShape | undefined>(undefined);

/**
 * Parse a "quick add" input line into a partial PM task and optional project name.
 * Syntax: `title @project ^2024-01-01 #tag !high 3p`
 */
export function quickAddParse(input: string): { task: Partial<PMTask>; projectName?: string } {
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
}

export const ProjectManagerProvider: React.FC<{
    children: React.ReactNode;
}> = ({ children }) => {
    const app = useAppState();
    const data = useData();
    // SyncProvider owns the single sync action, the bootstrap guard, and the
    // focus/visibility/pagehide lifecycle triggers. `initialized` gates the
    // save effect (no PM stage before the first successful pull), `revision`
    // drives staged PM reloads, and `sync` is the only remote write path.
    const { initialized, revision, sync } = useSync();
    const hasLocalStorage = (() => {
        try { return typeof window !== "undefined" && typeof window.localStorage !== "undefined"; } catch { return false; }
    })();
    const [state, setState] = useState<ProjectManagerState>(() => buildDefaultState());
    const [hydrated, setHydrated] = useState(false);
    const lastServerSerializedRef = useRef<string | null>(null);
    const pendingServerSerializedRef = useRef<string | null>(null);
    const suppressServerSaveRef = useRef(false);
    // Serialized staged PM slice the last time a reload applied it. A reload
    // only applies when the staged slice actually changed (a sync or cross-tab
    // write); when it is unchanged, the local view may hold a newer edit that
    // has not been staged yet, and reloading the stale snapshot would clobber it.
    const lastReloadedPmRef = useRef<string | null>(null);
    // Latest UI snapshot for the staged reload. Reading from a ref avoids
    // re-running the reload effect every time `applyServerState` rebuilds the
    // `ui` object reference on a reload.
    const uiRef = useRef(state.ui);
    const stateRef = useRef(state);
    // Written from a layout effect (not the render body) so a discarded render
    // under concurrent React can never leak a `ui` object that was never
    // committed into the ref.
    useLayoutEffect(() => {
        uiRef.current = state.ui;
        stateRef.current = state;
    }, [state]);

    const serverSlice = useCallback((input: ProjectManagerState | SyncedPMState): SyncedPMState => JSON.parse(JSON.stringify({ projects: input.projects, tasks: input.tasks, meta: input.meta })) as SyncedPMState, []);
    const applyServerState = useCallback((remote: SyncedPMState | null, localUI: ProjectManagerState["ui"]): ProjectManagerState => {
        const normalized = normalizeState(remote ? { ...remote, ui: buildDefaultState().ui } : null);
        // Keep device-local UI preferences but drop project references that no
        // longer exist in the freshly loaded server snapshot; otherwise a project
        // deleted on another device leaves an empty list/board. If every selection
        // is gone, fall back to the first valid project (or empty when none exist).
        let selectedProjectIds = localUI.selectedProjectIds.filter((id) => !!normalized.projects[id]);
        if (selectedProjectIds.length === 0) {
            const first = Object.keys(normalized.projects)[0];
            if (first) selectedProjectIds = [first];
        }
        return { projects: normalized.projects, tasks: normalized.tasks, meta: normalized.meta, ui: { ...localUI, selectedProjectIds, statusFilter: [...localUI.statusFilter], tagFilter: [...localUI.tagFilter], priorityFilter: [...localUI.priorityFilter] } };
    }, []);

    const readLocalUI = useCallback((): ProjectManagerState["ui"] => {
        if (!hasLocalStorage) return normalizeLocalUI(undefined);
        try {
            const raw = window.localStorage.getItem(LS_KEY);
            return normalizeLocalUI(raw ? JSON.parse(raw) : undefined);
        } catch (err) {
            console.warn("[PM] failed to parse local UI state", err);
            return normalizeLocalUI(undefined);
        }
    }, [hasLocalStorage]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const localUI = readLocalUI();
            let remote: SyncedPMState | null = null;
            try {
                remote = await data.loadPMState();
            } catch (err) {
                console.warn("[PM] failed to load project manager state", err);
            }
            if (cancelled) return;
            const finalState = applyServerState(remote, localUI);
            setState(finalState);
            setHydrated(true);
            const synced = serverSlice(finalState);
            lastServerSerializedRef.current = JSON.stringify(synced);
            suppressServerSaveRef.current = true;
            // A null remote renders the normalized default but is never staged
            // here: the bootstrap guard forbids seeding before the first pull.
            if (hasLocalStorage) {
                try { window.localStorage.setItem(LS_KEY, JSON.stringify({ ui: localUI })); } catch { /* local UI is best effort */ }
            }
        })();
        return () => { cancelled = true; };
    }, [applyServerState, data, hasLocalStorage, readLocalUI, serverSlice]);

    useEffect(() => {
        if (!hydrated || !initialized) return;
        const synced = serverSlice(state);
        const serialized = JSON.stringify(synced);
        if (suppressServerSaveRef.current && serialized === lastServerSerializedRef.current) {
            suppressServerSaveRef.current = false;
            return;
        }
        if (serialized === lastServerSerializedRef.current) return;
        if (pendingServerSerializedRef.current === serialized) return;
        pendingServerSerializedRef.current = serialized;
        // Keep the React view ahead of the staged copy until the write really
        // succeeds. A later revision then retries this exact snapshot instead
        // of reloading stale data over an unsaved edit.
        void data.savePMState(synced).then(() => {
            if (pendingServerSerializedRef.current === serialized) {
                lastServerSerializedRef.current = serialized;
                pendingServerSerializedRef.current = null;
            }
        }).catch((err) => {
            if (pendingServerSerializedRef.current === serialized) {
                pendingServerSerializedRef.current = null;
            }
            console.warn("[PM] failed to persist project manager state", err);
        });
    }, [state, hydrated, initialized, revision, serverSlice, data]);

    useEffect(() => {
        if (!hydrated || !hasLocalStorage) return;
        try { window.localStorage.setItem(LS_KEY, JSON.stringify({ ui: state.ui })); } catch (err) { console.warn("[PM] failed to save local UI state", err); }
    }, [state.ui, hydrated, hasLocalStorage]);

    // Reloads the staged PM slice, applying the server slice while retaining the
    // device-local UI. Marks the result as suppress-once so the save effect never
    // writes this reload back to the store. A reload applies only when the staged
    // slice changed since the last reload; an unchanged staged snapshot may lag a
    // local edit that is still being persisted, so applying it would revert the
    // view (dropping a quick-add task's fields or the task itself).
    const reloadStagedPM = useCallback(async () => {
        let remote: SyncedPMState | null = null;
        try {
            remote = await data.loadPMState();
        } catch (err) {
            console.warn("[PM] failed to load project manager state", err);
        }
        const serialized = JSON.stringify(remote);
        const currentSerialized = JSON.stringify(serverSlice(stateRef.current));
        // A local save is either still in flight or failed. Do not replace the
        // newer in-memory edit with the stale staged snapshot on that revision.
        if (lastServerSerializedRef.current !== null && currentSerialized !== lastServerSerializedRef.current) return;
        // Same-tab save notifications commonly arrive before the save promise
        // resolves. Equal data needs no reload or render round-trip.
        if (serialized === currentSerialized) {
            lastReloadedPmRef.current = serialized;
            return;
        }
        if (serialized === lastReloadedPmRef.current) return;
        lastReloadedPmRef.current = serialized;
        const next = applyServerState(remote, uiRef.current);
        lastServerSerializedRef.current = JSON.stringify(serverSlice(next));
        suppressServerSaveRef.current = true;
        setState(next);
    }, [applyServerState, data, serverSlice]);

    // Every store revision (same-tab sync commit, cross-tab storage write, or a
    // local PM stage) reloads the staged PM view. SyncProvider owns focus and
    // visibility triggers, so this provider never registers its own listeners.
    useEffect(() => {
        if (!hydrated) return;
        void reloadStagedPM();
    }, [hydrated, revision, reloadStagedPM]);

    // Retained manual refresh: one sync trigger followed by the staged reload.
    const refreshPM = useCallback(async () => {
        await sync({ reason: "manual" });
        await reloadStagedPM();
    }, [sync, reloadStagedPM]);

    const persist = useCallback((next: ProjectManagerState | ((prev: ProjectManagerState) => ProjectManagerState)) => {
        setState((prev) => (typeof next === "function" ? (next as any)(prev) : next));
    }, []);

    const captureAgentSnapshot = useCallback((projectId?: string): AgentProjectSnapshot | null => {
        const current = stateRef.current;
        const selectedProjectId = projectId ?? current.ui.selectedProjectIds[0];
        if (!selectedProjectId || !current.projects[selectedProjectId]) return null;
        return saveAgentProjectSnapshot(selectedProjectId, Object.values(current.tasks));
    }, []);

    const getAgentSnapshot = useCallback(() => getAgentProjectSnapshot(), []);
    const clearAgentSnapshot = useCallback(() => clearAgentProjectSnapshot(), []);

    const revertAgentSnapshot = useCallback((confirmationToken?: string): AgentSnapshotRevertResult => {
        const snapshot = getAgentProjectSnapshot();
        if (!snapshot) return { status: "no-snapshot" };

        const current = stateRef.current;
        if (!current.projects[snapshot.projectId]) {
            return { status: "project-missing", projectId: snapshot.projectId };
        }
        const plan = planAgentSnapshotRevert(snapshot, current.tasks);
        if (plan.conflicts.length > 0 && confirmationToken !== plan.confirmationToken) {
            return {
                status: "conflicts",
                snapshot,
                conflicts: plan.conflicts,
                confirmationToken: plan.confirmationToken,
            };
        }

        if (plan.restoreTasks.length > 0 || plan.archiveTaskIds.length > 0) {
            const revertedAt = now();
            persist((prev) => {
                const tasks = { ...prev.tasks };
                for (const task of plan.restoreTasks) {
                    tasks[task.id] = { ...task, updatedAt: revertedAt };
                }
                for (const taskId of plan.archiveTaskIds) {
                    const task = tasks[taskId];
                    if (task) tasks[taskId] = { ...task, isArchived: true, updatedAt: revertedAt };
                }
                return { ...prev, tasks };
            });
        }

        return {
            status: "reverted",
            snapshot,
            conflicts: plan.conflicts,
            restoredTaskIds: plan.restoreTasks.map((task) => task.id),
            archivedTaskIds: plan.archiveTaskIds,
        };
    }, [persist]);

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
        const projectIdProvided = Object.prototype.hasOwnProperty.call(opts, "projectId");
        let projectId: string | null = null;
        if (projectIdProvided) {
            const requested = (opts as any).projectId as string | null | undefined;
            if (requested && state.projects[requested]) {
                projectId = requested;
            } else {
                projectId = null;
            }
        } else {
            const requested = opts.projectId ?? null;
            if (requested && state.projects[requested]) {
                projectId = requested;
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
        }

        const id = options.id || uuid();
        const status = opts.status || "Backlog";
        let created: PMTask | null = null;
        persist((prev) => {
            // App task creation updates AppState before this async command
            // resumes. StateSyncBridge may therefore have already created the
            // PM metadata row for the same app task. Deduplicate against the
            // latest functional-update snapshot rather than the render-time
            // `state` closure, otherwise quick add can create two PM rows.
            const linked = opts.appTaskId
                ? Object.values(prev.tasks).find((task) => task.appTaskId === opts.appTaskId)
                : undefined;
            if (linked) {
                const task: PMTask = {
                    ...linked,
                    ...opts,
                    id: linked.id,
                    title,
                    projectId,
                    updatedAt: now(),
                };
                created = task;
                return {
                    ...prev,
                    tasks: { ...prev.tasks, [linked.id]: task },
                };
            }
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
                relatedTo: (opts as any).relatedTo || [],
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
        const existing = Object.values(state.tasks).find((t) => t.appTaskId === created.id);
        if (existing) {
            const patch: Partial<PMTask> = {
                title,
                estimatePomos: (opts as any).estimatePomos !== undefined ? (opts as any).estimatePomos : created.target_pomodoros,
                appTaskId: created.id,
            };
            if (Object.prototype.hasOwnProperty.call(opts, "projectId")) {
                (patch as any).projectId = (opts as any).projectId ?? null;
            }
            if (Object.prototype.hasOwnProperty.call(opts, "priority")) {
                patch.priority = opts.priority;
            }
            if (Object.prototype.hasOwnProperty.call(opts, "status")) {
                patch.status = opts.status;
            }
            if (Object.prototype.hasOwnProperty.call(opts, "dueDate")) {
                patch.dueDate = opts.dueDate;
            }
            if (Object.prototype.hasOwnProperty.call(opts, "tags")) {
                patch.tags = opts.tags;
            }
            if (Object.prototype.hasOwnProperty.call(opts, "links")) {
                patch.links = opts.links;
            }
            if (Object.prototype.hasOwnProperty.call(opts, "checklist")) {
                patch.checklist = opts.checklist;
            }
            if (Object.prototype.hasOwnProperty.call(opts, "description")) {
                patch.description = opts.description;
            }
            if (Object.prototype.hasOwnProperty.call(opts, "timeSpentMinutes")) {
                patch.timeSpentMinutes = opts.timeSpentMinutes;
            }
            if (Object.prototype.hasOwnProperty.call(opts, "workedPomos")) {
                patch.workedPomos = opts.workedPomos;
            }
            if (Object.prototype.hasOwnProperty.call(opts, "lastWorkedAt")) {
                patch.lastWorkedAt = opts.lastWorkedAt;
            }
            updateTask(existing.id, patch);
            return { ...existing, ...patch } as PMTask;
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
                projectId: null,
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
                refreshPM,
                captureAgentSnapshot,
                getAgentSnapshot,
                clearAgentSnapshot,
                revertAgentSnapshot,
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

function record(input: unknown): Record<string, any> | null {
    return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, any> : null;
}

export function normalizeLocalUI(input: unknown): ProjectManagerState["ui"] {
    const base = buildDefaultState().ui;
    const source = record(record(input)?.ui) ?? record(input) ?? {};
    const statuses: TaskStatus[] = ["Backlog", "Next", "In Progress", "Blocked", "Done"];
    const priorities: TaskPriority[] = ["Low", "Medium", "High"];
    const views = ["list", "board"] as const;
    const groupings = ["none", "project", "status", "due"] as const;
    const sorts = ["manual", "due", "priority", "updated"] as const;
    const dueFilters = ["all", "today", "thisWeek", "later", "overdue"] as const;
    return {
        ...base,
        selectedProjectIds: Array.isArray(source.selectedProjectIds) ? source.selectedProjectIds.filter((id): id is string => typeof id === "string") : [],
        selectedTaskId: typeof source.selectedTaskId === "string" && source.selectedTaskId.length > 0 ? source.selectedTaskId : null,
        view: views.includes(source.view) ? source.view : "list",
        listGrouping: groupings.includes(source.listGrouping) ? source.listGrouping : "none",
        statusFilter: Array.isArray(source.statusFilter) ? source.statusFilter.filter((value): value is TaskStatus => statuses.includes(value)) : [],
        tagFilter: Array.isArray(source.tagFilter) ? source.tagFilter.filter((value): value is string => typeof value === "string") : [],
        priorityFilter: Array.isArray(source.priorityFilter) ? source.priorityFilter.filter((value): value is TaskPriority => priorities.includes(value)) : [],
        search: typeof source.search === "string" ? source.search : "",
        showArchived: Boolean(source.showArchived),
        sort: sorts.includes(source.sort) ? source.sort : "manual",
        dueFilter: dueFilters.includes(source.dueFilter) ? source.dueFilter : "all",
        boardShowAllTasks: Boolean(source.boardShowAllTasks),
    };
}

export function normalizeState(input?: unknown): ProjectManagerState {
    const base = buildDefaultState();
    const source = record(input) ?? {};
    const sourceProjects = record(source?.projects) && Object.keys(source.projects).length > 0 ? source.projects : base.projects;

    const projects: Record<string, Project> = {};
    Object.entries(sourceProjects as Record<string, any>).forEach(([id, project]) => {
        project = record(project) ?? {};
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
    if (record(source?.tasks)) {
        Object.entries(source.tasks as Record<string, any>).forEach(([id, task]) => {
            task = record(task) ?? {};
            const status: TaskStatus = validStatuses.includes(task.status as TaskStatus) ? (task.status as TaskStatus) : "Backlog";
            const priority: TaskPriority = validPriorities.includes(task.priority as TaskPriority) ? (task.priority as TaskPriority) : "Medium";
            const projectId = task.projectId && projects[task.projectId] ? task.projectId : null;
            const tags = Array.isArray(task.tags) ? task.tags.filter((tag: unknown): tag is string => typeof tag === "string") : [];
            const links = Array.isArray(task.links) ? task.links.filter((link: unknown): link is string => typeof link === "string") : [];
            const checklist = Array.isArray(task.checklist)
                ? task.checklist.map((item: any) => {
                      const entry = record(item) ?? {};
                      return { id: typeof entry.id === "string" && entry.id ? entry.id : uuid(), title: typeof entry.title === "string" ? entry.title : "", done: Boolean(entry.done) };
                  })
                : [];
            const sortOrder = Number.isFinite(Number((task as any).sortOrder)) ? Number((task as any).sortOrder) : 0;
            const timeSpentMinutes = Number.isFinite(Number((task as any).timeSpentMinutes)) ? Number((task as any).timeSpentMinutes) : 0;
            const workedPomos = Number.isFinite(Number((task as any).workedPomos)) ? Number((task as any).workedPomos) : 0;
            const estimatePomos = ((): number | undefined => {
                const raw = (task as any).estimatePomos;
                const n = Number(raw);
                if (!Number.isFinite(n)) return undefined;
                const v = Math.max(1, Math.round(n));
                return v;
            })();
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
                workedPomos,
                estimatePomos,
                createdAt,
                updatedAt,
                relatedTo: Array.isArray(task.relatedTo) ? task.relatedTo.filter((value: unknown): value is string => typeof value === "string") : [],
            };
        });
    }

    const validViews = ["list", "board"] as const;
    const validGroupings = ["none", "project", "status", "due"] as const;
    const validSorts = ["manual", "due", "priority", "updated"] as const;
    const validDueFilters = ["all", "today", "thisWeek", "later", "overdue"] as const;

    const uiSource: Partial<ProjectManagerState["ui"]> = record(source?.ui) as Partial<ProjectManagerState["ui"]> ?? {};
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
        ...(record(source?.meta) ?? {}),
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

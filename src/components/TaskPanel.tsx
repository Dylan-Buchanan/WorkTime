import React, { useCallback, useMemo, useState } from "react";
import { useAppState } from "../state/AppStateContext";
import { useSounds } from "../hooks/useSounds";
import { usePM } from "../state/ProjectManagerContext";
import { PMTask, TaskPriority } from "../state/types";
import { ChevronDown, ChevronRight } from "lucide-react";

export const TASK_SORT_LS_KEY = "task_panel_sort_v1";

export const TASK_SORT_OPTIONS = ["default", "project", "priority", "dueDate", "estimateAsc", "estimateDesc"] as const;
export type TaskSortOption = (typeof TASK_SORT_OPTIONS)[number];

function loadSavedTaskSort(): TaskSortOption {
    try {
        const raw = window.localStorage.getItem(TASK_SORT_LS_KEY);
        if (!raw) return "default";
        return (TASK_SORT_OPTIONS as readonly string[]).includes(raw) ? (raw as TaskSortOption) : "default";
    } catch {
        return "default";
    }
}

function saveTaskSort(value: TaskSortOption): void {
    try {
        window.localStorage.setItem(TASK_SORT_LS_KEY, value);
    } catch {
        // local UI preference is best effort
    }
}

export const TaskPanel: React.FC = () => {
    const { state, createTask, setActiveTask, finalizeTask } = useAppState();
    const { state: pmState } = usePM();
    const { play } = useSounds();
    const [name, setName] = useState("");
    const [targetInput, setTargetInput] = useState("4");
    const [sortOption, setSortOption] = useState<TaskSortOption>(loadSavedTaskSort);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const tasks = Object.values(state?.tasks || {}).filter((t) => !t.archived);

    const pmTasksByAppTaskId = useMemo(() => {
        const map: Record<string, PMTask> = {};
        Object.values(pmState.tasks || {}).forEach((pmTask) => {
            if (pmTask.appTaskId) {
                map[pmTask.appTaskId] = pmTask;
            }
        });
        return map;
    }, [pmState.tasks]);

    // Fallback mapping by normalized title for unlinked tasks,
    // so the panel reflects PM estimates even before linkage exists
    const pmTasksByTitle = useMemo(() => {
        const map: Record<string, PMTask> = {};
        Object.values(pmState.tasks || {})
            .filter((pm) => !pm.isArchived)
            .forEach((pm) => {
                const key = pm.title?.trim().toLowerCase();
                if (!key) return;
                // Prefer tasks with appTaskId linkage if duplicates exist; otherwise keep the first seen
                const existing = map[key];
                if (!existing) {
                    map[key] = pm;
                } else if (!existing.appTaskId && pm.appTaskId) {
                    map[key] = pm;
                } else if (!existing.appTaskId && !pm.appTaskId) {
                    // If both unlinked, prefer the most recently updated
                    const a = new Date(existing.updatedAt).getTime();
                    const b = new Date(pm.updatedAt).getTime();
                    if (b > a) map[key] = pm;
                }
            });
        return map;
    }, [pmState.tasks]);

    const PRIORITY_ORDER: Record<TaskPriority, number> = {
        High: 0,
        Medium: 1,
        Low: 2,
    };

    const decoratedTasks = useMemo(() => {
        return tasks.map((task, index) => {
            const pmTask = pmTasksByAppTaskId[task.id] || pmTasksByTitle[task.name?.trim().toLowerCase()];
            const project = pmTask?.projectId ? pmState.projects[pmTask.projectId] : undefined;
            const projectName = pmTask ? (pmTask.projectId ? project?.name || "Unknown project" : "No project") : "No project";
            const dueTimestamp = pmTask?.dueDate ? (Number.isNaN(Date.parse(pmTask.dueDate)) ? null : new Date(pmTask.dueDate).getTime()) : null;
            const estimate = pmTask?.estimatePomos ?? task.target_pomodoros;
            const priorityRank = pmTask?.priority ? PRIORITY_ORDER[pmTask.priority] : 3;
            const projectId = pmTask?.projectId ?? "__no_project__";
            const projectColor = project?.color ?? "#52525b";
            const groupLabel = projectId === "__no_project__" ? "No project" : projectName;

            return {
                task,
                pmTask,
                projectName,
                dueTimestamp,
                estimate,
                priorityRank,
                index,
                projectId,
                projectColor,
                groupLabel,
            };
        });
    }, [tasks, pmTasksByAppTaskId, pmTasksByTitle, pmState.projects]);

    const sortedTasks = useMemo(() => {
        if (sortOption === "default") return decoratedTasks;
        const withSort = [...decoratedTasks];
        if (sortOption === "project") {
            withSort.sort((a, b) => {
                const aUnknown = a.projectName === "No project";
                const bUnknown = b.projectName === "No project";
                if (aUnknown && !bUnknown) return 1;
                if (!aUnknown && bUnknown) return -1;
                const cmp = a.projectName.localeCompare(b.projectName, undefined, {
                    sensitivity: "base",
                });
                return cmp !== 0 ? cmp : a.index - b.index;
            });
        } else if (sortOption === "priority") {
            withSort.sort((a, b) => {
                if (a.priorityRank !== b.priorityRank) {
                    return a.priorityRank - b.priorityRank;
                }
                return a.index - b.index;
            });
        } else if (sortOption === "dueDate") {
            withSort.sort((a, b) => {
                if (a.dueTimestamp === null && b.dueTimestamp === null) {
                    return a.index - b.index;
                }
                if (a.dueTimestamp === null) return 1;
                if (b.dueTimestamp === null) return -1;
                if (a.dueTimestamp !== b.dueTimestamp) {
                    return a.dueTimestamp - b.dueTimestamp;
                }
                return a.index - b.index;
            });
        } else if (sortOption === "estimateAsc") {
            withSort.sort((a, b) => {
                if (a.estimate !== b.estimate) {
                    return a.estimate - b.estimate;
                }
                return a.index - b.index;
            });
        } else if (sortOption === "estimateDesc") {
            withSort.sort((a, b) => {
                if (a.estimate !== b.estimate) {
                    return b.estimate - a.estimate;
                }
                return a.index - b.index;
            });
        }
        return withSort;
    }, [decoratedTasks, sortOption]);

    const groupedTasks = useMemo(() => {
        const map = new Map<
            string,
            {
                key: string;
                label: string;
                color: string;
                items: Array<(typeof sortedTasks)[number]>;
            }
        >();
        const orderedGroups: Array<{
            key: string;
            label: string;
            color: string;
            items: Array<(typeof sortedTasks)[number]>;
        }> = [];

        sortedTasks.forEach((entry) => {
            const key = entry.projectId;
            let group = map.get(key);
            if (!group) {
                group = {
                    key,
                    label: entry.groupLabel,
                    color: entry.projectColor,
                    items: [] as Array<(typeof sortedTasks)[number]>,
                };
                map.set(key, group);
                orderedGroups.push(group);
            }
            group.items.push(entry);
        });

        return orderedGroups;
    }, [sortedTasks]);

    const toggleGroup = useCallback((groupKey: string) => {
        setCollapsedGroups((prev) => ({
            ...prev,
            [groupKey]: !prev[groupKey],
        }));
    }, []);

    const sanitizeTarget = (raw: string): number => {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
            return 1;
        }
        const rounded = Math.round(parsed);
        return Math.max(1, rounded);
    };

    const commitTargetInput = (rawValue?: string) => {
        const source = rawValue ?? targetInput;
        const normalized = sanitizeTarget(source);
        const normalizedString = String(normalized);
        if (source !== normalizedString) {
            setTargetInput(normalizedString);
        } else if (rawValue !== undefined && rawValue !== targetInput) {
            setTargetInput(rawValue);
        }
        return normalized;
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Tasks</h3>
                <span className="text-[10px] text-neutral-500">{tasks.length}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-neutral-500">Sort</span>
                <select
                    value={sortOption}
                    onChange={(e) => {
                        const value = e.target.value as TaskSortOption;
                        setSortOption(value);
                        saveTaskSort(value);
                    }}
                    className="flex-1 bg-neutral-800/60 border border-neutral-700 rounded px-2 py-1.5 sm:py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                    <option value="default">Default</option>
                    <option value="project">Project</option>
                    <option value="priority">Importance</option>
                    <option value="dueDate">Due date</option>
                    <option value="estimateAsc">Estimate (asc)</option>
                    <option value="estimateDesc">Estimate (desc)</option>
                </select>
            </div>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    if (!name.trim()) return;
                    try {
                        const normalizedTarget = commitTargetInput(targetInput);
                        await createTask(name.trim(), normalizedTarget);
                        play("pressSide");
                        setName("");
                        setTargetInput(String(normalizedTarget));
                    } catch (err) {
                        console.error("Failed to create task", err);
                    }
                }}
                className="flex flex-wrap gap-2 border border-neutral-700 rounded-md bg-neutral-900/40 p-2"
            >
                <input
                    value={name}
                    placeholder="Task name"
                    onChange={(e) => setName(e.target.value)}
                    className="flex-1 min-w-[8rem] bg-neutral-800/60 border border-neutral-700 rounded px-2 py-1.5 sm:py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <input
                    type="number"
                    min={1}
                    value={targetInput}
                    onChange={(e) => setTargetInput(e.target.value)}
                    onBlur={(e) => {
                        commitTargetInput(e.target.value);
                    }}
                    className="w-14 bg-neutral-800/60 border border-neutral-700 rounded px-1 py-1.5 sm:py-1 text-[11px] text-center focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button type="submit" onMouseEnter={() => play("hover")} className="px-3 py-1.5 sm:px-2 sm:py-1 text-[11px] rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 transition-colors">
                    Add
                </button>
            </form>
            <div className="space-y-2">
                {groupedTasks.map((group) => {
                    const collapsed = collapsedGroups[group.key] ?? false;
                    return (
                        <div key={group.key} className="border border-neutral-700 rounded-md bg-neutral-900/40">
                            <button
                                type="button"
                                onClick={() => toggleGroup(group.key)}
                                className="flex w-full items-center gap-2 px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-300 hover:bg-neutral-800/60 transition"
                            >
                                {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} aria-hidden />
                                <span className="flex-1">{group.label}</span>
                                <span className="text-[10px] text-neutral-500">{group.items.length}</span>
                            </button>
                            {!collapsed && (
                                <ul className="space-y-1 px-2 pb-2">
                                    {group.items.map(({ task: t, projectName, pmTask, estimate, dueTimestamp }) => {
                                        const dueLabel = dueTimestamp ? new Date(dueTimestamp).toLocaleDateString() : null;
                                        const tooltipParts: string[] = [];
                                        if (pmTask) {
                                            tooltipParts.push(`Project: ${projectName}`);
                                            if (pmTask.priority) tooltipParts.push(`Priority: ${pmTask.priority}`);
                                            if (dueLabel) tooltipParts.push(`Due: ${dueLabel}`);
                                        } else {
                                            tooltipParts.push("Project: No project");
                                        }
                                        tooltipParts.push(`Estimate: ${estimate} pomodoros`);
                                        const active = state?.active_task === t.id;
                                        const renderKey = `${t.id}:${pmTask?.estimatePomos ?? ""}:${pmTask?.priority ?? ""}:${pmTask?.projectId ?? ""}:${pmTask?.dueDate ?? ""}`;
                                        return (
                                            <li
                                                key={renderKey}
                                                title={tooltipParts.join("\n") || undefined}
                                                onClick={() => {
                                                    setActiveTask(t.id);
                                                    play("pressSide");
                                                }}
                                                className={`group flex items-center gap-2 rounded border border-transparent px-2 py-1.5 text-[11px] transition hover:border-neutral-700 hover:bg-neutral-800/50 ${
                                                    active ? "bg-neutral-800/60 border-neutral-700" : ""
                                                }`}
                                            >
                                                <span className="flex-1 truncate">
                                                    {t.name} ({Math.round(t.completed_pomodoros * 10) / 10}/{pmTask?.estimatePomos ?? t.target_pomodoros})
                                                </span>
                                                {active && <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-white">ACTIVE</span>}
                                                {active && !t.completed_at && (
                                                    <button
                                                        onMouseEnter={() => play("hover")}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            finalizeTask(t.id);
                                                            play("completeTask");
                                                        }}
                                                        className="rounded bg-emerald-600 px-2.5 py-1 text-[10px] text-white transition hover:bg-emerald-500 active:bg-emerald-700"
                                                    >
                                                        Complete
                                                    </button>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

import React, { useMemo, useState } from "react";
import { useAppState } from "../state/AppStateContext";
import { useSounds } from "../hooks/useSounds";
import { usePM } from "../state/ProjectManagerContext";
import { PMTask, TaskPriority } from "../state/types";

export const TaskPanel: React.FC = () => {
    const { state, createTask, setActiveTask, finalizeTask } = useAppState();
    const { state: pmState } = usePM();
    const { play } = useSounds();
    const [name, setName] = useState("");
    const [target, setTarget] = useState(4);
    const [sortOption, setSortOption] = useState<"default" | "project" | "priority" | "dueDate" | "estimateAsc" | "estimateDesc">("default");
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

    const PRIORITY_ORDER: Record<TaskPriority, number> = {
        High: 0,
        Medium: 1,
        Low: 2,
    };

    const decoratedTasks = useMemo(() => {
        return tasks.map((task, index) => {
            const pmTask = pmTasksByAppTaskId[task.id];
            const project = pmTask?.projectId ? pmState.projects[pmTask.projectId] : undefined;
            const projectName = pmTask ? (pmTask.projectId ? project?.name || "Unknown project" : "No project") : "No project";
            const dueTimestamp = pmTask?.dueDate ? (Number.isNaN(Date.parse(pmTask.dueDate)) ? null : new Date(pmTask.dueDate).getTime()) : null;
            const estimate = pmTask?.estimatePomos ?? task.target_pomodoros;
            const priorityRank = pmTask?.priority ? PRIORITY_ORDER[pmTask.priority] : 3;

            return {
                task,
                pmTask,
                projectName,
                dueTimestamp,
                estimate,
                priorityRank,
                index,
            };
        });
    }, [tasks, pmTasksByAppTaskId, pmState.projects]);

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
                    onChange={(e) => setSortOption(e.target.value as any)}
                    className="flex-1 bg-neutral-800/60 border border-neutral-700 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                        await createTask(name.trim(), target);
                        play("pressSide");
                        setName("");
                    } catch (err) {
                        console.error("Failed to create task", err);
                    }
                }}
                className="flex gap-2"
            >
                <input
                    value={name}
                    placeholder="Task name"
                    onChange={(e) => setName(e.target.value)}
                    className="flex-1 bg-neutral-800/60 border border-neutral-700 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <input
                    type="number"
                    min={1}
                    value={target}
                    onChange={(e) => setTarget(Number(e.target.value))}
                    className="w-14 bg-neutral-800/60 border border-neutral-700 rounded px-1 py-1 text-[11px] text-center focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button type="submit" onMouseEnter={() => play("hover")} className="px-2 py-1 text-[11px] rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 transition-colors">
                    Add
                </button>
            </form>
            <ul className="space-y-1">
                {sortedTasks.map(({ task: t, projectName, pmTask, estimate, dueTimestamp }) => {
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
                    return (
                        <li
                            key={t.id}
                            title={tooltipParts.join("\n") || undefined}
                            onClick={() => {
                                setActiveTask(t.id);
                                play("pressSide");
                            }}
                            className={`group flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-[11px] border border-transparent hover:border-neutral-700 hover:bg-neutral-800/50 transition ${
                                active ? "bg-neutral-800/60 border-neutral-700" : ""
                            }`}
                        >
                            <span className="flex-1 truncate">
                                {t.name} ({Math.round(t.completed_pomodoros * 10) / 10}/{t.target_pomodoros})
                            </span>
                            {active && <span className="text-[9px] font-medium tracking-wide px-1.5 py-0.5 rounded bg-indigo-600 text-white">ACTIVE</span>}
                            {active && !t.completed_at && (
                                <button
                                    onMouseEnter={() => play("hover")}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        finalizeTask(t.id);
                                        play("completeTask");
                                    }}
                                    className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white"
                                >
                                    Complete
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

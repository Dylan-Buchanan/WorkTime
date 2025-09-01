import React, { useState } from "react";
import { usePM } from "../../state/ProjectManagerContext";
import { useSounds } from "../../hooks/useSounds";
// import { SidebarProjectSkeleton } from './Skeletons';
import { EmptyState } from "./EmptyState";

export const ProjectsSidebar: React.FC = () => {
    const { state, createProject, setFilters, deleteProject, updateProject } =
        usePM();
    const { play } = useSounds();
    const activeProjectId = state.ui.selectedProjectIds[0] || null;
    const activeProject = activeProjectId
        ? state.projects[activeProjectId]
        : null;
    const [search, setSearch] = useState("");
    const projects = Object.values(state.projects).filter((p) => !p.isArchived);
    const archived = Object.values(state.projects).filter((p) => p.isArchived);
    const filtered = projects.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase())
    );

    const [showArchived, setShowArchived] = useState(false);

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 mb-2">
                <h2 className="text-sm font-semibold flex-1">Projects</h2>
                {activeProject && (
                    <div className="flex items-center gap-1">
                        <button
                            onMouseEnter={() => play("hover")}
                            className="text-[10px] px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600"
                            title="Rename project"
                            onClick={() => {
                                const name = prompt(
                                    "Rename project",
                                    activeProject.name
                                );
                                if (name && name.trim())
                                    updateProject(activeProject.id, {
                                        name: name.trim(),
                                    });
                                play("pressSide");
                            }}
                        >
                            Ren
                        </button>
                        <button
                            onMouseEnter={() => play("hover")}
                            className="text-[10px] px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600"
                            title={
                                activeProject.isArchived
                                    ? "Unarchive"
                                    : "Archive"
                            }
                            onClick={() =>
                                updateProject(activeProject.id, {
                                    isArchived: !activeProject.isArchived,
                                })
                            }
                        >
                            {activeProject.isArchived ? "UnArc" : "Arc"}
                        </button>
                        <button
                            onMouseEnter={() => play("hover")}
                            className="text-[10px] px-2 py-1 rounded bg-red-700 hover:bg-red-600"
                            title="Delete project"
                            onClick={() => {
                                if (!activeProject) return;
                                const tasksCount = Object.values(
                                    state.tasks
                                ).filter(
                                    (t) =>
                                        t.projectId === activeProject.id &&
                                        !t.isArchived
                                ).length;
                                const ok = confirm(
                                    `Delete project "${activeProject.name}"${
                                        tasksCount
                                            ? ` and ${tasksCount} linked task(s)`
                                            : ""
                                    }? This cannot be undone.`
                                );
                                if (ok) {
                                    deleteProject(activeProject.id);
                                    play("pressSide");
                                }
                            }}
                        >
                            Del
                        </button>
                    </div>
                )}
                <button
                    onMouseEnter={() => play("hover")}
                    className="text-xs px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600"
                    onClick={() => {
                        const name = prompt("Project name");
                        if (name) {
                            createProject(name);
                            play("pressSide");
                        }
                    }}
                >
                    + New
                </button>
            </div>
            <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="mb-2 text-xs px-2 py-1 rounded bg-neutral-800 outline-none"
            />
            <div className="flex-1 overflow-y-auto pr-1 space-y-1 text-xs">
                {filtered.length === 0 && projects.length === 0 && (
                    <EmptyState
                        title="Create your first project"
                        action={
                            <button
                                onClick={() => {
                                    const n = prompt("Project name");
                                    if (n) createProject(n);
                                }}
                                className="text-xs underline"
                            >
                                New Project
                            </button>
                        }
                    />
                )}
                {filtered.map((p) => {
                    const tasks = Object.values(state.tasks).filter(
                        (t) => t.projectId === p.id && !t.isArchived
                    );
                    const done = tasks.filter(
                        (t) => t.status === "Done"
                    ).length;
                    const progress = tasks.length
                        ? Math.round((done / tasks.length) * 100)
                        : 0;
                    return (
                        <button
                            onMouseEnter={() => play("hover")}
                            key={p.id}
                            onClick={() => {
                                setFilters({ selectedProjectIds: [p.id] });
                                play("pressSide");
                            }}
                            className={`w-full text-left px-2 py-1 rounded hover:bg-neutral-800 focus:bg-neutral-800 group ${
                                activeProjectId === p.id ? "bg-neutral-800" : ""
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <span
                                    className="w-2.5 h-2.5 rounded-full"
                                    style={{ background: p.color }}
                                />
                                <span className="flex-1 truncate">
                                    {p.name}
                                </span>
                                <span className="text-[10px] opacity-60">
                                    {done}/{tasks.length}
                                </span>
                            </div>
                            <div className="h-1 w-full bg-neutral-700 rounded mt-1 overflow-hidden">
                                <div
                                    className="h-full bg-neutral-400"
                                    style={{ width: progress + "%" }}
                                />
                            </div>
                        </button>
                    );
                })}
                {archived.length > 0 && (
                    <div className="mt-3">
                        <button
                            onMouseEnter={() => play("hover")}
                            className="text-[10px] uppercase tracking-wide opacity-60"
                            onClick={() => setShowArchived((s) => !s)}
                        >
                            {showArchived ? "Hide" : "Show"} Archived (
                            {archived.length})
                        </button>
                        {showArchived && (
                            <div className="mt-1 space-y-1">
                                {archived.map((p) => (
                                    <div
                                        key={p.id}
                                        className="px-2 py-1 rounded bg-neutral-900/40 text-neutral-500 flex items-center gap-2"
                                    >
                                        <span
                                            className="w-2.5 h-2.5 rounded-full"
                                            style={{ background: p.color }}
                                        />
                                        <span className="flex-1 truncate">
                                            {p.name}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
